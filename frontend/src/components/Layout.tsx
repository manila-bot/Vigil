import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { get, post, session, USE_MOCKS } from "../api/client";

export default function Layout() {
  const user = session.user;
  const nav = useNavigate();
  const [status, setStatus] = useState<any>(null);
  useEffect(() => {
    get("/system/status").then(setStatus).catch(() => {});
  }, []);

  const pill = ({ isActive }: { isActive: boolean }) => (isActive ? "pill-active" : "pill");
  const initials = (user?.name ?? "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("");
  const aiLive = status?.providers?.nemotron === "live";
  const alertsLive = status?.providers?.photon === "live";

  async function signOut() {
    await post("/auth/logout").catch(() => {});
    session.clear();
    nav("/login");
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-5">
      <header className="mb-8 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-accent" />
          <span className="text-lg font-semibold tracking-tight">Vigil</span>
        </div>
        <nav className="mx-auto flex items-center gap-1 rounded-full border border-line bg-panel p-1">
          <NavLink to="/" end className={pill}>Command Center</NavLink>
          {user?.role === "admin" && <NavLink to="/access" className={pill}>Access</NavLink>}
        </nav>
        <div className="flex items-center gap-3">
          {/* Always say what's real and what's simulated */}
          <div className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted lg:flex"
            title={status?.isolation}>
            <span className={`h-2 w-2 rounded-full ${USE_MOCKS ? "bg-violet-400" : "bg-lime"}`} />
            {USE_MOCKS ? "Sample data" : "Isolated server"}
            <span className="text-faint">·</span> AI {aiLive ? "live" : "mock"}
            <span className="text-faint">·</span> Alerts {alertsLive ? "live" : "simulated"}
          </div>
          <div className="flex items-center gap-2.5 rounded-full border border-line bg-panel py-1 pl-1 pr-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-black">{initials}</span>
            <div className="leading-tight">
              <div className="text-sm font-medium">{user?.name}</div>
              <div className="text-[11px] text-faint">{user?.team_role ?? user?.role}</div>
            </div>
          </div>
          <button onClick={signOut} className="icon-btn" title="Sign out" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
