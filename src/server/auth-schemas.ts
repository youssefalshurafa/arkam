import { z } from 'zod';

// Request body schemas for the auth / account / admin routes. Length caps everywhere: no
// field may be unbounded (names and notes end up in emails and the admin UI; passwords
// are capped by the bcrypt byte limit in src/server/passwords.js anyway).

const identifier = z.string().trim().min(1, 'Email or username is required.').max(254);
const email = z.string().trim().toLowerCase().max(254).email('Please enter a valid email address.');
const password = z.string().min(1, 'Password is required.').max(256);
const name = z.string().trim().max(120);
const phone = z.string().trim().max(40);
const note = z.string().trim().max(1000);
const code = z.string().trim().min(1, 'Enter the code.').max(32);
const token = z.string().trim().min(16).max(256);

export const forgotPasswordSchema = z.object({
 identifier: identifier.optional(),
 email: identifier.optional(), // legacy field name
 note: note.optional(),
});

export const resetPasswordSchema = z.object({
 token,
 password,
 purpose: z.enum(['reset', 'setup']).optional(),
});

export const changePasswordSchema = z.object({
 currentPassword: password,
 newPassword: password,
});

export const changeEmailStartSchema = z.object({
 currentPassword: password,
 newEmail: email,
});

export const verifyCodeSchema = z.object({
 code,
});

export const signupStartSchema = z.object({
 name: name.optional(),
 email,
 password,
 phone: phone.optional(),
 workspaceName: name.optional(),
});

export const signupVerifySchema = z.object({
 pendingId: z.string().trim().min(1).max(64),
 code,
});

export const signupResendSchema = z.object({
 pendingId: z.string().trim().min(1).max(64),
});

export const reauthSchema = z.object({
 password,
});

export const mfaCodeSchema = z.object({
 code,
});

export const mfaDisableSchema = z.object({
 password,
 code,
});

export const inviteCreateSchema = z.object({
 identifier: z.string().trim().max(254).optional(),
 email: z.string().trim().max(254).optional(), // legacy field name
 name: name.optional(),
 role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

export const inviteAcceptSchema = z.object({
 token,
});

export const inviteSignupSchema = z.object({
 token,
 name: name.optional(),
 username: z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.'),
 password,
 phone: phone.optional(),
});

export const adminCreateUserSchema = z.object({
 name: name.optional(),
 email: identifier,
 durationDays: z.coerce.number().int().positive().max(3650).optional(),
 phone: phone.optional(),
});

export const adminUserActionSchema = z.object({
 action: z.enum(['reset_password', 'setup_link', 'reset_mfa']).default('reset_password'),
});

export const adminUserPatchSchema = z.object({
 phone: phone.optional(),
 aiEnabled: z.boolean().optional(),
});

export const adminDeleteUserSchema = z.object({
 userId: z.string().trim().min(1).max(64),
});

export const adminReviewSchema = z.object({
 id: z.string().trim().min(1).max(64),
 action: z.enum(['approve', 'reject']),
});
