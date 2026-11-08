# Vigil frontend

Vigil uses the Lovable interface with React, TanStack Start, and Tailwind.

## Running with the Vigil backend

The app talks to the FastAPI backend in `../backend` through one client, `src/lib/api.ts`,
which follows `backend/API_CONTRACT.md`. Live data is the default.

```sh
# terminal 1 — backend (reads backend/.env; keys and webhook secrets stay server-side)
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# terminal 2 — this app (Vite proxies /api to http://127.0.0.1:8000)
cd frontend-new && npm install && npm run dev      # http://localhost:8080
```

In VS Code, **Terminal → Run Task… → Vigil: run app** starts both.

On Windows, use `.\.venv\Scripts\python.exe` in place of `.venv/bin/python` from the backend folder.

The home page links to the Lawyer, IT, and Admin sign-in screens. After sign-in,
the workspaces check for an active backend incident every three seconds. Admins
can manage accounts under **Manage access**. Create a responder with team role
**IT lead** to use the IT workspace.

To host the frontend separately, build with `VITE_API_BASE` set to the FastAPI
HTTPS endpoint including `/api`, and set `VIGIL_CORS_ORIGINS` on the backend to
the frontend origin. The local Vite proxy is for development. NVIDIA and
Photon secrets belong in the backend environment.

Demo controls live in the backend:

```sh
cd backend
.venv/bin/python -m scripts.simulate_attack reset    # clean slate (keeps users and matters)
.venv/bin/python -m scripts.simulate_attack          # ransomware detected -> VIG-001 appears on screen
.venv/bin/python -m scripts.simulate_attack normal   # a normal day -> nothing opens
```

- `VIGIL_API_TARGET=http://127.0.0.1:8001 npm run dev` points the proxy at a backend on another port.
- Sign in with a Vigil account (first-run credentials are in `backend/data/initial_credentials.txt`).
  Backend roles are `admin`/`responder`; the team role decides the flow: a **Litigation lead** can
  request filing help, an **IT lead** can claim the linked filing task.

### What each control calls

| UI | Route |
|---|---|
| Sign in / out | `POST /auth/login`, `POST /auth/logout` (token in sessionStorage) |
| Role workspaces | `GET /incidents` and `GET /incidents/{id}` (polled every 3 s) |
| Attack detection | Backend only: `cd backend && .venv/bin/python -m scripts.simulate_attack` (or `POST /api/demo/simulate`). Signed-in workspaces pick it up on the next poll |
| Incidents / Report incident | `GET /incidents`, `POST /incidents` |
| Incident workspace | `GET /incidents/{id}` (polled every 2 s); mutations replace it with their response |
| Status | `PATCH /incidents/{id}` |
| Request IT help (filing) | `POST /incidents/{id}/requests` → Nemotron drafts a linked IT task |
| Claim task / task status / add task | `POST …/tasks/{tid}/claim`, `PATCH …/tasks/{tid}`, `POST …/tasks` |
| Alert on-call IT (filing task) | `POST …/notify` with `task_id` (Photon iMessage) |
| Response room | `POST …/messages` |
| Scope | `POST …/scope`, `PATCH …/scope/{sid}` |
| AI triage → approve → alert → ack | `POST …/triage`, `POST …/approve`, `POST …/notify`, `POST …/notifications/{nid}/ack` |
| IT help · Nemotron draft | `POST …/it-requests`, `GET …/it-requests`, retry `POST /it-requests/{rid}/triage` |
| Access (admins) | `GET /users`, `POST /users`, `PATCH /users/{uid}` |

Nemotron drafts are labeled **Live Nemotron** or **Fixture — not live AI** from the backend's
`is_live_nemotron`. Incident-level AI triage is the backend's labeled mock. Alerts sent with Photon off
are labeled simulated.
