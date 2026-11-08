import { Scale } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shield/courthouse emblem with orbiting "satellite" scanners. Calm = lime, attack = coral/red sweeping fast. */
export function ThreatOrb({ attack, size = 220 }: { attack: boolean; size?: number }) {
  const tone = attack ? "text-threat" : "text-healthy";
  return (
    <div className={cn("relative shrink-0", tone)} style={{ width: size, height: size }} aria-hidden>
      {/* radar sweep */}
      <div
        className={cn("absolute inset-[12%] rounded-full", attack ? "animate-sweep-fast" : "animate-sweep")}
        style={{ background: "conic-gradient(from 0deg, transparent 0deg, color-mix(in oklab, currentColor 35%, transparent) 50deg, transparent 60deg)" }}
      />
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeOpacity=".15" />
        <circle cx="100" cy="100" r="66" fill="none" stroke="currentColor" strokeOpacity=".25" strokeDasharray="2 6" />
        <circle cx="100" cy="100" r="44" fill="none" stroke="currentColor" strokeOpacity=".2" />
        {/* wireframe shield */}
        <path d="M100 58 L132 70 L132 100 Q132 128 100 144 Q68 128 68 100 L68 70 Z" fill="color-mix(in oklab, currentColor 8%, transparent)" stroke="currentColor" strokeWidth="1.5" />
        <path d="M100 58 L100 144 M68 86 L132 86 M72 112 L128 112" stroke="currentColor" strokeOpacity=".35" />
      </svg>
      {/* orbiting satellites */}
      <div className={cn("absolute inset-0", attack ? "animate-orbit-fast" : "animate-orbit")}>
        <Satellite className="absolute left-1/2 top-[2%] -translate-x-1/2" />
      </div>
      <div className="absolute inset-[16%] animate-orbit-rev">
        <Satellite className="absolute bottom-0 left-1/2 -translate-x-1/2 scale-75" />
      </div>
      <div className="absolute inset-0 grid place-items-center">
        <Scale className="h-7 w-7" />
      </div>
      {attack && (
        <>
          <span className="absolute inset-[30%] rounded-full border-2 border-threat animate-ping-ring" />
          <span className="absolute inset-[30%] rounded-full border border-threat animate-ping-ring [animation-delay:.6s]" />
        </>
      )}
    </div>
  );
}

function Satellite({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 12" width="26" height="13" className={className}>
      <rect x="0" y="3" width="8" height="6" fill="currentColor" opacity=".55" />
      <rect x="16" y="3" width="8" height="6" fill="currentColor" opacity=".55" />
      <rect x="9" y="2" width="6" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}
