/** Accounts allowed to open /dev (compare case-insensitively). */
const DEV_ADMIN_EMAILS = ['manossos06@gmail.com']

export function isDevAdmin(user: { email?: string | null } | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase()
  if (!email) return false
  return DEV_ADMIN_EMAILS.some((allowed) => allowed.toLowerCase() === email)
}
