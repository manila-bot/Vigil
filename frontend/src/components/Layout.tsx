import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, LogOut, ShieldCheck, Users } from "lucide-react";
import { post, session, USE_MOCKS } from "../api/client";

export default function Layout() {
  const user = session.user;
  const nav = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
      isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
    }`;

  async function signOut() {
    await post("/auth/logout").catch(() => {});
    session.clear();
    nav("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-navy-900 px-3 py-5 text-white">
        <div className="mb-8 flex items-center gap-2 px-3">
          <ShieldCheck className="h-7 w-7 text-sky-300" />
          <div>
            <div className="text-lg font-bold leading-none">Vigil</div>
            <div className="text-[11px] text-slate-400">Incident command center</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          <NavLink to="/" end className={link}>
            <LayoutDashboard className="h-4 w-4" /> Command Center
          </NavLink>
          {user?.role === "admin" && (
            <NavLink to="/access" className={link}>
              <Users className="h-4 w-4" /> Access
            </NavLink>
          )}
        </nav>
        <div className="mt-auto space-y-3 px-3">
          {USE_MOCKS && (
            <div className="rounded-md bg-purple-500/20 px-2 py-1.5 text-[11px] text-purple-100">
              Sample data mode. Nothing is saved.
            </div>
          )}
          <div className="text-sm">
            <div className="font-semibold">{user?.name}</div>
            <div className="text-xs text-slate-400">
              {user?.team_role ?? user?.role} · {user?.role}
            </div>
          </div>
          <button onClick={signOut} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}
