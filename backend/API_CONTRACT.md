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
