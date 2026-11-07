# Vigil

A cyber incident response command center for a law firm. Built for **HackUTD 2026: Zero Day**.

Vigil is a separate place to document an incident, see which legal work is at risk, coordinate the response and alert people. It assumes the firm's own email, SSO and file systems may already be compromised.

```
Vigil/
├── frontend/   React app (built in Lovable, exported here)
└── backend/    FastAPI + SQLite API, fixtures, tests
```

## Run it locally

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

- First run creates the database and two accounts. Passwords are written to `backend/data/initial_credentials.txt`. That file is gitignored, so don't share it. To pick your own passwords, set `VIGIL_ADMIN_PASSWORD` and `VIGIL_RESPONDER_PASSWORD`.
- API docs: http://localhost:8000/api/docs
- If `frontend/dist` exists, the backend serves it at http://localhost:8000.
- Tests: `cd backend && python -m pytest -q`

## Demo flow
1. **Simulate attack**: `POST /api/demo/simulate` reads fictional logs and opens one incident. The `normal_activity` fixture produces no alert.
2. The incident shows **2:00 PM court filing at risk**, **Files locked** and **Data copying unverified**.
3. **Run AI triage**: the model calls the evidence, matter and responder tools and drafts tasks.
4. A responder **approves** the draft. Tasks are created and the approver is recorded. **Send alert** then sends one generic message.
5. A second browser posts "Backup copy located." Both sessions see it within 2 seconds, and the timeline records it.
6. An admin adds a responder. Everything works with the AI and Photon providers turned off.

## Security and isolation
- Separate Vigil accounts (PBKDF2 password hashes, random session tokens stored hashed, brute-force lockout). It doesn't depend on firm SSO or email.
- Roles are enforced on the server. Deactivating a user ends their sessions immediately.
- External providers are **off by default** (`VIGIL_NEMOTRON_ENABLED`, `VIGIL_PHOTON_ENABLED`). Mock results are labeled `is_mock` / `provider: "stub"`.
- Alerts carry only a generic incident code. Client and case details stay inside Vigil.
- All incidents, matters and logs are **synthetic**.
- API keys and the database stay on the server. Copy `backend/.env.example` and never commit `.env`.

## Team workflow
- `backend/API_CONTRACT.md` is the authority for routes and fields. Talk to the core owner before you change it.
- Short-lived branches off `main`. Merge order: **core → NVIDIA → Photon**. Run a browser smoke test after each merge.
