import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getSupabase, getAuthConfig } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const session = ref<Session | null>(null)
  const loading = ref(false)
  const initialized = ref(false)
  const authEnabled = ref(false)

  async function init() {
    const config = await getAuthConfig()
    authEnabled.value = config.authEnabled

    if (!config.authEnabled) {
      initialized.value = true
      return
    }

    const supabase = await getSupabase()
    if (!supabase) {
      initialized.value = true
      return
    }

    const { data } = await supabase.auth.getSession()
    session.value = data.session
    user.value = data.session?.user ?? null

    supabase.auth.onAuthStateChange((_event, s) => {
      session.value = s
      user.value = s?.user ?? null
    })

    initialized.value = true
  }

  async function signIn(email: string, password: string): Promise<string | null> {
    const supabase = await getSupabase()
    if (!supabase) return 'Auth not configured'

    loading.value = true
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return error.message
      return null
    } finally {
      loading.value = false
    }
  }

  async function signOut() {
    const supabase = await getSupabase()
    if (supabase) {
      await supabase.auth.signOut()
    }
    user.value = null
    session.value = null
  }

  function getAccessToken(): string | null {
    return session.value?.access_token ?? null
  }

  return { user, session, loading, initialized, authEnabled, init, signIn, signOut, getAccessToken }
})
