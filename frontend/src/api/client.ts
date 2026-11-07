// One API client for the whole app. Matches backend/API_CONTRACT.md.
import { mockRequest } from "./mock";

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "1";
const TOKEN_KEY = "vigil.token";
const USER_KEY = "vigil.user";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const session = {
  get token() {
    return sessionStorage.getItem(TOKEN_KEY);
  },
  get user() {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  set(token: string, user: unknown) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  },
};

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (USE_MOCKS) return mockRequest(method, path, body) as Promise<T>;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, "Can't reach the Vigil server. Check that the backend is running.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/auth/login") {
    session.clear();
    window.location.assign("/login");
  }
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Request failed";
    throw new ApiError(res.status, detail);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>("GET", p);
export const post = <T = any>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});
export const patch = <T = any>(p: string, b: unknown) => api<T>("PATCH", p, b);
