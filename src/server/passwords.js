/* eslint-disable @typescript-eslint/no-require-imports */
// Single source of truth for password policy + hashing. Every path that sets or checks a
// password (signup, reset, setup link, change-password, login) goes through here, so the
// policy can't drift between flows again (signup used to demand letters+digits while
// reset/change only checked length).
const bcrypt = require('bcryptjs');

const BCRYPT_COST = 12;
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
// bcrypt silently ignores everything past 72 bytes, so two passwords sharing a 72-byte
// prefix would both unlock the account. Reject instead of truncating. Note this is BYTES:
// Arabic characters are 2 bytes each in UTF-8.
const MAX_BYTES = 72;

// Common passwords that satisfy the letter+digit rule (the ones that matter here — pure
// digit or pure letter passwords are already rejected by the composition check).
const COMMON_PASSWORDS = new Set([
    'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword1',
    'abc12345', 'abcd1234', 'abc123456', 'abcdef123', 'a1234567', 'a12345678', 'a123456789',
    'aa123456', 'aa12345678', 'qwerty123', 'qwerty1234', 'qwerty12', 'qwer1234', 'q1w2e3r4',
    'q1w2e3r4t5', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx', 'zaq12wsx', 'asdf1234', 'zxcv1234',
    'asd12345', 'qwe12345', 'test1234', 'test12345', 'admin123', 'admin1234', 'admin12345',
    'welcome1', 'welcome123', 'iloveyou1', 'iloveyou123', 'letmein1', 'monkey123', 'dragon123',
    'master123', 'login123', 'user1234', 'pass1234', 'pass12345', 'secret123', 'trustno1',
    'football1', 'baseball1', 'superman1', 'batman123', 'sunshine1', 'princess1', 'shadow123',
    'michael1', 'charlie1', 'jordan23', 'liverpool1', 'arsenal1', 'chelsea1', 'barcelona1',
    'realmadrid1', 'samsung123', 'google123', 'apple123', 'computer1', 'internet1', 'changeme1',
    '12345678a', '123456789a', '1234567890a', '12345abc', '123abc456', '123qwe123', '1234qwer',
    '12qwaszx', '11111111a', '00000000a', 'a1b2c3d4', 'a1b2c3d4e5', 'abc123abc', 'qazwsx123',
    'arkam123', 'arkam1234', 'mohamed1', 'mohammed1', 'mohamed123', 'mohammed123', 'ahmed123',
    'ali12345', 'allah123', 'bismillah1', 'pakistan1', 'lebanon1', 'syria123', 'turkey123',
]);

function validatePassword(password, { identifier } = {}) {
    const value = String(password || '');
    if (value.length < MIN_LENGTH) {
        throw new Error(`Password must be at least ${MIN_LENGTH} characters.`);
    }
    if (value.length > MAX_LENGTH || Buffer.byteLength(value, 'utf8') > MAX_BYTES) {
        throw new Error('Password is too long.');
    }
    if (!/\p{L}/u.test(value) || !/\p{Nd}/u.test(value)) {
        throw new Error('Password must contain both letters and numbers.');
    }
    const lowered = value.toLowerCase();
    if (COMMON_PASSWORDS.has(lowered)) {
        throw new Error('This password is too common. Please choose another.');
    }
    const id = String(identifier || '').trim().toLowerCase();
    if (id && (lowered === id || lowered === id.split('@')[0])) {
        throw new Error('Password must not be the same as your username or email.');
    }
    return value;
}

// Async on purpose: the old hashSync/compareSync calls blocked the Node event loop for the
// whole bcrypt run, stalling every other request on the instance during a login.
async function hashPassword(password) {
    return bcrypt.hash(String(password), BCRYPT_COST);
}

async function verifyPassword(password, hash) {
    if (!hash) return false;
    return bcrypt.compare(String(password || ''), hash);
}

// Older hashes were made at cost 10; login rehashes them transparently once verified.
function needsRehash(hash) {
    try {
        return bcrypt.getRounds(hash) < BCRYPT_COST;
    } catch {
        return false;
    }
}

// A real cost-12 hash of a random throwaway string. Login compares against it when the
// account doesn't exist (or has no password) so the response takes the same ~bcrypt time
// either way — otherwise the fast "no such user" path is a timing oracle for which
// usernames/emails are registered.
let dummyHashPromise = null;
async function burnPasswordCheck(password) {
    if (!dummyHashPromise) {
        dummyHashPromise = bcrypt.hash(`dummy-${Math.random()}`, BCRYPT_COST);
    }
    await bcrypt.compare(String(password || ''), await dummyHashPromise);
    return false;
}

module.exports = {
    BCRYPT_COST,
    validatePassword,
    hashPassword,
    verifyPassword,
    needsRehash,
    burnPasswordCheck,
};
