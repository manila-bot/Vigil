import { useEffect, useState } from "react";

/** Decorative activity animation keyed to the actual incident state. */
export function Sparkline({
  attack,
  tone = "primary",
  height = 60,
}: {
  attack: boolean;
  tone?: "primary" | "accent" | "destructive";
  height?: number;
}) {
  const [pts, setPts] = useState<number[]>(() =>
    Array.from({ length: 60 }, (_, i) => 50 + Math.sin(i / 5) * 10),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setPts((p) => {
        const last = p[p.length - 1] ?? 50;
        const next = attack
          ? Math.min(98, Math.max(2, last + (Math.random() - 0.3) * 30))
          : last + (50 - last) * 0.1 + (Math.random() - 0.5) * 8;
        return [...p.slice(1), next];
      });
    }, 250);
    return () => clearInterval(id);
  }, [attack]);
  const d = pts
    .map((y, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * 100},${100 - y}`)
    .join(" ");
  const color = attack ? "text-destructive" : tone === "accent" ? "text-accent" : "text-primary";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={`w-full ${color}`}
      style={{ height }}
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
