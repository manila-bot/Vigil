import { Link, useNavigate, useHydrated } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Gavel, LayoutDashboard, LogOut, ShieldCheck, Users, Volume2, VolumeX } from "lucide-react";
import { actions, roleLabel, useCurrentUser, useVigil } from "@/lib/vigil";
import { isMuted, playAlarm, setMuted, stopHum, playChime } from "@/lib/sound";
import { api, session, USE_MOCKS } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const s = useVigil();
  const user = useCurrentUser();
  const nav = useNavigate();
  const queryClient = useQueryClient();
  async function signOut() {
    try {
      await queryClient.cancelQueries();
      if (!USE_MOCKS) await api.logout();
    } catch (err) {
      // The local session is cleared either way; the server session expires on its own.
      toast.error(err instanceof Error ? `Signed out locally. ${err.message}` : "Signed out locally.");
    }
    queryClient.clear(); session.clear(); actions.signOut();
    await nav({ to: "/login", replace: true });
  }
  // Live threat state: any open incident on the Command Center payload.
  const live = useQuery({ queryKey: ["vigil", "dashboard"], queryFn: api.dashboard, enabled: !USE_MOCKS && hydrated && !!user, refetchInterval: 2000, retry: false });
  const status = useQuery({ queryKey: ["vigil", "system-status"], queryFn: api.systemStatus, enabled: !USE_MOCKS && hydrated && !!user, staleTime: 60_000, retry: false });
  const liveIncident = live.data?.incidents[0];
  const attack = USE_MOCKS ? s.attack : !!liveIncident;
  const [muted, setM] = useState(true);
  const prev = useRef<boolean | null>(null);

  useEffect(() => { setM(isMuted()); }, []);
  useEffect(() => { if (hydrated && !user) nav({ to: "/login" }); }, [hydrated, user, nav]);
  useEffect(() => {
    if (!hydrated || (!USE_MOCKS && !live.data)) return;
    if (prev.current === false && attack) playAlarm();
    if (prev.current === true && !attack) { stopHum(); playChime(); }
    prev.current = attack;
  }, [attack, hydrated, live.data]);
  useEffect(() => () => stopHum(), []);

  if (!hydrated || !user) return <div className="min-h-screen" />;

  const items = [
    { to: "/" as const, label: "Command Center", icon: LayoutDashboard },
    { to: "/incidents" as const, label: "Incidents", icon: Gavel },
    ...(user.role === "admin" ? [{ to: "/access" as const, label: "Access", icon: Users }] : []),
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r bg-panel lg:w-56">
        <div className="flex h-16 items-center gap-2 border-b px-4">
          <ShieldCheck className={cn("h-6 w-6", attack ? "text-threat animate-glitch" : "text-healthy")} />
          <div className="hidden lg:block">
            <div className="font-display text-lg leading-none">Vigil</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Harlow & Reed LLP</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-2" aria-label="Main">
          {items.map((i) => (
            <Link key={i.to} to={i.to} activeOptions={{ exact: i.to === "/" }} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:bg-accent data-[status=active]:text-foreground">
              <i.icon className="h-4 w-4 shrink-0" />
              <span className="hidden lg:inline">{i.label}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="hidden lg:block">
            <div className="text-sm font-medium">{user.name}</div>
            <div className="text-xs text-muted-foreground">{roleLabel(user.role)} · {user.title}</div>
          </div>
          <Button variant="ghost" size="sm" aria-label="Sign out" onClick={() => void signOut()} className="mt-2 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <LogOut className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Sign out</span>
          </Button>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        {USE_MOCKS && s.attack && <div key={s.attackAt} className="pointer-events-none fixed inset-0 z-50 bg-threat animate-flash" />}
        <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-3 border-b bg-background/85 px-4 backdrop-blur lg:px-6">
          <span className="rounded border border-risk/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-risk">{USE_MOCKS ? "Sample mode · fictional data" : "Live mode"}</span>
          <StatusPill attack={attack} />
          {status.data && <span className="hidden font-mono text-[10px] uppercase tracking-widest text-muted-foreground md:inline">Nemotron: {status.data.providers.nemotron} · Photon: {status.data.providers.photon}</span>}
          {live.error && <span role="alert" className="text-xs text-threat">Live status unavailable: {live.error.message}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="icon"
              onClick={() => { const m = !muted; setMuted(m); setM(m); if (!m && attack) playAlarm(); }}
              className="rounded-md border p-2 hover:bg-accent" aria-label={muted ? "Turn sound on" : "Mute sound"} aria-pressed={!muted}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
          </div>
        </header>
        {USE_MOCKS && s.attack && (
          <div role="alert" className="animate-banner-in flex flex-wrap items-center gap-3 border-b border-threat/50 bg-threat/15 px-6 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-threat animate-heartbeat" />
            <strong className="text-threat">Ransomware detected</strong>
            <span className="text-muted-foreground">Litigation Drive encrypted · Firm Email degraded · Calloway filing at risk</span>
            <Link to="/incidents/$id" params={{ id: "INC-0917" }} className="font-medium text-primary hover:underline">Open incident →</Link>
          </div>
        )}
        {!USE_MOCKS && liveIncident && (
          <div role="alert" className="animate-banner-in flex flex-wrap items-center gap-3 border-b border-threat/50 bg-threat/15 px-6 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-threat animate-heartbeat" />
            <strong className="text-threat">{liveIncident.code} · {liveIncident.status}</strong>
            <span className="min-w-0 truncate text-muted-foreground">{liveIncident.title}</span>
            <Link to="/incidents/$id" params={{ id: String(liveIncident.id) }} className="font-medium text-primary hover:underline">Open incident →</Link>
          </div>
        )}
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function StatusPill({ attack }: { attack: boolean }) {
  return (
    <span className={cn("hidden items-center gap-2 rounded-full border px-3 py-1 text-xs sm:inline-flex", attack ? "border-threat text-threat" : "border-healthy/40 text-healthy")}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inset-0 rounded-full bg-current animate-ping-ring" />
        <span className="relative h-2 w-2 rounded-full bg-current" />
      </span>
      {attack ? "Under attack — threat active" : "All systems verified · no active threat"}
    </span>
  );
}
