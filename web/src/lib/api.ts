import { useAuthStore } from "@/stores/auth";

const BASE_URL = "/api";

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 <= Date.now() + 60_000;
  } catch {
    return true;
  }
}

async function getHeaders(): Promise<HeadersInit> {
  const { token, refreshToken } = useAuthStore.getState();
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (token && isTokenExpired(token)) {
    await refreshToken();
  }

  const currentToken = useAuthStore.getState().token;
  if (currentToken) {
    headers.Authorization = `Bearer ${currentToken}`;
  }
  return headers;
}

async function handleResponse(res: Response, retryFn: () => Promise<Response>): Promise<Response> {
  if (res.status === 401) {
    const { refreshToken, token, logout } = useAuthStore.getState();
    try {
      await refreshToken();
      if (useAuthStore.getState().token) {
        const retryRes = await retryFn();
        if (retryRes.status === 401) {
          logout();
          window.location.href = "/login";
          throw new Error("Session expired");
        }
        return retryRes;
      }
    } catch {
      // Refresh failed
    }
    logout();
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  return res;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await handleResponse(await fetch(`${BASE_URL}${path}`, { headers: await getHeaders() }), async () =>
    fetch(`${BASE_URL}${path}`, { headers: await getHeaders() }),
  );
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const opts = {
    method: "POST",
    headers: await getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await handleResponse(await fetch(`${BASE_URL}${path}`, opts), async () =>
    fetch(`${BASE_URL}${path}`, { ...opts, headers: await getHeaders() }),
  );
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  const opts = {
    method: "PUT",
    headers: await getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await handleResponse(await fetch(`${BASE_URL}${path}`, opts), async () =>
    fetch(`${BASE_URL}${path}`, { ...opts, headers: await getHeaders() }),
  );
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  const opts: RequestInit = { method: "DELETE", headers: await getHeaders() };
  const res = await handleResponse(await fetch(`${BASE_URL}${path}`, opts), async () =>
    fetch(`${BASE_URL}${path}`, { ...opts, headers: await getHeaders() }),
  );
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
