// The one API client for the FastAPI backend. Routes and shapes follow backend/API_CONTRACT.md
// and backend/app/routers. Live data is the default; sample mode only runs with VITE_USE_MOCKS=1.
import { useSyncExternalStore } from "react";

export const USE_MOCKS = import.meta.env["VITE_USE_MOCKS"] === "1";
export const API_BASE = (import.meta.env["VITE_API_BASE"] as string | undefined) ?? "/api";

// ---------- types (see API_CONTRACT.md) ----------
export type Availability = "available" | "degraded" | "locked" | "destroyed" | "unknown";
export type Copying = "none_observed" | "suspected" | "confirmed" | "unknown";
export type Certainty = "observed" | "confirmed" | "unknown";
export type IncidentStatus = "open" | "investigating" | "contained" | "recovering" | "closed";
export type Severity = "low" | "medium" | "high" | "critical";
export type TaskStatus = "open" | "in_progress" | "done" | "blocked";

export interface ApiUser { id: number; email: string; name: string; role: "admin" | "responder"; team_role: string | null }
export interface DirectoryUser extends ApiUser { active: boolean; alert_opt_in: boolean; phone_masked: string | null; created_at: string }
export interface LoginResult { token: string; expires_at: string; user: ApiUser }

export interface Incident {
  id: number; code: string; title: string; status: IncidentStatus; severity: Severity; category: string | null;
  summary: string | null; detected_at: string; source: string; created_by_name?: string | null; created_at: string; updated_at: string;
  open_tasks?: number;
}
export interface Matter {
  matter_code: string; title: string; client_label: string; lead_name: string | null; lead_role: string | null;
  deadline_at: string | null; deadline_local: string | null; deadline_label: string | null;
  availability: Availability[]; copying: Copying[]; at_risk: boolean; is_simulated: boolean;
}
export interface ScopeItem {
  id: number; system: string; data_category: string; matter_code: string | null; availability: Availability; copying: Copying;
  certainty: Certainty; notes: string | null; updated_by_name: string | null; updated_at: string;
}
export interface Evidence { id: number; ref: string; kind: string; observed_at: string; description: string; certainty: Certainty; is_simulated: boolean }
export interface Task {
  id: number; title: string; owner_user_id: number | null; owner_name: string | null; owner_label: string | null; priority: Severity;
  due_at: string | null; status: TaskStatus; source: "manual" | "ai"; evidence_refs: string[]; approved_by_name: string | null; triage_run_id: number | null;
}
export interface Message { id: number; user_id: number; user_name: string; team_role: string | null; body: string; created_at: string }
export interface TimelineEvent { id: number; at: string; kind: string; summary: string; actor_name: string | null }
export interface DraftTask { title: string; owner_role: string; due_at: string | null; priority: Severity; evidence_refs: string[]; matter_code: string | null; rationale: string | null }
export interface ToolCall { step: number; tool: string; result_summary: string; requested_by?: string }
export interface Triage {
  id: number; status: "running" | "draft" | "approved" | "rejected" | "failed"; provider: string; model: string | null; is_mock: boolean;
  tool_calls: ToolCall[]; draft: null | { summary: string; tasks: DraftTask[]; unknowns: string[]; evidence_refs: string[]; recommend_alert: boolean };
  error: string | null; created_by: string | null; decided_by: string | null; decided_at: string | null;
}
export interface Notification {
  id: number; channel: string; recipient_label: string; body: string; send_status: "pending" | "accepted" | "failed" | "unknown";
  delivery_status: "unconfirmed" | "delivered" | "undeliverable"; acknowledged_at: string | null; provider: string; is_mock: boolean;
  requested_by_name: string | null; triage_run_id: number | null;
}
/** A filing request from a litigation responder (POST /incidents/{id}/requests). */
export interface FilingRequest {
  id: number; matter_code: string; requester_id: number; body: string; created_at: string; task_id: number | null;
  triage_id: number | null; triage_status: ITTriageStatus | null; triage_error: string | null; provider: string | null;
  owner_user_id?: number | null; owner_name?: string | null; alert_status?: string | null; acknowledged_at?: string | null;
  task_updated_at?: string | null;
  status: "saved" | "task_ready" | "acknowledged" | "claimed" | "done";
}
export interface IncidentDetail {
  incident: Incident; headline: { label: string; tone: "critical" | "warning" | "ok"; kind: string }[];
  matters_at_risk: Matter[]; scope: ScopeItem[]; evidence: Evidence[]; tasks: Task[]; requests: FilingRequest[];
  messages: Message[]; timeline: TimelineEvent[]; triage: Triage | null; notifications: Notification[];
  counts: { open_tasks: number; unverified_exposure: number; affected_systems: number; messages: number }; server_time: string;
  notify_result?: { duplicate: boolean; notification_id: number; send_status?: string };
  request_id?: number; request_status?: string;
}
export interface Dashboard {
  urgent_deadlines: (Omit<Matter, "at_risk" | "is_simulated"> & { incident_id: number; incident_code: string })[];
  incidents: Incident[]; affected_systems: { system: string; availability: Availability; incident_id: number }[];
  open_tasks: { id: number; incident_id: number; title: string; status: TaskStatus; priority: Severity; due_at: string | null; owner_label: string | null; owner_name: string | null }[];
  unverified_exposure_count: number;
  recent_activity: { id: number; incident_id: number; incident_code: string; at: string; kind: string; summary: string; actor_name: string | null }[];
  server_time: string;
}
export interface SimulateResult { detected: boolean; created?: boolean; incident_id: number | null; message?: string }
export interface SystemStatus { providers: { nemotron: string; photon: string }; isolation: string; data: string }

