import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let supabaseClient: SupabaseClient | null = null
let authConfig: { authEnabled: boolean; supabaseUrl: string | null; supabaseAnonKey: string | null } | null = null

export async function getAuthConfig() {
  if (authConfig) return authConfig
  const res = await fetch('/api/auth/config')
  authConfig = await res.json()
  return authConfig!
}

export async function getSupabase(): Promise<SupabaseClient | null> {
  if (supabaseClient) return supabaseClient
  const config = await getAuthConfig()
  if (!config.authEnabled || !config.supabaseUrl || !config.supabaseAnonKey) {
    return null
  }
  supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey)
  return supabaseClient
}
