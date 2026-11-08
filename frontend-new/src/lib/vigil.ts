// Vigil sample-mode data + store (VITE_USE_MOCKS=1). Pure helpers are exported for tests.
// Live mode (the default) reads the signed-in user from the FastAPI session in api.ts.
import { useSyncExternalStore } from "react";
import { isLitigation, useSessionUser, USE_MOCKS, type ApiUser } from "@/lib/api";

export type Role = "admin" | "lawyer" | "responder";
export type Health = "healthy" | "encrypted" | "degraded" | "unknown";

export interface User { id: string; name: string; email: string; role: Role; active: boolean; title: string }
export interface System { id: string; name: string; kind: string; x: number; y: number; health: Health; healthyLabel: string; attackHealth: Health; availability: string; copying: string; matters: string[]; evidence: string[] }
export interface Matter { id: string; name: string; client: string; counsel: string; deadline: string; systems: string[] }
export interface Evidence { id: string; at: string; source: string; summary: string; system: string }
export interface Message { id: string; author: string; role: Role; text: string; at: number }
export interface TimelineEntry { id: string; at: number; text: string; kind: "attack" | "action" | "ai" | "claim" | "info"; system?: string; evidence?: string }
export type RequestStatus = "idle" | "submitting" | "saved" | "analyzing" | "ready" | "failed";
export interface ToolCall { name: string; summary: string; evidence?: string[] }

export interface VigilState {
  userId: string | null;
  attack: boolean;
  attackAt: number | null;
  messages: Message[];
  timeline: TimelineEntry[];
  request: { status: RequestStatus; text: string; savedAt?: number };
  task: { exists: boolean; owner: string | null; claimedAt?: number; recovery: "not started" | "in progress" | "verified" };
  users: User[];
}

export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", lawyer: "Lawyer", responder: "Team Member" };
export const roleLabel = (r: Role) => ROLE_LABEL[r];
export const canClaim = (u: User | undefined) => !!u && (u.role === "responder" || u.role === "admin") && u.active;
export const canAdmin = (u: User | undefined) => u?.role === "admin";