/** Nemotron IT draft (POST /incidents/{id}/it-requests). */
export type ITTriageStatus = "pending" | "running" | "drafted" | "failed";
export interface ITRequest {
  id: number; incident_id: number; body: string; requester_label: string | null; created_at: string; updated_at: string;
  triage: { status: ITTriageStatus; can_retry: boolean; error: string | null; attempts: number; provider: "nemotron" | "fixture" | null;
    is_live_nemotron: boolean; model: string | null; tool_calls: ToolCall[]; validation: string[] };
  draft: null | {
    header: string; title: string; urgency: string; suggested_team: string; issue: string; affected: string; why_urgent: string; first_action: string;
    deadline: { known: boolean; text: string; due_ct?: string | null; matter_code?: string | null };
    evidence: { ref: string; kind: string; description: string; certainty: string }[];
    file_copying: { status: string; label: string; basis: string }; unknowns: string[]; notify_role?: string;
  };
}

// ---------- session (token in sessionStorage only, per the contract) ----------
const TOKEN_KEY = "vigil.token";
const USER_KEY = "vigil.user";
const sessionListeners = new Set<() => void>();
let cachedUserRaw: string | null | undefined;
let cachedUser: ApiUser | null = null;

const storage = () => (typeof window === "undefined" ? null : window.sessionStorage);

export const session = {
  token: () => storage()?.getItem(TOKEN_KEY) ?? null,
  user(): ApiUser | null {
    const raw = storage()?.getItem(USER_KEY) ?? null;
    if (raw !== cachedUserRaw) {
      cachedUserRaw = raw;
      try { cachedUser = raw ? (JSON.parse(raw) as ApiUser) : null; } catch { cachedUser = null; }
    }
    return cachedUser;
  },
  set(token: string, user: ApiUser) {
    storage()?.setItem(TOKEN_KEY, token);
    storage()?.setItem(USER_KEY, JSON.stringify(user));
    sessionListeners.forEach((l) => l());
  },
  clear() {
    storage()?.removeItem(TOKEN_KEY);
    storage()?.removeItem(USER_KEY);
    sessionListeners.forEach((l) => l());
  },
};

export function useSessionUser(): ApiUser | null {
  return useSyncExternalStore(
    (cb) => { sessionListeners.add(cb); return () => sessionListeners.delete(cb); },
    () => session.user(),
    () => null,
  );
}

/** Backend roles are admin/responder; team_role says whether a responder is counsel or IT. */
export const isLitigation = (u: Pick<ApiUser, "team_role"> | null | undefined) =>
  ["litigation lead", "lawyer"].includes((u?.team_role ?? "").trim().toLowerCase());
export const isITResponder = (u: Pick<ApiUser, "role" | "team_role"> | null | undefined) =>
  u?.role === "responder" && ["it lead", "it_on_call"].includes((u?.team_role ?? "").trim().toLowerCase());

// ---------- transport ----------
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** FastAPI errors are {"detail": "..."} or a validation list. Show detail as-is. */
export function errorDetail(status: number, data: unknown): string {
  const detail = data && typeof data === "object" ? (data as { detail?: unknown }).detail : undefined;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d))).join("; ");
  }
  if (status === 403) return "You don't have permission to do that.";
  return `Request failed (${status}).`;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = session.token();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the Vigil server. Check that the backend is running on port 8000.");
  }
  const data: unknown = await res.json().catch(() => null);
  if (res.status === 401 && path !== "/auth/login") {
    session.clear();
    if (typeof window !== "undefined" && window.location.pathname !== "/login") window.location.assign("/login");
  }
  // The dev proxy answers 502-504 when no backend is listening; a bare 500 is an unhandled server error.
  if ([502, 503, 504].includes(res.status) && data === null) throw new ApiError(res.status, "Can't reach the Vigil server. Check that the backend is running on port 8000.");
  if (res.status >= 500 && data === null) throw new ApiError(res.status, `The Vigil server hit an error (${res.status}). Check the backend terminal for details.`);
  if (!res.ok) throw new ApiError(res.status, errorDetail(res.status, data));
  return data as T;
}

