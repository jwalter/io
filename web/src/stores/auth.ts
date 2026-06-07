import { create } from "zustand";
import { getSupabase } from "@/lib/supabase";

interface AuthState {
  token: string | null;
  email: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  initAuthListener: () => void;
}

function isTokenNearExpiry(jwt: string, bufferMs = 300_000): boolean {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    return payload.exp * 1000 <= Date.now() + bufferMs;
  } catch {
    return true;
  }
}

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem("io_token"),
  email: localStorage.getItem("io_email"),
  loading: false,
  get isAuthenticated() {
    return !!get().token;
  },

  initAuthListener() {
    const supabase = getSupabase();
    if (!supabase) return;

    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        set({ token: session.access_token, email: session.user?.email ?? null });
        localStorage.setItem("io_token", session.access_token);
        if (session.user?.email) localStorage.setItem("io_email", session.user.email);
      } else {
        set({ token: null, email: null });
        localStorage.removeItem("io_token");
        localStorage.removeItem("io_email");
      }
    });

    // Start periodic token health check (every 5 minutes)
    if (!healthCheckInterval) {
      healthCheckInterval = setInterval(async () => {
        const { token, refreshToken } = get();
        if (token && isTokenNearExpiry(token)) {
          await refreshToken();
        }
      }, 5 * 60 * 1000);
    }
  },

  async login(emailInput: string, password: string) {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Auth not configured");
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailInput,
        password,
      });
      if (error) throw error;
      const token = data.session?.access_token ?? null;
      const email = data.user?.email ?? null;
      set({ token, email });
      if (token) localStorage.setItem("io_token", token);
      if (email) localStorage.setItem("io_email", email);
    } finally {
      set({ loading: false });
    }
  },

  async logout() {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    set({ token: null, email: null });
    localStorage.removeItem("io_token");
    localStorage.removeItem("io_email");
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
    }
  },

  async refreshToken() {
    const supabase = getSupabase();
    if (!supabase) return;

    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      set({ token: data.session.access_token });
      localStorage.setItem("io_token", data.session.access_token);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      set({ token: sessionData.session.access_token });
      localStorage.setItem("io_token", sessionData.session.access_token);
      return;
    }

    set({ token: null });
    localStorage.removeItem("io_token");
  },
}));
