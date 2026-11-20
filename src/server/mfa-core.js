/* eslint-disable @typescript-eslint/no-require-imports */
// Pure two-factor primitives (no database): TOTP per RFC 6238, secret encryption at rest,
// backup-code format, and the signed Google-MFA challenge. Kept free of DB imports so it can
// be unit-tested directly (see security-auth.test.ts); src/server/mfa.js builds on it.
const crypto = require('node:crypto');

const ISSUER = 'Arkam';
const STEP_SECONDS = 30;
const DIGITS = 6;
const DRIFT_STEPS = 1; // accept the previous/next 30s step for clock skew

// ---------------------------------------------------------------------------------------
// Secret encryption at rest
// ---------------------------------------------------------------------------------------

let warnedAboutKey = false;
function encryptionKey() {
    const configured = process.env.AUTH_ENCRYPTION_KEY?.trim();
    if (configured) {
        const key = Buffer.from(configured, 'base64');
        if (key.length !== 32) {
            throw new Error('AUTH_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
        }
        return key;
    }
    // Fallback so 2FA works before the env var is set. Derived from NEXTAUTH_SECRET, which
    // means rotating NEXTAUTH_SECRET would invalidate every enrolled authenticator — set
    // AUTH_ENCRYPTION_KEY to decouple them.
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
        throw new Error('AUTH_ENCRYPTION_KEY (or NEXTAUTH_SECRET) must be set to use two-factor authentication.');
    }
    if (!warnedAboutKey) {
        warnedAboutKey = true;
        console.warn('[mfa] AUTH_ENCRYPTION_KEY is not set; deriving the 2FA secret key from NEXTAUTH_SECRET.');
    }
    return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), Buffer.from('arkam-mfa-secret'), 32));
}

function encryptSecret(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

function decryptSecret(stored) {
    const [version, iv, tag, data] = String(stored || '').split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable two-factor secret.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(text) {
    const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (const char of clean) {
        value = (value << 5) | BASE32.indexOf(char);
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

function hotp(secretBase32, counter) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const mac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(buf).digest();
    const offset = mac[mac.length - 1] & 0x0f;
    const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
    return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

function currentStep(nowMs = Date.now()) {
    return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

// Returns the matching time-step, or null. Constant-time comparison per candidate.
function matchTotp(secretBase32, code, nowMs = Date.now()) {
    const digits = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(digits)) return null;
    const step = currentStep(nowMs);
    for (let delta = -DRIFT_STEPS; delta <= DRIFT_STEPS; delta += 1) {
        const expected = hotp(secretBase32, step + delta);
        if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) return step + delta;
    }
    return null;
}

// ---------------------------------------------------------------------------------------
// Backup codes
// ---------------------------------------------------------------------------------------

// No 0/O/1/I/L — these get read aloud and typed from paper.
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function generateBackupCode() {
    const bytes = crypto.randomBytes(10);
    let out = '';
    for (let i = 0; i < 10; i += 1) out += BACKUP_ALPHABET[bytes[i] % BACKUP_ALPHABET.length];
    return `${out.slice(0, 5)}-${out.slice(5)}`;
}

function normalizeBackupCode(code) {
    return String(code || '').trim().toLowerCase().replace(/[\s-]/g, '');
}

function hashBackupCode(code) {
    return crypto.createHash('sha256').update(`arkam-backup:${normalizeBackupCode(code)}`).digest('hex');
}

function looksLikeBackupCode(code) {
    const normalized = normalizeBackupCode(code);
    return normalized.length === 10 && /^[a-z0-9]+$/.test(normalized) && /[a-z]/.test(normalized);
}

// ---------------------------------------------------------------------------------------
// Google sign-in second step: a short-lived signed challenge proves the user just completed
// the Google OAuth leg; the /login/mfa page trades it + a code for a session through the
// 'mfa-challenge' credentials provider.
// ---------------------------------------------------------------------------------------

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function challengeKey() {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error('NEXTAUTH_SECRET is not set.');
    return secret;
}

function signChallenge(userId) {
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    const nonce = crypto.randomBytes(8).toString('hex');
    const payload = `${userId}.${expiresAt}.${nonce}`;
    const sig = crypto.createHmac('sha256', challengeKey()).update(`mfa-challenge:${payload}`).digest('base64url');
    return `${payload}.${sig}`;
}

function verifyChallenge(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 4) return null;
    const [userId, expiresAtRaw, nonce, sig] = parts;
    const expected = crypto.createHmac('sha256', challengeKey()).update(`mfa-challenge:${userId}.${expiresAtRaw}.${nonce}`).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (!Number.isFinite(Number(expiresAtRaw)) || Date.now() > Number(expiresAtRaw)) return null;
    return { userId };
}

module.exports = {
    ISSUER,
    STEP_SECONDS,
    DIGITS,
    encryptSecret,
    decryptSecret,
    base32Encode,
    base32Decode,
    hotp,
    currentStep,
    matchTotp,
    generateBackupCode,
    normalizeBackupCode,
    hashBackupCode,
    looksLikeBackupCode,
    signChallenge,
    verifyChallenge,
};
