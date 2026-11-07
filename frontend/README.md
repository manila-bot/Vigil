# Vigil frontend (Lovable → React)

The React app is built in **one Lovable project with one editor**, then exported here.

## Build against fixtures first
Example responses for every screen are in `../backend/fixtures/api/`:

| Screen | Fixture |
|---|---|
| Sign in | `login.json` |
| Command Center | `dashboard.json`, `system_status.json` |
| Incident: Scope / Response Room / Timeline | `incident_after_simulate.json`, `incident_full.json` |
| AI Triage panel (draft awaiting approval) | `incident_with_triage_draft.json` |
| Access (admin) | `users_admin_view.json` |
| Simulate attack with no alert | `simulate_normal.json` |

Field meanings and enums: `../backend/API_CONTRACT.md`.

## Then switch to the live API
- Use one API client. Base URL `/api` (same origin in the final demo). During Lovable development, set the backend env `VIGIL_CORS_ORIGINS=<your Lovable preview URL>`.
- Send `Authorization: Bearer <token>` on every call. On a `401`, go to Sign in.
- Poll `GET /api/incidents/{id}` every 2 seconds. Every POST or PATCH under an incident returns the full incident, so replace your state with the response.
- Show `triage.is_mock` and `notifications[].is_mock` as a visible **SIMULATED** label.

## Export for the demo
Build to `frontend/dist`. The backend serves it at http://localhost:8000.
