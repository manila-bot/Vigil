// Synthesized UI sounds via Web Audio (no audio files). Call only from event handlers/effects.
let ctx: AudioContext | null = null;
let hum: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;

export function isMuted() {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("vigil-muted") === "1";
}
export function setMuted(m: boolean) {
  localStorage.setItem("vigil-muted", m ? "1" : "0");
  if (m) stopHum();
}

function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.15, delay = 0, slideTo?: number) {
  const c = ac();
  if (!c || isMuted()) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function playAlarm() {
  for (let i = 0; i < 3; i++) {
    tone(880, 0.18, "square", 0.08, i * 0.32);
    tone(660, 0.18, "square", 0.08, i * 0.32 + 0.16);
  }
  tone(180, 1.2, "sawtooth", 0.06, 0, 60);
  startHum();
}

export function playSpark() { tone(2400, 0.08, "triangle", 0.05, 0, 600); }
export function playChime() { tone(660, 0.4, "sine", 0.12); tone(990, 0.6, "sine", 0.1, 0.12); }
export function playClick() { tone(1200, 0.05, "sine", 0.05); }

export function startHum() {
  const c = ac();
  if (!c || isMuted() || hum) return;
  const osc = c.createOscillator();
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  const gain = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.value = 55;
  lfo.frequency.value = 0.8;
  lfoGain.gain.value = 0.015;
  gain.gain.value = 0.02;
  lfo.connect(lfoGain).connect(gain.gain);
  osc.connect(gain).connect(c.destination);
  osc.start(); lfo.start();
  hum = { osc, lfo, gain };
}
export function stopHum() {
  if (!hum) return;
  hum.osc.stop(); hum.lfo.stop();
  hum = null;
}
