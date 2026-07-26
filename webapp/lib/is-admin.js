/**
 * Single definition of "is this the admin account".
 *
 * Returns false when no admin email is configured, so a missing env var can
 * never accidentally grant access.
 */
export function isAdmin(user) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.VITE_ADMIN_EMAIL
  return Boolean(adminEmail) && user?.email === adminEmail
}
