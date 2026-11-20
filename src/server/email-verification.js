/* eslint-disable @typescript-eslint/no-require-imports */
// Email ownership proofs via 6-digit codes, for three flows (email_verification_tokens.purpose):
//   'signup'       — a new account. NO users row exists until the code is confirmed, so an
//                    unverified address can never own an account (that was the root of the
//                    super-admin / Google pre-registration takeovers).
//   'verify'       — an existing account proving the address it already has (legacy accounts
//                    created before verification existed).
//   'email_change' — a signed-in user moving to a new address; the switch only happens once
//                    the new inbox confirms.
//
// Codes are stored as an HMAC (never in clear), expire after 10 minutes, allow 5 attempts, and
// can be re-sent at most once a minute / 5 times. Requests for an address that is already
// registered get a DECOY pending row: the API answers identically, but no code that could
// ever match is sent (the inbox owner gets an "you already have an account" mail instead).
const crypto = require('node:crypto');
const { getPool, ensurePublicSchema, withTransaction } = require('@/server/postgres');
const { validatePassword, hashPassword } = require('@/server/passwords');

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS = 5;
// Keep in sync with TRIAL_DURATION_DAYS in src/config/plan.ts (and auth-db.js).
const TRIAL_DURATION_DAYS = 14;

function codeKey() {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error('NEXTAUTH_SECRET is not set.');
    return secret;
}

function hashCode(purpose, pendingId, code) {
    return crypto.createHmac('sha256', codeKey()).update(`email-code:${purpose}:${pendingId}:${String(code).trim()}`).digest('hex');
}

function generateCode() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function generatePendingId() {
    return crypto.randomBytes(16).toString('hex');
}

function codesMatch(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits ? `+${digits}` : '';
}

class VerificationError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

async function fetchOne(text, params, executor = getPool()) {
    const { rows } = await executor.query(text, params);
    return rows[0] || null;
}

async function insertPending({ purpose, email, name, userId, phone, passwordHash, decoy }) {
    const pendingId = generatePendingId();
    const code = generateCode();
    await getPool().query(
        `INSERT INTO email_verification_tokens
            (id, email, name, token_hash, expires_at, purpose, user_id, phone, password_hash, code_hash, attempts, last_sent_at, send_count, decoy)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, NOW(), 1, $11)`,
        [
            pendingId,
            email,
            name || '',
            crypto.createHash('sha256').update(pendingId).digest('hex'),
            new Date(Date.now() + CODE_TTL_MS).toISOString(),
            purpose,
            userId || null,
            phone || '',
            passwordHash || null,
            hashCode(purpose, pendingId, decoy ? generateCode() + generateCode() : code),
            Boolean(decoy),
        ],
    );
    return { pendingId, code: decoy ? null : code };
}

// Housekeeping: drop stale rows and any earlier pending request for the same subject.
async function clearPending({ purpose, email, userId }) {
    await getPool().query("DELETE FROM email_verification_tokens WHERE expires_at < NOW() - INTERVAL '1 day'");
    if (userId) {
        await getPool().query('DELETE FROM email_verification_tokens WHERE purpose = $1 AND user_id = $2 AND used_at IS NULL', [purpose, userId]);
    } else {
        await getPool().query('DELETE FROM email_verification_tokens WHERE purpose = $1 AND email = $2 AND used_at IS NULL', [purpose, email]);
    }
}

// ---------------------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------------------

async function startSignup({ name, email, password, phone }) {
    await ensurePublicSchema();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new VerificationError('Please enter a valid email address.', 'INVALID_EMAIL');
    }
    validatePassword(password, { identifier: normalizedEmail });

    const existing = await fetchOne('SELECT id, name FROM users WHERE email = $1', [normalizedEmail]);
    await clearPending({ purpose: 'signup', email: normalizedEmail });

    const displayName = String(name || '').trim() || normalizedEmail.split('@')[0];
    if (existing) {
        const { pendingId } = await insertPending({ purpose: 'signup', email: normalizedEmail, name: displayName, decoy: true });
        return { pendingId, email: normalizedEmail, name: existing.name || displayName, code: null, alreadyRegistered: true };
    }

    const passwordHash = await hashPassword(password);
    const { pendingId, code } = await insertPending({
        purpose: 'signup',
        email: normalizedEmail,
        name: displayName,
        phone: normalizePhone(phone),
        passwordHash,
    });
    return { pendingId, email: normalizedEmail, name: displayName, code, alreadyRegistered: false };
}

