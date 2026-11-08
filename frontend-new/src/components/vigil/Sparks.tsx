import { useEffect, useRef } from "react";
import { playSpark } from "@/lib/sound";

/** Canvas spark bursts at given % origins while active. */
export function Sparks({ origins, active, sound = false }: { origins: { x: number; y: number }[]; active: boolean; sound?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = cv.getContext("2d")!;
    const style = getComputedStyle(cv);
    const c1 = style.getPropertyValue("--threat").trim() || "red";
    const c2 = style.getPropertyValue("--risk").trim() || "orange";
    type P = { x: number; y: number; vx: number; vy: number; life: number; c: string };
    let ps: P[] = [];
    let raf = 0;
    const resize = () => { cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio; };
    resize();
    window.addEventListener("resize", resize);
    const burst = () => {
      const o = origins[Math.floor(Math.random() * origins.length)];
      if (!o) return;
      const ox = (o.x / 100) * cv.width, oy = (o.y / 100) * cv.height;
      for (let i = 0; i < 28; i++) {
        const a = Math.random() * Math.PI * 2, sp = (1 + Math.random() * 4) * devicePixelRatio;
        ps.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 1, c: Math.random() > 0.4 ? c1 : c2 });
      }
      if (sound) playSpark();
    };
    burst();
    const iv = setInterval(burst, 900 + Math.random() * 600);
    const tick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ps = ps.filter((p) => p.life > 0);
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.08 * devicePixelRatio; p.vx *= 0.98; p.life -= 0.022;
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.strokeStyle = p.c; ctx.lineWidth = 1.6 * devicePixelRatio;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); ctx.stroke();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { clearInterval(iv); cancelAnimationFrame(raf); window.removeEventListener("resize", resize); ctx.clearRect(0, 0, cv.width, cv.height); };
  }, [active, origins, sound]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
