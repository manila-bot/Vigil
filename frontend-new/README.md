# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

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

Demo controls live in the backend, not the UI:

```sh
cd backend
.venv/bin/python -m scripts.simulate_attack reset    # clean slate (keeps users and matters)
.venv/bin/python -m scripts.simulate_attack          # ransomware detected -> VIG-001 appears on screen
.venv/bin/python -m scripts.simulate_attack normal   # a normal day -> nothing opens
```

- `npm run dev:mock` runs the fictional sample scenario with no backend (`VITE_USE_MOCKS=1`).
  The header says "Sample mode · fictional data" whenever it is on.
- `VIGIL_API_TARGET=http://127.0.0.1:8001 npm run dev` points the proxy at a backend on another port.
- Sign in with a Vigil account (first-run credentials are in `backend/data/initial_credentials.txt`).
  Backend roles are `admin`/`responder`; the team role decides the flow: a **Litigation lead** can
  request filing help, an **IT lead** can claim the linked filing task.

### What each control calls

| UI | Route |
|---|---|
| Sign in / out | `POST /auth/login`, `POST /auth/logout` (token in sessionStorage) |
| Command Center | `GET /dashboard` (polled every 2 s), `GET /system/status` |
| Attack detection | Backend only: `cd backend && .venv/bin/python -m scripts.simulate_attack` (or `POST /api/demo/simulate`). The Command Center picks it up within 2 s; there is no button in the app |
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
