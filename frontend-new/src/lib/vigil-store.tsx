import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  api,
  isITResponder,
  isLitigation,
  session,
  useSessionUser,
  type ApiUser,
  type IncidentDetail,
} from "./api";

export type Role = "lawyer" | "it" | "admin";
export const ROLE_INFO = {
  lawyer: { title: "Lawyer" },
  it: { title: "IT Help Desk & Technical IT" },
  admin: { title: "Admin" },
};
export function roleOf(user: ApiUser | null): Role | null {
  if (user?.role === "admin") return "admin";
  if (isITResponder(user)) return "it";
  if (isLitigation(user)) return "lawyer";
  return null;
}

type Context = {
  user: ApiUser | null;
  role: Role | null;
  detail: IncidentDetail | null;
  loading: boolean;
  error: string;
  refresh: () => void;
};
const VigilContext = createContext<Context | null>(null);
export function useVigil() {
  const value = useContext(VigilContext);
  if (!value) throw new Error("Missing Vigil provider");
  return value;
}

export function VigilProvider({ children }: { children: ReactNode }) {
  const user = useSessionUser();
  const [snapshot, setSnapshot] = useState<{
    user: ApiUser;
    detail: IncidentDetail | null;
    error: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!user) return;
      try {
        const [active] = await api.incidents();
        const detail = active && active.status !== "closed" ? await api.incident(active.id) : null;
        if (!stopped) setSnapshot({ user, detail, error: "" });
      } catch (error) {
        if (!stopped)
          setSnapshot((previous) => ({
            user,
            detail: previous?.user === user ? previous.detail : null,
            error: error instanceof Error ? error.message : "Unable to load the incident.",
          }));
      } finally {
        if (!stopped) timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [user, revision]);
  const current = snapshot?.user === user ? snapshot : null;
  return (
    <VigilContext.Provider
      value={{
        user,
        role: roleOf(user),
        detail: current?.detail ?? null,
        loading: Boolean(user && !current),
        error: current?.error ?? "",
        refresh: () => setRevision((value) => value + 1),
      }}
    >
      {children}
    </VigilContext.Provider>
  );
}

export async function signIn(role: Role, email: string, password: string) {
  const result = await api.login(email, password);
  if (roleOf(result.user) !== role) {
    throw new Error(
      "This account belongs to a different workspace. Choose its role on the home page.",
    );
  }
  session.set(result.token, result.user);
}
