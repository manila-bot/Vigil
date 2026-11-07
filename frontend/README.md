# Vigil frontend

A working React starter (Vite, React, TypeScript, Tailwind), the same stack Lovable uses. It has all four screens: **Sign in**, **Command Center**, **Incident workspace** (Scope / Response Room / Timeline, plus the AI Triage panel) and **Access** (admin only).

## Run it

```bash
cd frontend
npm install
npm run dev:mock   # sample data, no backend needed → http://localhost:5173
npm run dev        # real backend (start it first on :8000) → http://localhost:5173
```

- **Sample data mode** signs in with anything and uses `src/mocks/*.json`. Those files are copied from `backend/fixtures/api/`, which is generated from the real API, so the shapes match. Nothing is saved.
- **Real mode** sends `/api` calls to FastAPI on port 8000. Sign in with the accounts in `backend/data/initial_credentials.txt`.
- **Demo build:** `npm run build` writes `frontend/dist`. The backend then serves the whole app at http://localhost:8000.

## Where things are

| File | What |
|---|---|
| `src/api/client.ts` | The one API client: token handling, errors, sign-out on 401 |
| `src/api/mock.ts` | Sample data mode |
| `src/components/ui.tsx` | `usePoll` (2-second live refresh + stale warning), status badges with text labels, banners |
| `src/components/Layout.tsx` | Navy sidebar |
| `src/pages/*.tsx` | The four screens |

## Rules to keep
- Every POST or PATCH under an incident returns the full incident. Replace state with the response (`act()` in `Incident.tsx`).
- Always pair status colors with text (the `Badge` component does this).
- Show **SIMULATED** wherever `is_mock`, `is_simulated` or `source: "simulated"` is set.
- Fields and routes: `../backend/API_CONTRACT.md`. Ask the core owner before you change them.

## Moving to Lovable
Lovable can't import an existing repo directly. Either keep editing this code in VS Code or Cursor, or paste these pages into Lovable as the starting point and keep `src/api/client.ts` as the only way the app calls the backend.
