import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSuperAdmin, checkAdminPanelPassword, signAdminUnlockToken, verifyAdminUnlockToken } from '@/server/permissions';
import { safeNextPath } from '@/shared/lib/safeNextPath';
import { sniffImageMime } from '@/server/http';
import { passwordProblem } from '@/shared/lib/passwordRules';

// The server modules are CommonJS and use the '@/' alias internally; dynamic import goes
// through vitest's resolver, so the alias works inside them too.
process.env.NEXTAUTH_SECRET = 'test-secret-for-unit-tests-only-0123456789';

const passwords = await import('@/server/passwords');
const mfa = await import('@/server/mfa-core');

describe('password policy (server)', () => {
 const { validatePassword, needsRehash } = passwords;

 it('accepts a reasonable password', () => {
  expect(() => validatePassword('Kettle-Moon-42')).not.toThrow();
 });

 it('rejects short, single-class, common and identifier-equal passwords', () => {
  expect(() => validatePassword('a1b2c3')).toThrow(/at least 8/);
  expect(() => validatePassword('onlyletters')).toThrow(/letters and numbers/);
  expect(() => validatePassword('12345678901')).toThrow(/letters and numbers/);
  expect(() => validatePassword('Password123')).toThrow(/too common/);
  expect(() => validatePassword('alice2024x', { identifier: 'alice2024x' })).toThrow(/username or email/);
  expect(() => validatePassword('bob12345', { identifier: 'bob12345@example.com' })).toThrow(/username or email/);
 });

 it('counts the bcrypt limit in bytes, not characters', () => {
  // 37 Arabic letters = 74 UTF-8 bytes (> 72) even though it is well under 128 characters.
  expect(() => validatePassword(`${'ب'.repeat(37)}1`)).toThrow(/too long/);
  expect(() => validatePassword(`${'ب'.repeat(30)}1`)).not.toThrow();
 });

 it('accepts non-Latin letters and digits for the composition rule', () => {
  expect(() => validatePassword('كلمةسرية٢٠٢٤')).not.toThrow();
 });

 it('flags legacy cost-10 hashes for rehash', () => {
  // A real bcrypt hash at cost 10 ("password").
  expect(needsRehash('$2a$10$CwTycUXWue0Thq9StjUM0uJ8.Ev1rZ1YkV5HGGB.MjVt1vH6iZ1aO')).toBe(true);
  expect(needsRehash('$2a$12$CwTycUXWue0Thq9StjUM0uJ8.Ev1rZ1YkV5HGGB.MjVt1vH6iZ1aO')).toBe(false);
  expect(needsRehash('not-a-hash')).toBe(false);
 });

 it('hashes and verifies asynchronously', async () => {
  const hash = await passwords.hashPassword('Kettle-Moon-42');
  expect(await passwords.verifyPassword('Kettle-Moon-42', hash)).toBe(true);
  expect(await passwords.verifyPassword('Kettle-Moon-43', hash)).toBe(false);
  expect(await passwords.verifyPassword('anything', null)).toBe(false);
 }, 20_000);
});

describe('password policy (client mirror)', () => {
 it('reports the first broken rule', () => {
  expect(passwordProblem('short1')).toBe('signup_password_too_short');
  expect(passwordProblem('longbutnodigits')).toBe('signup_password_complexity');
  expect(passwordProblem('Kettle-Moon-42')).toBeNull();
 });
});

describe('TOTP (RFC 6238 / RFC 4226)', () => {
 const { base32Encode, base32Decode, hotp, matchTotp, currentStep } = mfa;
 // RFC 4226 Appendix D test secret: ASCII "12345678901234567890".
 const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));

 it('round-trips base32', () => {
  expect(rfcSecret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  expect(base32Decode(rfcSecret).toString()).toBe('12345678901234567890');
 });

 it('matches the RFC 4226 HOTP test vectors', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  expected.forEach((code, counter) => expect(hotp(rfcSecret, counter)).toBe(code));
 });

 it('accepts the current step and +/-1 for clock drift, nothing further', () => {
  const now = 1_700_000_000_000;
  const step = currentStep(now);
  expect(matchTotp(rfcSecret, hotp(rfcSecret, step), now)).toBe(step);
  expect(matchTotp(rfcSecret, hotp(rfcSecret, step - 1), now)).toBe(step - 1);
  expect(matchTotp(rfcSecret, hotp(rfcSecret, step + 1), now)).toBe(step + 1);
  expect(matchTotp(rfcSecret, hotp(rfcSecret, step + 2), now)).toBeNull();
  expect(matchTotp(rfcSecret, hotp(rfcSecret, step - 2), now)).toBeNull();
 });

 it('rejects malformed codes', () => {
  expect(matchTotp(rfcSecret, '12345')).toBeNull();
  expect(matchTotp(rfcSecret, 'abcdef')).toBeNull();
  expect(matchTotp(rfcSecret, '')).toBeNull();
 });
});

