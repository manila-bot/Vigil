# Photon demo on the Mac

Use the repository root, not the accidental nested `Vigil/` directory.
The default database is `backend/data/vigil.db`; `VIGIL_DB_PATH` can override it.
No existing accounts or databases were replaced. The inspected Mac database contains
one active, opted-in IT Lead (user 5); two older IT Lead accounts are inactive.
Reuse the active account and verify its phone in Access → Configure.

## Configuration and launch

Put private settings in `backend/.env` using the names in `backend/.env.example`.
Do not paste credentials into chat or Git. Set `VIGIL_PHOTON_ENABLED=1` for live sending.
`PHOTON_TEST_SENDER` is the personal receiving phone; `PHOTON_AGENT_HANDLE` is the
Photon agent's handle. The configured space must be their direct conversation.

From the root:

```sh
backend/.venv/bin/python backend/scripts/photon_preflight.py
```

In separate terminals:

```sh
cd backend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```sh
npm --prefix frontend run dev
```

Open http://127.0.0.1:5173 and sign in with your existing account.
The Vite `/api` proxy targets `127.0.0.1:8000`; normal dev does not enable sample data.
Restart the backend after editing `.env`. Do not run `dev:mock` for the phone demo.

## Live checklist

1. Run preflight until ready. In Access, verify the existing IT Lead is active,
   has role Responder, team role IT lead, the personal phone, and consent enabled.
2. Detect the synthetic ransomware incident using the existing simulation control.
   Run triage, review the recommendations, then approve. Nemotron only runs live
   when its provider is separately enabled and configured; otherwise UI labels it mock.
3. Ensure at least one task is open and unassigned. The Tasks list displays the
   actual task ID; use that ID in `TAKE`, not an assumed `1`.
4. Start a temporary free Cloudflare Quick Tunnel (requires `cloudflared`, which
   was unavailable during implementation):
   `cloudflared tunnel --url http://127.0.0.1:8000 --protocol http2`.
   On a Mac with Homebrew, the free prerequisite is `brew install cloudflared`.
5. In Photon, set the destination to the newly printed HTTPS tunnel URL plus
   `/api/webhooks/photon`, subscribe to `message.received`, and enable it.
   Match its signing secret to the private local configuration.
6. Use the incident's alert control to send to the configured test responder only.
   Verify the iMessage on the phone. Provider acceptance alone is not confirmed delivery.
7. Reply `ACK`. Expect an acknowledgment timestamp in the incident's notifications
   and an `alert_acknowledged` timeline entry within the two-second polling interval.
   If multiple incidents have pending alerts, reply `ACK <incident-code>`.
8. Reply `TAKE <displayed-task-id>`. Expect the responder as owner, In progress,
   and a `task_claimed` timeline entry. Claimed tasks cannot be stolen.
9. Disable the Photon destination and stop the tunnel with Ctrl+C after testing.

Live verification on November 8, 2026:

- Restored private local configuration; Photon API authentication returned HTTP 200.
- Confirmed exactly one authorized IT Lead matches the configured test recipient.
- Installed Cloudflare Tunnel and verified public health HTTP 200 and unsigned webhook HTTP 401.
- Updated and enabled the existing incoming-message destination for the temporary test tunnel.
- Sent one connectivity test iMessage: Photon returned HTTP 202 and the user confirmed arrival.
- Received a real signed incoming ACK. Vigil processed it with `no_outstanding_alert`:
  no incident notification existed, so no acknowledgment or task state changed.
- Live incident acknowledgment, task claiming, and resulting dashboard updates remain unverified.
- Triage is blocked because Nemotron is enabled locally but its module is not implemented.
  Implement that provider, or explicitly use the labeled mock triage for Photon testing.

The temporary tunnel and destination were enabled for the test; disable the destination
and stop the tunnel when testing ends. Never reuse an expired Quick Tunnel URL.
Browser visual QA was unavailable in this environment; the production build and HTTP proxy were checked.

## Security and processing contract

Field mappings were checked against Photon's official public schema:
https://api.photon.codes/openapi.json and
https://photon.codes/docs/beta/api-reference/messages/get-a-message (2026-11-08).
The receiver uses `ReceivedImessageMessage`, `ImessageUserSnapshot`, and
`ImessageSpaceSnapshot`: `sentBy.handle`, `receivedBy.id/handle`,
`space.id/participantIds`, and plain-text `content.text`.
Missing recipient metadata fails closed and needs investigation using the official
schema, without logging raw messages or phone numbers.

Signatures cover raw bytes with a five-minute timestamp tolerance. An unconfigured
secret returns 503; missing/invalid signatures with a configured secret return 401.
Wrong project, platform, direct space, agent, or test phone returns 403. Invalid
JSON returns 400. Unsupported events are recorded as ignored. Recognized messages
from unauthorized accounts and invalid/ambiguous commands return 200 with a safe
result reason and no privileged changes. No automatic feedback iMessage is sent.

The existing model has no separate activated flag: an accepted Photon iMessage
notification tied to an approved triage run and a non-closed incident establishes
activation and responder authorization. Stub, failed, pending, and unknown sends
cannot authorize inbound actions. ACK considers only that responder's outstanding
alerts. TAKE resolves the task's incident and requires that responder's accepted alert.

A `BEGIN IMMEDIATE` transaction serializes event-ID deduplication, conditional task
claiming/acknowledgment, timeline records, and the processed receipt. Terminal no-op
reasons are stored in the existing event table's `error` field; no message body or
phone is stored there. Internal failures roll back everything and return 503 for
safe retry. Repeated ACK/TAKE under different event IDs also cannot duplicate actions.
Manual acknowledgment is restricted to the recipient or an admin.

## Verification

```sh
backend/.venv/bin/python -m pytest -q
npm --prefix frontend run build
```

Tests use isolated temporary databases, signed synthetic messages, and mocked
Photon HTTP calls. They do not constitute a real Photon delivery demonstration.