// Fixed scenario clock: attack at 9:00 a.m. CT Mon; filing due Tue 2:00 p.m. CT => 29h after scenario start.
export const SCENARIO_START_LABEL = "Mon 9:00 a.m. CT";
export const FILING_DUE_MS = 29 * 3600_000;
export const SAMPLE_DEADLINE = "Tomorrow at 2:00 p.m. CT";
export function requestDisplayStatus(status: string, task: { exists: boolean; owner: string | null }) {
  return task.exists && !task.owner ? "Waiting for IT" : status;
}
export function formatCountdown(ms: number) {
  if (ms <= 0) return "Deadline passed";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export const USERS: User[] = [
  { id: "u-lawyer", name: "Dana Whitfield", email: "dana@harlowreed.law", role: "lawyer", active: true, title: "Partner, Litigation" },
  { id: "u-it", name: "Marcus Lee", email: "marcus@harlowreed.law", role: "responder", active: true, title: "IT Security Lead" },
  { id: "u-admin", name: "Priya Raman", email: "priya@harlowreed.law", role: "admin", active: true, title: "Director of Operations" },
];

export const SYSTEMS: System[] = [
  { id: "lit", name: "Litigation Drive", kind: "File server", x: 50, y: 30, health: "healthy", healthyLabel: "Verified", attackHealth: "encrypted", availability: "Inaccessible", copying: "Unknown", matters: ["M-2024-0187", "M-2025-0042"], evidence: ["EV-101", "EV-102", "EV-104"] },
  { id: "mail", name: "Firm Email", kind: "Exchange", x: 20, y: 55, health: "healthy", healthyLabel: "Verified", attackHealth: "degraded", availability: "Intermittent", copying: "Unknown", matters: ["M-2024-0187"], evidence: ["EV-103"] },
  { id: "dms", name: "Document Mgmt", kind: "iManage", x: 80, y: 55, health: "healthy", healthyLabel: "Verified", attackHealth: "unknown", availability: "Unknown", copying: "Unknown", matters: ["M-2025-0042", "M-2025-0110"], evidence: [] },
  { id: "efile", name: "Court e-Filing", kind: "PACER / state portal", x: 35, y: 85, health: "healthy", healthyLabel: "Verified", attackHealth: "healthy", availability: "Available", copying: "Not observed", matters: ["M-2024-0187"], evidence: [] },
  { id: "billing", name: "Billing & Trust", kind: "Accounting", x: 65, y: 85, health: "healthy", healthyLabel: "Verified", attackHealth: "healthy", availability: "Available", copying: "Not observed", matters: [], evidence: [] },
];
export const LINKS: [string, string][] = [["lit", "mail"], ["lit", "dms"], ["mail", "efile"], ["dms", "billing"], ["efile", "billing"], ["lit", "efile"]];

export const MATTERS: Matter[] = [
  { id: "M-2024-0187", name: "Calloway v. Brightline Freight", client: "Calloway Holdings", counsel: "Dana Whitfield", deadline: "Filing due tomorrow at 2:00 p.m. CT", systems: ["lit", "mail", "efile"] },
  { id: "M-2025-0042", name: "In re Westmore Estate", client: "Westmore Family Trust", counsel: "J. Okafor", deadline: "Discovery responses Fri", systems: ["lit", "dms"] },
  { id: "M-2025-0110", name: "Ardent Bio — Licensing", client: "Ardent Bio Inc.", counsel: "R. Castillo", deadline: "No deadline this week", systems: ["dms"] },
];

export const EVIDENCE: Evidence[] = [
  { id: "EV-101", at: "9:00 a.m.", source: "EDR alert", summary: "Mass rename to *.lockd on \\\\lit-fs01\\Exhibits", system: "lit" },
  { id: "EV-102", at: "9:02 a.m.", source: "File server", summary: "Ransom note README_RESTORE.txt in 412 folders", system: "lit" },
  { id: "EV-103", at: "9:06 a.m.", source: "Mail gateway", summary: "Outbound mail queue stalled; auth failures spike", system: "mail" },
  { id: "EV-104", at: "9:11 a.m.", source: "Backup console", summary: "Last snapshot of Exhibits: Sun 11:40 p.m., integrity unverified", system: "lit" },
];

export const TOOL_CALLS: ToolCall[] = [
  { name: "get_incident_scope", summary: "Litigation Drive encrypted; Email degraded; DMS unknown.", evidence: ["EV-101", "EV-103"] },
  { name: "get_matter_deadlines", summary: "Calloway v. Brightline — filing due tomorrow 2:00 p.m. CT (29h)." },
  { name: "search_evidence(\"exhibits backup\")", summary: "Sunday 11:40 p.m. snapshot exists; integrity not yet verified.", evidence: ["EV-104"] },
  { name: "assess_exfiltration", summary: "No egress telemetry for lit-fs01 — data copying remains unknown." },
];

export const STATUS_LABEL: Record<RequestStatus, string> = {
  idle: "Not requested", submitting: "Submitting", saved: "Request saved", analyzing: "Analyzing", ready: "Recommendation ready", failed: "Triage failed",
};

const KEY = "vigil-sample-state-v1";
const PREFILL = "I need the locked exhibits for tomorrow's court filing.";

export function initialState(): VigilState {
  return {
    userId: null, attack: false, attackAt: null, messages: [], timeline: [],
    request: { status: "idle", text: PREFILL },
    task: { exists: false, owner: null, recovery: "not started" },
    users: USERS.map((u) => ({ ...u })),
  };
}

let state: VigilState = initialState();
const SERVER = state;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { const raw = localStorage.getItem(KEY); if (raw) state = { ...initialState(), ...JSON.parse(raw) }; } catch { /* ignore */ }
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY || !e.newValue) return;
    const next = JSON.parse(e.newValue) as VigilState;
    state = { ...next, userId: state.userId }; // keep per-tab sign-in
    listeners.forEach((l) => l());
  });
  const sess = sessionStorage.getItem("vigil-user");
  state = { ...state, userId: sess };
}

export function setState(fn: (s: VigilState) => VigilState) {
  load();
  state = fn(state);
  if (typeof window !== "undefined") {
    const { userId: _u, ...shared } = state;
    localStorage.setItem(KEY, JSON.stringify(shared));
    if (state.userId) sessionStorage.setItem("vigil-user", state.userId); else sessionStorage.removeItem("vigil-user");
  }
  listeners.forEach((l) => l());
}
export const getState = () => state;

