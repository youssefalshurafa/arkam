/* eslint-disable @typescript-eslint/no-require-imports */
// TOTP two-factor authentication (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), the
// scheme every authenticator app (Google Authenticator, Microsoft Authenticator, 1Password,
// Authy…) speaks. Implemented on node:crypto directly — it is ~40 lines and avoids a new
// dependency on the login path.
//
// Storage (users table): mfa_secret_enc  = AES-256-GCM encrypted base32 secret
//                        mfa_enabled_at  = NULL until the user confirms a first code
//                        mfa_last_step   = last accepted time-step (blocks code replay)
// Backup codes: mfa_backup_codes, SHA-256 hashed, single use.
const crypto = require('node:crypto');
const { getPool, ensurePublicSchema, withTransaction } = require('@/server/postgres');
const {
    ISSUER,
    STEP_SECONDS,
    DIGITS,
    encryptSecret,
    decryptSecret,
    base32Encode,
    matchTotp,
    generateBackupCode,
    hashBackupCode,
    looksLikeBackupCode,
    signChallenge,
    verifyChallenge,
} = require('@/server/mfa-core');

const BACKUP_CODE_COUNT = 10;

async function replaceBackupCodes(userId, executor) {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
    await executor.query('DELETE FROM mfa_backup_codes WHERE user_id = $1', [userId]);
    for (const code of codes) {
        await executor.query('INSERT INTO mfa_backup_codes (id, user_id, code_hash) VALUES ($1, $2, $3)', [
            crypto.randomUUID(),
            userId,
            hashBackupCode(code),
        ]);
    }
    return codes;
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

async function getMfaState(userId) {
    await ensurePublicSchema();
    const { rows } = await getPool().query(
        `SELECT mfa_enabled_at AS "enabledAt",
                (SELECT COUNT(*)::int FROM mfa_backup_codes b WHERE b.user_id = u.id AND b.used_at IS NULL) AS "backupCodesLeft"
           FROM users u WHERE u.id = $1`,
        [userId],
    );
    const row = rows[0];
    return { enabled: Boolean(row?.enabledAt), enabledAt: row?.enabledAt || null, backupCodesLeft: row?.backupCodesLeft ?? 0 };
}

// Step 1 of enrollment: mint a fresh secret (replacing any unconfirmed one) and return the
// otpauth:// URI the authenticator app scans. 2FA is NOT on until confirmEnrollment().
async function startEnrollment({ userId, accountLabel }) {
    await ensurePublicSchema();
    const state = await getMfaState(userId);
    if (state.enabled) {
        throw new Error('Two-factor authentication is already on.');
    }
    const secret = base32Encode(crypto.randomBytes(20));
    await getPool().query('UPDATE users SET mfa_secret_enc = $1, mfa_last_step = NULL WHERE id = $2 AND mfa_enabled_at IS NULL', [
        encryptSecret(secret),
        userId,
    ]);
    const label = encodeURIComponent(`${ISSUER}:${accountLabel || 'account'}`);
    const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
    return { secret, uri };
}

// Step 2: the user proves the app is set up by entering a current code. Turns 2FA on and
// returns the one-time backup codes (shown once, stored hashed).
async function confirmEnrollment({ userId, code }) {
    await ensurePublicSchema();
    const { rows } = await getPool().query('SELECT mfa_secret_enc AS "secretEnc", mfa_enabled_at AS "enabledAt" FROM users WHERE id = $1', [userId]);
    const row = rows[0];
    if (!row) throw new Error('User not found.');
    if (row.enabledAt) throw new Error('Two-factor authentication is already on.');
    if (!row.secretEnc) throw new Error('Start the setup again — no pending authenticator was found.');

    const step = matchTotp(decryptSecret(row.secretEnc), code);
    if (step === null) {
        throw new Error('That code is not correct. Check the time on your phone and try again.');
    }

    return withTransaction(async (client) => {
        await client.query('UPDATE users SET mfa_enabled_at = NOW(), mfa_last_step = $1 WHERE id = $2', [step, userId]);
        const codes = await replaceBackupCodes(userId, client);
        return { backupCodes: codes };
    });
}

// Verifies a login/step-up code: a 6-digit TOTP code or a single-use backup code. The TOTP
// path claims the time-step atomically, so the same code can't be used twice (replay) even
// by two concurrent requests.
async function verifyCode({ userId, code }) {
    await ensurePublicSchema();
    const { rows } = await getPool().query(
        'SELECT mfa_secret_enc AS "secretEnc", mfa_enabled_at AS "enabledAt", mfa_last_step AS "lastStep" FROM users WHERE id = $1',
        [userId],
    );
    const row = rows[0];
    if (!row?.enabledAt || !row.secretEnc) return { ok: false };

    if (looksLikeBackupCode(code)) {
        const claimed = await getPool().query(
            `UPDATE mfa_backup_codes SET used_at = NOW()
              WHERE id = (SELECT id FROM mfa_backup_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1)
          RETURNING id`,
            [userId, hashBackupCode(code)],
        );
        return { ok: claimed.rowCount === 1, usedBackupCode: claimed.rowCount === 1 };
    }

    const step = matchTotp(decryptSecret(row.secretEnc), code);
    if (step === null) return { ok: false };
    const claimed = await getPool().query(
        'UPDATE users SET mfa_last_step = $1 WHERE id = $2 AND (mfa_last_step IS NULL OR mfa_last_step < $1) RETURNING id',
        [step, userId],
    );
    return { ok: claimed.rowCount === 1 };
}

async function regenerateBackupCodes({ userId }) {
    await ensurePublicSchema();
    return withTransaction((client) => replaceBackupCodes(userId, client));
}

// Turns 2FA off (caller has already re-authenticated the user, or it's an admin reset).
async function disableMfa({ userId }) {
    await ensurePublicSchema();
    await withTransaction(async (client) => {
        await client.query('UPDATE users SET mfa_secret_enc = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL WHERE id = $1', [userId]);
        await client.query('DELETE FROM mfa_backup_codes WHERE user_id = $1', [userId]);
    });
    return { ok: true };
}

module.exports = {
    getMfaState,
    startEnrollment,
    confirmEnrollment,
    verifyCode,
    regenerateBackupCodes,
    disableMfa,
    signChallenge,
    verifyChallenge,
};
