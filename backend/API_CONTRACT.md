# Vigil API contract (v0.1)

**This file is the authority.** Coordinate with the core owner before you rename a route or a field.
Example responses for every screen are in `backend/fixtures/api/`. They are generated from the real API by `python scripts/make_api_fixtures.py`, so they always match.

## Basics
- Base path: `/api`. JSON in, JSON out. Interactive docs: `http://localhost:8000/api/docs`.
- Auth: `POST /api/auth/login` returns `token`. Send `Authorization: Bearer <token>` on every other call.
  - `401` means not signed in or the session expired, so go to Sign in. `403` means the action is admin-only.
  - Never store the token anywhere except memory or `sessionStorage`.
- Errors: `{"detail": "Human-readable message"}`. Show `detail` to the user as is.
- Times: ISO 8601 UTC strings. Show them in local time. Deadline fields come pre-formatted (`deadline_local`, for example `"2:00 PM"` or `"Tomorrow 5:00 PM"`).
- Live updates: poll `GET /api/incidents/{id}` (or `/api/dashboard`) every **2 s**. Chat can poll `GET /api/incidents/{id}/messages?after_id=N` for just the new messages.
- Mutations under `/api/incidents/{id}/…` **return the full incident payload**, so replace your state with the response.

## Endpoints

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| POST | `/auth/login` | anyone | `{email, password}` | `{token, expires_at, user}` |
| POST | `/auth/logout` | signed in | – | `{ok}` |
| GET | `/auth/me` | signed in | – | `user` |
| GET | `/system/status` | signed in | – | which providers are live or mocked, plus an isolation note |
| GET | `/dashboard` | signed in | – | Command Center payload (below) |
| GET | `/users` | signed in | – | list of users (responders see active users only) |
| POST | `/users` | **admin** | `{email, name, role, team_role?, password(≥10), phone?, alert_opt_in?}` | user |
| PATCH | `/users/{id}` | **admin** | any of `{name, role, team_role, active, phone, alert_opt_in, password}` | user |
| GET | `/incidents` | signed in | – | list of incidents + `open_tasks` |
| POST | `/incidents` | signed in | `{title, severity?, category?, summary?, detected_at?}` | incident payload |
| GET | `/incidents/{id}` | signed in | – | **incident payload** |
| PATCH | `/incidents/{id}` | signed in | `{title?, status?, severity?, summary?}` | incident payload |
| POST | `/incidents/{id}/scope` | signed in | `{system, data_category, matter_code?, availability, copying, certainty, notes?}` | incident payload |
| PATCH | `/incidents/{id}/scope/{scope_id}` | signed in | `{availability?, copying?, certainty?, notes?}` | incident payload |
| POST | `/incidents/{id}/evidence` | signed in | `{kind, description, observed_at?, certainty?}` | incident payload |
| POST | `/incidents/{id}/messages` | signed in | `{body}` | incident payload |
| GET | `/incidents/{id}/messages?after_id=N` | signed in | – | new messages only |
| POST | `/incidents/{id}/tasks` | signed in | `{title, owner_user_id?, owner_label?, priority?, due_at?, evidence_refs?}` | incident payload |
| PATCH | `/incidents/{id}/tasks/{task_id}` | signed in | `{status?, owner_user_id?, owner_label?, due_at?}` | incident payload |
| POST | `/incidents/{id}/triage` | signed in | – | incident payload with `triage.status = "draft"` (or `"failed"`) |
| POST | `/incidents/{id}/approve` | signed in | `{triage_id, decision: "approve"\|"reject", task_indexes?}` | incident payload |
| POST | `/incidents/{id}/notify` | signed in | `{recipient_user_id, channel: "imessage"\|"sms"}` | incident payload + `notify_result {duplicate, notification_id, send_status}` |
| POST | `/incidents/{id}/notifications/{nid}/ack` | signed in | – | incident payload |
| POST | `/demo/simulate` | signed in | `{fixture: "ransomware_burst"\|"normal_activity"}` | `{detected, created, incident_id, incident?, message?}` |
| POST | `/demo/reset` | **admin** | – | `{ok}`: wipes incidents, keeps users |
| GET | `/health` | anyone | – | `{ok}` |

### Rules the server enforces
- No tasks are created and no alert can be sent until a signed-in person **approves** a triage draft (`409` otherwise).
- The alert recipient must be active and have `phone` + `alert_opt_in` set by an admin (`422` otherwise).
- One alert per (incident, approved draft, recipient, channel). Repeated clicks return `notify_result.duplicate = true` and do **not** send again. A send with an `unknown` outcome (timeout) is never resent automatically.
- The alert text is generic: `VIGIL ALERT VIG-0001: incident response activated…`. No client or case details leave Vigil.
- `simulate` doesn't create a duplicate incident if it's clicked twice.