export function useVigil() {
  return useSyncExternalStore(
    (cb) => { load(); listeners.add(cb); cb(); return () => listeners.delete(cb); },
    () => state,
    () => SERVER,
  );
}
/** Map a backend account onto the UI roles: admin, counsel (litigation team role) or IT/team member. */
export function liveUser(u: ApiUser): User {
  const role: Role = u.role === "admin" ? "admin" : isLitigation(u) ? "lawyer" : "responder";
  return { id: String(u.id), name: u.name, email: u.email, role, active: true, title: u.team_role ?? roleLabel(role) };
}
export function useCurrentUser() {
  const s = useVigil();
  const live = useSessionUser();
  if (!USE_MOCKS) return live ? liveUser(live) : undefined;
  return s.users.find((u) => u.id === s.userId);
}

const uid = () => Math.random().toString(36).slice(2, 9);
const addTimeline = (s: VigilState, e: Omit<TimelineEntry, "id" | "at">): VigilState => ({ ...s, timeline: [...s.timeline, { ...e, id: uid(), at: Date.now() }] });

export const actions = {
  signIn(email: string) {
    load();
    const u = state.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase() && x.active);
    if (!u) return false;
    setState((s) => ({ ...s, userId: u.id }));
    return true;
  },
  signOut() { setState((s) => ({ ...s, userId: null })); },
  simulateAttack() {
    setState((s) => {
      let n: VigilState = { ...s, attack: true, attackAt: Date.now() };
      n = addTimeline(n, { kind: "attack", text: "EDR: mass encryption on Litigation Drive", system: "lit", evidence: "EV-101" });
      n = addTimeline(n, { kind: "attack", text: "Ransom note found in Exhibits folders", system: "lit", evidence: "EV-102" });
      n = addTimeline(n, { kind: "attack", text: "Firm Email degraded — outbound queue stalled", system: "mail", evidence: "EV-103" });
      return n;
    });
  },
  reset() { const uidKeep = state.userId; setState(() => ({ ...initialState(), userId: uidKeep })); },
  post(text: string) {
    const u = state.users.find((x) => x.id === state.userId);
    if (!u || !text.trim()) return;
    setState((s) => ({ ...s, messages: [...s.messages, { id: uid(), author: u.name, role: u.role, text: text.trim(), at: Date.now() }] }));
  },
  async requestHelp(text: string) {
    setState((s) => ({ ...s, request: { status: "submitting", text } }));
    await wait(700);
    setState((s) => addTimeline({ ...s, request: { status: "saved", text, savedAt: Date.now() } }, { kind: "action", text: "Dana Whitfield requested IT help for Calloway exhibits" }));
    await wait(600);
    setState((s) => ({ ...s, request: { ...s.request, status: "analyzing" } }));
    await wait(1800);
    setState((s) => addTimeline({ ...s, request: { ...s.request, status: "ready" }, task: { ...s.task, exists: true } }, { kind: "ai", text: "Nemotron (sample): recommend locating a verified clean copy of exhibits", evidence: "EV-104" }));
  },
  claim() {
    const u = state.users.find((x) => x.id === state.userId);
    if (!u || !canClaim(u)) return { ok: false as const, reason: "You don't have permission to claim tasks." };
    if (!state.task.exists) return { ok: false as const, reason: "No recovery task exists yet." };
    if (state.task.owner) return { ok: false as const, reason: `Already claimed by ${state.task.owner}.` };
    setState((s) => addTimeline({ ...s, task: { ...s.task, owner: u.name, claimedAt: Date.now() } }, { kind: "claim", text: `${u.name} claimed: Find a verified clean copy of the filing exhibits` }));
    return { ok: true as const };
  },
  verifyRecovery() {
    setState((s) => {
      const n = addTimeline({ ...s, task: { ...s.task, recovery: "verified" } }, { kind: "action", text: "Clean exhibit copy verified and restored to counsel" });
      return n;
    });
  },
  updateUser(id: string, patch: Partial<User>) {
    if (!canAdmin(state.users.find((x) => x.id === state.userId))) return false;
    setState((s) => ({ ...s, users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
    return true;
  },
  addUser(u: Omit<User, "id" | "active">) {
    setState((s) => ({ ...s, users: [...s.users, { ...u, id: uid(), active: true }] }));
  },
};

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export function systemHealth(sys: System, attack: boolean): Health { return attack ? sys.attackHealth : sys.health; }
