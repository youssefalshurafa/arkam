// Client-side mirror of the server password policy (src/server/passwords.js) for instant
// feedback. The server stays authoritative — it also rejects common passwords and enforces
// the 72-byte bcrypt limit, and its error message is shown verbatim when it does.
export const PASSWORD_MIN_LENGTH = 8;

/** Returns a locale key describing the first rule the password breaks, or null. */
export function passwordProblem(password: string): string | null {
 if (password.length < PASSWORD_MIN_LENGTH) return 'signup_password_too_short';
 if (!/\p{L}/u.test(password) || !/\p{Nd}/u.test(password)) return 'signup_password_complexity';
 return null;
}