// Issues a fresh code for any pending verification (signup, verify, email_change).
async function resendCode({ pendingId, userId }) {
    await ensurePublicSchema();
    const row = await fetchOne(
        `SELECT id, purpose, email, name, user_id AS "userId", decoy, send_count AS "sendCount",
                EXTRACT(EPOCH FROM (NOW() - last_sent_at)) * 1000 AS "sinceLastMs"
           FROM email_verification_tokens
          WHERE id = $1 AND used_at IS NULL`,
        [String(pendingId || '')],
    );
    if (!row || (row.userId && userId && row.userId !== userId) || (row.purpose !== 'signup' && row.userId !== userId)) {
        throw new VerificationError('This verification has expired. Please start again.', 'EXPIRED');
    }
    if (Number(row.sinceLastMs) < RESEND_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - Number(row.sinceLastMs)) / 1000);
        throw new VerificationError(`Please wait ${waitSeconds} seconds before requesting another code.`, 'RESEND_TOO_SOON');
    }
    if (Number(row.sendCount) >= MAX_SENDS) {
        throw new VerificationError('Too many codes requested. Please start again later.', 'TOO_MANY_SENDS');
    }

    const code = generateCode();
    await getPool().query(
        `UPDATE email_verification_tokens
            SET code_hash = $1, attempts = 0, expires_at = $2, last_sent_at = NOW(), send_count = send_count + 1
          WHERE id = $3`,
        [hashCode(row.purpose, row.id, row.decoy ? generateCode() + generateCode() : code), new Date(Date.now() + CODE_TTL_MS).toISOString(), row.id],
    );
    return { purpose: row.purpose, email: row.email, name: row.name, code: row.decoy ? null : code, decoy: row.decoy };
}