## Incident payload (`GET /api/incidents/{id}`)
See `fixtures/api/incident_full.json`.
```
incident        {id, code, title, status, severity, category, summary, detected_at, source, created_by_name, created_at, updated_at}
headline        [{label, tone: critical|warning|ok, kind}]   ← chips for the top of the page, e.g. "2:00 PM court filing at risk"
matters_at_risk [{matter_code, title, client_label, lead_name, lead_role, deadline_at, deadline_local, deadline_label, availability[], copying[], at_risk, is_simulated}]
scope           [{id, system, data_category, matter_code, availability, copying, certainty, notes, updated_by_name, updated_at}]
evidence        [{id, ref: "EV-1", kind, observed_at, description, detail{}, certainty, is_simulated}]
tasks           [{id, title, owner_user_id, owner_name, owner_label, priority, due_at, status, source: manual|ai, evidence_refs[], approved_by_name, triage_run_id}]
messages        [{id, user_id, user_name, team_role, body, created_at}]
timeline        [{id, at, kind, summary, actor_name, detail{}}]
triage          null | {id, status: running|draft|approved|rejected|failed, provider: nemotron|stub, model, is_mock,
                        tool_calls: [{step, tool, args, result_summary, result}],
                        draft: {summary, tasks:[{title, owner_role, owner_user_id, due_at, priority, evidence_refs[], matter_code, rationale}],
                                unknowns[], evidence_refs[], recommend_alert},
                        error, created_by, decided_by, decided_at}
notifications   [{id, channel, recipient_label, body, send_status, delivery_status, acknowledged_at, provider, provider_message_id, is_mock, requested_by_name}]
counts          {open_tasks, unverified_exposure, affected_systems, messages}
server_time
```

### Enums (show status colors paired with these text labels)
| Field | Values |
|---|---|
| incident.status | `open`, `investigating`, `contained`, `recovering`, `closed` |
| severity / priority | `low`, `medium`, `high`, `critical` |
| scope.availability (file availability) | `available`, `degraded`, `locked`, `destroyed`, `unknown` |
| scope.copying (possible data copying) | `none_observed`, `suspected`, `confirmed`, `unknown` (display "unverified") |
| certainty | `observed`, `confirmed`, `unknown` |
| task.status | `open`, `in_progress`, `done`, `blocked` |
| notification.send_status (provider acceptance) | `pending`, `accepted`, `failed`, `unknown` |
| notification.delivery_status (confirmed delivery) | `unconfirmed`, `delivered`, `undeliverable` |
| notification.acknowledged_at (human ack) | timestamp or `null` |

## Command Center payload (`GET /api/dashboard`)
`{urgent_deadlines[], incidents[], affected_systems[], open_tasks[], unverified_exposure_count, recent_activity[], server_time}`
The first card shows `urgent_deadlines[0]` (for example "2:00 PM court filing — LIT-2291").

## Module ownership
| Module | Owner | Contract |
|---|---|---|
| `app/db.py`, `schemas.py`, `routers/*`, `services.py`, `security.py` | Core | this file |
| `app/triage/nemotron.py`, `triage/tools.py`, `detection/detector.py` | NVIDIA & Detection | `run(conn, incident)` returns `{provider, model, tool_calls, draft}`; the draft must validate as `schemas.TriageDraft` |
| `app/notify/photon.py` | Photon & Submission | `send(phone, body, channel, idempotency_key)` returns `{send_status, provider, provider_message_id, raw}` |
| `frontend/` | Lovable Frontend | builds against `fixtures/api/*.json`, then the live API |

## IT help requests → Nemotron IT task (owner: NVIDIA, Person 3)

A lawyer's "Request IT help" is **saved first**, then triaged. If triage fails, the request stays visible and can be retried.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/incidents/{id}/it-requests` | `{body, requester_label?, run_triage?: true}` | IT request (201). Saved before the model runs. |
| GET | `/it-requests/{rid}` | – | IT request (poll this on `/dev`) |
| POST | `/it-requests/{rid}/triage` | – | IT request. Retry after a failure, or rerun after records change. `409` if already running. |
| GET | `/incidents/{id}/it-requests` | – | all IT requests for the incident, newest first |
| POST | `/demo/it-fixture` | `{deadline_local?: "2026-11-08T14:00"}` | creates the fictional "locked filing exhibits" incident: `{incident_id, incident_code, sample_request}` |
| POST | `/demo/matters/{code}/deadline` | `{deadline_local: "2026-11-08T15:30" \| null}` (admin) | changes a fictional matter deadline, or removes it to test "unknown" |

**IT request shape**
```
{id, incident_id, body, requester_label, created_at, updated_at,
 triage: {status: pending|running|drafted|failed, can_retry, error, attempts,
          provider: "nemotron"|"fixture", is_live_nemotron, model,
          tool_calls: [{step, tool, requested_by: model|backend|fixture, scoped_to_incident, result_summary, result}],
          validation: [str]},                 ← what the backend corrected, e.g. replaced a stale time
 draft: null | {
   header: "Urgent · On-call IT", title, urgency: urgent|high|normal, suggested_team,
   issue, affected, why_urgent, first_action,
   deadline: {known, text, due_ct: "2:00 PM CT, Sun Nov 8", due_at, matter_code, matter_title, record_ref},
   evidence: [{ref: "EV-1"|"MATTER:LIT-4417", kind: evidence|filing_record, description, certainty}],
   file_copying: {status: unknown|suspected|confirmed|none_observed, label, basis},
   unknowns: [str], request_text}}
```

**Grounding rules the backend enforces**
- Tools are read-only and always run against the request's own incident. The model can't pick another one.
- If the model skips a tool, the backend runs it anyway and gives the model the results before it writes the draft.
- The deadline always comes from the matter record. A time in the model's text that disagrees with the record is replaced.
- File copying comes from records only. It stays **Unknown** unless a scope or evidence record says otherwise, and unverified "files were copied" claims are rewritten.
- Evidence refs must exist for this incident. Unknown refs are dropped and the filing record is always cited.
- With locked files and a deadline within 24 hours, urgency is at least **urgent**.

**Handoff to approval + Photon (team integration):** `app/it_triage/draft.py: task_fields(draft)` maps an approved draft to the existing `POST /incidents/{id}/tasks` body. `as_text_card(draft)` gives a plain-text version.
