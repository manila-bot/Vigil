import { useMemo } from "react";
import { LINKS, SYSTEMS, systemHealth, type Health } from "@/lib/vigil";
import { Sparks } from "./Sparks";
import { cn } from "@/lib/utils";

export const HEALTH_LABEL: Record<Health, string> = { healthy: "Verified healthy", encrypted: "Encrypted", degraded: "Degraded", unknown: "Status unknown" };
export const healthText = (h: Health) => (h === "healthy" ? "text-healthy" : h === "encrypted" ? "text-threat" : h === "degraded" ? "text-risk" : "text-muted-foreground");

/** Animated firm network. Packets flow in calm mode; attack mode turns links red and sparks hit systems. */
export function FirmMap({ attack, selected, onSelect, highlight }: { attack: boolean; selected?: string | undefined; onSelect?: (id: string) => void; highlight?: string | undefined }) {
  const byId = useMemo(() => Object.fromEntries(SYSTEMS.map((s) => [s.id, s])), []);
  const hit = useMemo(() => SYSTEMS.filter((s) => systemHealth(s, attack) === "encrypted" || systemHealth(s, attack) === "degraded").map((s) => ({ x: s.x, y: s.y })), [attack]);

  return (
    <div className={cn("relative aspect-[16/10] w-full overflow-hidden rounded-lg border bg-panel", attack && "glow-threat")}>
      <div className="pointer-events-none absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-foreground/5 to-transparent animate-scanline" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {LINKS.map(([a, b]) => {
          const A = byId[a]!, B = byId[b]!;
          const bad = attack && (systemHealth(A, attack) !== "healthy" || systemHealth(B, attack) !== "healthy");
          return (
            <g key={a + b}>
              <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="var(--border)" strokeWidth=".5" vectorEffect="non-scaling-stroke" />
              <line
                x1={A.x} y1={A.y} x2={B.x} y2={B.y}
                stroke={bad ? "var(--threat)" : "var(--healthy)"}
                strokeOpacity={bad ? 0.9 : 0.5}
                strokeWidth={bad ? 2 : 1.2}
                strokeDasharray="3 37"
                vectorEffect="non-scaling-stroke"
                className={bad ? "animate-dash-fast" : "animate-dash"}
              />
            </g>
          );
        })}
      </svg>
      <Sparks origins={hit} active={attack} />
      {SYSTEMS.map((s) => {
        const h = systemHealth(s, attack);
        const isSel = selected === s.id || highlight === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect?.(s.id)}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 rounded-md border bg-card/90 px-3 py-2 text-left backdrop-blur transition hover:border-primary focus-visible:outline-2 focus-visible:outline-ring",
              h === "encrypted" && "border-threat animate-glitch",
              h === "degraded" && "border-risk",
              isSel && "ring-2 ring-primary",
            )}
            style={{ left: `${s.x}%`, top: `${s.y}%` }}
            aria-label={`${s.name}: ${HEALTH_LABEL[h]}`}
          >
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className={cn("absolute inset-0 rounded-full bg-current", healthText(h), h === "healthy" ? "animate-heartbeat" : "animate-ping-ring")} />
                <span className={cn("relative h-2 w-2 rounded-full bg-current", healthText(h))} />
              </span>
              <span className="text-xs font-semibold">{s.name}</span>
            </span>
            <span className={cn("block font-mono text-[10px] uppercase tracking-wider", healthText(h))}>{HEALTH_LABEL[h]}</span>
          </button>
        );
      })}
      <span className="absolute bottom-2 right-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Illustrative topology</span>
    </div>
  );
}