const get = <T>(p: string) => req<T>("GET", p);
const post = <T>(p: string, b: unknown = {}) => req<T>("POST", p, b);
const patch = <T>(p: string, b: unknown) => req<T>("PATCH", p, b);
const inc = (id: number | string) => `/incidents/${id}`;

export const api = {
  // auth
  login: (email: string, password: string) => post<LoginResult>("/auth/login", { email, password }),
  logout: () => post<{ ok: boolean }>("/auth/logout"),
  me: () => get<ApiUser>("/auth/me"),
  systemStatus: () => get<SystemStatus>("/system/status"),
  // command center + incidents
  dashboard: () => get<Dashboard>("/dashboard"),
  incidents: () => get<Incident[]>("/incidents"),
  createIncident: (title: string, summary?: string) => post<IncidentDetail>("/incidents", { title, summary }),
  incident: (id: number | string) => get<IncidentDetail>(inc(id)),
  updateIncident: (id: number | string, body: { status?: IncidentStatus; severity?: Severity }) => patch<IncidentDetail>(inc(id), body),
  simulate: (fixture: "ransomware_burst" | "normal_activity" = "ransomware_burst") => post<SimulateResult>("/demo/simulate", { fixture }),
  // scope + evidence
  addScope: (id: number | string, body: { system: string; data_category: string; availability: Availability; copying: Copying; certainty: Certainty; matter_code?: string; notes?: string }) =>
    post<IncidentDetail>(`${inc(id)}/scope`, body),
  updateScope: (id: number | string, scopeId: number, body: Partial<Pick<ScopeItem, "availability" | "copying" | "certainty" | "notes">>) =>
    patch<IncidentDetail>(`${inc(id)}/scope/${scopeId}`, body),
  // response room
  postMessage: (id: number | string, body: string) => post<IncidentDetail>(`${inc(id)}/messages`, { body }),
  // tasks
  addTask: (id: number | string, body: { title: string; priority?: Severity; owner_label?: string }) => post<IncidentDetail>(`${inc(id)}/tasks`, body),
  updateTask: (id: number | string, taskId: number, body: { status?: TaskStatus }) => patch<IncidentDetail>(`${inc(id)}/tasks/${taskId}`, body),
  claimTask: (id: number | string, taskId: number) => post<IncidentDetail>(`${inc(id)}/tasks/${taskId}/claim`),
  // filing help (litigation responder -> linked IT task)
  requestFilingHelp: (id: number | string, matter_code: string, body: string) => post<IncidentDetail>(`${inc(id)}/requests`, { matter_code, body }),
  // incident-level AI triage -> approval -> Photon alert
  runTriage: (id: number | string) => post<IncidentDetail>(`${inc(id)}/triage`),
  decideTriage: (id: number | string, triage_id: number, decision: "approve" | "reject") => post<IncidentDetail>(`${inc(id)}/approve`, { triage_id, decision }),
  notify: (id: number | string, recipient_user_id: number, task_id?: number) =>
    post<IncidentDetail>(`${inc(id)}/notify`, { recipient_user_id, channel: "imessage", ...(task_id ? { task_id } : {}) }),
  ackNotification: (id: number | string, nid: number) => post<IncidentDetail>(`${inc(id)}/notifications/${nid}/ack`),
  // Nemotron IT drafts
  itRequests: (id: number | string) => get<ITRequest[]>(`${inc(id)}/it-requests`),
  itRequest: (rid: number) => get<ITRequest>(`/it-requests/${rid}`),
  submitITRequest: (id: number | string, body: string, requester_label?: string) =>
    post<ITRequest>(`${inc(id)}/it-requests`, { body, requester_label: requester_label || undefined }),
  retryITTriage: (rid: number) => post<ITRequest>(`/it-requests/${rid}/triage`),
  // access
  users: () => get<DirectoryUser[]>("/users"),
  createUser: (body: { email: string; name: string; role: "admin" | "responder"; team_role?: string; password: string; phone?: string | undefined; alert_opt_in?: boolean }) =>
    post<DirectoryUser>("/users", body),
  updateUser: (uid: number, body: Partial<{ name: string; role: "admin" | "responder"; team_role: string; active: boolean; phone: string; alert_opt_in: boolean }>) =>
    patch<DirectoryUser>(`/users/${uid}`, body),
};

// ---------- display labels (enums from the contract) ----------
export const LABELS = {
  status: { open: "Open", investigating: "Investigating", contained: "Contained", recovering: "Recovering", closed: "Closed" },
  availability: { available: "Available", degraded: "Degraded", locked: "Inaccessible", destroyed: "Destroyed", unknown: "Unknown" },
  copying: { none_observed: "None observed", suspected: "Suspected", confirmed: "Confirmed", unknown: "Unverified" },
  certainty: { observed: "Observed", confirmed: "Confirmed", unknown: "Unknown" },
  task: { open: "Open", in_progress: "In progress", done: "Done", blocked: "Blocked" },
  severity: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
} as const;

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
