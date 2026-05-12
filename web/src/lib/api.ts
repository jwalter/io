import { useAuthStore } from '../stores/auth'

/**
 * Wrapper around fetch() that injects the Supabase Bearer token
 * when auth is enabled.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const auth = useAuthStore()
  const token = auth.getAccessToken()

  const headers = new Headers(init?.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(input, { ...init, headers })

  // If we get a 401, sign out so the router guard redirects to login
  if (res.status === 401 && auth.authEnabled) {
    await auth.signOut()
  }

  return res
}

/**
 * Build an EventSource URL with the access token as a query param.
 * The server can read `req.query.token` for SSE endpoints.
 */
export function authenticatedUrl(path: string): string {
  const auth = useAuthStore()
  const token = auth.getAccessToken()
  if (!token) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}token=${encodeURIComponent(token)}`
}