// Checks a code against a pending row; counts the attempt. Returns the row on success.
async function checkCode({ pendingId, code, purpose, userId }) {
    const row = await fetchOne(
        `SELECT id, purpose, email, name, phone, user_id AS "userId", password_hash AS "passwordHash",
                code_hash AS "codeHash", attempts, decoy, (expires_at < NOW()) AS expired
           FROM email_verification_tokens
          WHERE id = $1 AND purpose = $2 AND used_at IS NULL`,
        [String(pendingId || ''), purpose],
    );
    if (!row || (purpose !== 'signup' && row.userId !== userId)) {
        throw new VerificationError('This verification has expired. Please start again.', 'EXPIRED');
    }
    if (Number(row.attempts) >= MAX_ATTEMPTS) {
        await getPool().query('DELETE FROM email_verification_tokens WHERE id = $1', [row.id]);
        throw new VerificationError('Too many incorrect codes. Please start again.', 'TOO_MANY_ATTEMPTS');
    }
    if (row.expired) {
        throw new VerificationError('This code has expired. Request a new one.', 'CODE_EXPIRED');
    }
    if (row.decoy || !codesMatch(hashCode(row.purpose, row.id, code), row.codeHash)) {
        await getPool().query('UPDATE email_verification_tokens SET attempts = attempts + 1 WHERE id = $1', [row.id]);
        const left = MAX_ATTEMPTS - Number(row.attempts) - 1;
        throw new VerificationError(
            left > 0 ? `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many incorrect codes. Please start again.',
            left > 0 ? 'WRONG_CODE' : 'TOO_MANY_ATTEMPTS',
        );
    }
    return row;
}

// Confirms a signup code and creates the account (verified email, trial window, own
// workspace). `createWorkspaceForUser` is injected from auth-db.js to avoid a require cycle.
async function completeSignup({ pendingId, code, createWorkspaceWithExecutor }) {
    await ensurePublicSchema();
    const row = await checkCode({ pendingId, code, purpose: 'signup' });

    return withTransaction(async (client) => {
        const claimed = await fetchOne(
            'UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1 AND used_at IS NULL RETURNING id',
            [row.id],
            client,
        );
        if (!claimed) {
            throw new VerificationError('This verification has expired. Please start again.', 'EXPIRED');
        }
        const taken = await fetchOne('SELECT id FROM users WHERE email = $1', [row.email], client);
        if (taken) {
            throw new VerificationError('An account with this email already exists. Sign in instead.', 'ALREADY_REGISTERED');
        }

        const userId = crypto.randomUUID();
        const startedAt = new Date();
        const endsAt = new Date(startedAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
        await client.query(
            `INSERT INTO users (id, email, name, password_hash, phone, email_verified_at, subscription_started_at, subscription_ends_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)`,
            [userId, row.email, row.name || row.email.split('@')[0], row.passwordHash, row.phone || '', startedAt.toISOString(), endsAt.toISOString()],
        );
        await createWorkspaceWithExecutor(client, userId, `${row.name || row.email.split('@')[0]} Workspace`);
        return { userId, email: row.email, name: row.name };
    });
}

// ---------------------------------------------------------------------------------------
// Existing accounts: verify the current address, or change to a new one
// ---------------------------------------------------------------------------------------

async function startAccountVerification({ userId }) {
    await ensurePublicSchema();
    const user = await fetchOne('SELECT email, name, email_verified_at AS "verifiedAt" FROM users WHERE id = $1', [userId]);
    if (!user) throw new VerificationError('User not found.', 'NOT_FOUND');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email || '')) {
        throw new VerificationError('Your account signs in with a username, so there is no email to verify.', 'NOT_EMAIL');
    }
    if (user.verifiedAt) {
        throw new VerificationError('Your email is already verified.', 'ALREADY_VERIFIED');
    }
    await clearPending({ purpose: 'verify', userId });
    const { pendingId, code } = await insertPending({ purpose: 'verify', email: user.email, name: user.name, userId });
    return { pendingId, email: user.email, name: user.name, code };
}

// Caller has already re-authenticated the user (current password).
async function startEmailChange({ userId, newEmail }) {
    await ensurePublicSchema();
    const normalized = String(newEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw new VerificationError('Please enter a valid email address.', 'INVALID_EMAIL');
    }
    const user = await fetchOne('SELECT email, name FROM users WHERE id = $1', [userId]);
    if (!user) throw new VerificationError('User not found.', 'NOT_FOUND');
    if (normalized === user.email) {
        throw new VerificationError('The new email is the same as your current email.', 'SAME_EMAIL');
    }
    await clearPending({ purpose: 'email_change', userId });
    // Taken address: decoy (same response), so this can't be used to probe registered emails.
    const taken = await fetchOne('SELECT id FROM users WHERE email = $1', [normalized]);
    const { pendingId, code } = await insertPending({ purpose: 'email_change', email: normalized, name: user.name, userId, decoy: Boolean(taken) });
    return { pendingId, email: normalized, name: user.name, code, alreadyRegistered: Boolean(taken) };
}

async function confirmAccountCode({ userId, pendingId, code }) {
    await ensurePublicSchema();
    const row = await fetchOne('SELECT purpose FROM email_verification_tokens WHERE id = $1 AND user_id = $2 AND used_at IS NULL', [
        String(pendingId || ''),
        userId,
    ]);
    if (!row || (row.purpose !== 'verify' && row.purpose !== 'email_change')) {
        throw new VerificationError('This verification has expired. Please start again.', 'EXPIRED');
    }
    const pending = await checkCode({ pendingId, code, purpose: row.purpose, userId });

    return withTransaction(async (client) => {
        await client.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1', [pending.id]);
        if (pending.purpose === 'verify') {
            const updated = await fetchOne(
                'UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1 AND email = $2 RETURNING email',
                [userId, pending.email],
                client,
            );
            if (!updated) throw new VerificationError('Your email changed in the meantime. Please start again.', 'EXPIRED');
            return { purpose: 'verify', email: pending.email };
        }
        const previous = await fetchOne('SELECT email FROM users WHERE id = $1', [userId], client);
        const taken = await fetchOne('SELECT id FROM users WHERE email = $1', [pending.email], client);
        if (taken) {
            throw new VerificationError('This email is already in use.', 'ALREADY_REGISTERED');
        }
        await client.query('UPDATE users SET email = $1, email_verified_at = NOW() WHERE id = $2', [pending.email, userId]);
        return { purpose: 'email_change', email: pending.email, previousEmail: previous?.email || null };
    });
}

module.exports = {
    VerificationError,
    startSignup,
    resendCode,
    completeSignup,
    startAccountVerification,
    startEmailChange,
    confirmAccountCode,
    _internals: { hashCode, generateCode },
};
