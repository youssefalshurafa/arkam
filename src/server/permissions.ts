// Global (platform-level) super-admin check, distinct from the per-workspace
// "owner" role. Gated on a single allowlisted email via env var.
export function isSuperAdmin(email: string | null | undefined): boolean {
 const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
 if (!superAdminEmail || !email) {
  return false;
 }
 return email.trim().toLowerCase() === superAdminEmail;
}