describe('MFA secrets, backup codes and Google challenges', () => {
 const { encryptSecret, decryptSecret, looksLikeBackupCode, hashBackupCode } = mfa;

 it('encrypts secrets at rest and detects tampering', () => {
  const stored = encryptSecret('JBSWY3DPEHPK3PXP');
  expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
  expect(decryptSecret(stored)).toBe('JBSWY3DPEHPK3PXP');
  const parts = stored.split('.');
  const flipped = Buffer.from(parts[3], 'base64');
  flipped[0] ^= 0xff;
  parts[3] = flipped.toString('base64');
  expect(() => decryptSecret(parts.join('.'))).toThrow();
 });

 it('tells backup codes from TOTP codes and normalizes them', () => {
  expect(looksLikeBackupCode('abcde-fgh23')).toBe(true);
  expect(looksLikeBackupCode('ABCDE FGH23')).toBe(true);
  expect(looksLikeBackupCode('123456')).toBe(false);
  expect(hashBackupCode('abcde-fgh23')).toBe(hashBackupCode(' ABCDEFGH23 '));
 });

 describe('signed challenge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('verifies, then expires after 5 minutes, and rejects tampering', () => {
   vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
   const token = mfa.signChallenge('user-123');
   expect(mfa.verifyChallenge(token)).toEqual({ userId: 'user-123' });
   const forged = token.replace('user-123', 'user-999');
   expect(mfa.verifyChallenge(forged)).toBeNull();
   vi.setSystemTime(new Date('2026-11-20T10:05:01Z'));
   expect(mfa.verifyChallenge(token)).toBeNull();
  });
 });
});

describe('super-admin identity and panel unlock', () => {
 const original = { ...process.env };
 afterEach(() => {
  process.env = { ...original };
 });

 it('is pinned to the configured user id and fails closed', () => {
  process.env.SUPER_ADMIN_USER_ID = 'abc-123';
  expect(isSuperAdmin('abc-123')).toBe(true);
  expect(isSuperAdmin('someone-else')).toBe(false);
  expect(isSuperAdmin(undefined)).toBe(false);
  delete process.env.SUPER_ADMIN_USER_ID;
  expect(isSuperAdmin('abc-123')).toBe(false);
 });

 it('binds the unlock cookie to one user', () => {
  const token = signAdminUnlockToken('abc-123');
  expect(token).toBeTruthy();
  expect(verifyAdminUnlockToken(token, 'abc-123')).toBe(true);
  expect(verifyAdminUnlockToken(token, 'other-user')).toBe(false);
  expect(verifyAdminUnlockToken(`${token}x`, 'abc-123')).toBe(false);
  // Old unbound format (expiresAt.signature) is no longer accepted.
  expect(verifyAdminUnlockToken(token!.split('.').slice(1).join('.'), 'abc-123')).toBe(false);
 });

 it('compares the panel password without a length shortcut', () => {
  process.env.SUPER_ADMIN_PANEL_PASSWORD = 'correct horse';
  expect(checkAdminPanelPassword('correct horse')).toBe(true);
  expect(checkAdminPanelPassword('correct hors')).toBe(false);
  expect(checkAdminPanelPassword('a much longer wrong password')).toBe(false);
 });
});

describe('request hygiene helpers', () => {
 it('only allows same-site next= paths', () => {
  expect(safeNextPath('/invite/abc')).toBe('/invite/abc');
  expect(safeNextPath('https://evil.example')).toBe('/');
  expect(safeNextPath('//evil.example')).toBe('/');
  expect(safeNextPath('/\\evil.example')).toBe('/');
  expect(safeNextPath('javascript:alert(1)')).toBe('/');
  expect(safeNextPath(null)).toBe('/');
 });

 it('sniffs image types from bytes, not the declared type', () => {
  expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
  expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  expect(sniffImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
  expect(sniffImageMime(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
 });
});
