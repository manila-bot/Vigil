"""AI triage -> human approval -> external alert. Core owns persistence and the safety rules;
the AI engine and the Photon adapter are pluggable modules."""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from ..db import get_db, now, row
from ..notify import photon
from ..schemas import ApproveIn, NotifyIn, TriageDraft
from ..security import current_user
from ..services import add_event, get_incident_or_404, incident_detail
from ..triage.engine import run_triage
from .users import mask_phone

router = APIRouter(prefix="/incidents/{incident_id}", tags=["response"])


def _validate_draft(conn, incident_id, draft) -> dict:
    parsed = TriageDraft.model_validate(draft)
    refs = {r["ref"] for r in conn.execute("SELECT ref FROM evidence WHERE incident_id = ?", (incident_id,))}
    for t in parsed.tasks:
        t.evidence_refs = [r for r in t.evidence_refs if r in refs]  # drop refs the model made up
        if t.owner_user_id is not None and not row(conn.execute(
                "SELECT id FROM users WHERE id = ? AND active = 1", (t.owner_user_id,))):
            t.owner_user_id = None
    parsed.evidence_refs = [r for r in parsed.evidence_refs if r in refs]
    return parsed.model_dump()


@router.post("/triage")
def triage(incident_id: int, user=Depends(current_user), conn=Depends(get_db)):
    inc = get_incident_or_404(conn, incident_id)
    # A new run replaces any pending draft.
    conn.execute("""UPDATE triage_runs SET status = 'rejected', error = 'Superseded by a newer run'
                    WHERE incident_id = ? AND status = 'draft'""", (incident_id,))
    cur = conn.execute(
        "INSERT INTO triage_runs (incident_id, status, provider, created_by, created_at) VALUES (?, 'running', '-', ?, ?)",
        (incident_id, user["id"], now()))
    run_id = cur.lastrowid
    try:
        result = run_triage(conn, inc)
        draft = _validate_draft(conn, incident_id, result["draft"])
        conn.execute(
            """UPDATE triage_runs SET status = 'draft', provider = ?, model = ?, tool_calls_json = ?, draft_json = ?
               WHERE id = ?""",
            (result["provider"], result.get("model"), json.dumps(result["tool_calls"], default=str),
             json.dumps(draft), run_id))
        label = " (MOCK)" if result["provider"] == "stub" else ""
        add_event(conn, incident_id, "triage_drafted",
                  f"AI triage{label} proposed {len(draft['tasks'])} tasks after {len(result['tool_calls'])} tool calls"
                  " — awaiting approval", user["id"], {"triage_id": run_id, "provider": result["provider"]})
    except (ValidationError, Exception) as exc:  # never leave a run 'running'
        conn.execute("UPDATE triage_runs SET status = 'failed', provider = 'error', error = ? WHERE id = ?",
                     (str(exc)[:500], run_id))
        add_event(conn, incident_id, "triage_failed", "AI triage failed — continue manually", user["id"],
                  {"triage_id": run_id})
    return incident_detail(conn, incident_id)


@router.post("/approve")
def approve(incident_id: int, body: ApproveIn, user=Depends(current_user), conn=Depends(get_db)):
    get_incident_or_404(conn, incident_id)
    run = row(conn.execute("SELECT * FROM triage_runs WHERE id = ? AND incident_id = ?", (body.triage_id, incident_id)))
    if not run:
        raise HTTPException(404, "Triage draft not found")
    if run["status"] != "draft":
        raise HTTPException(409, f"This draft is already {run['status']}")
    ts = now()
    if body.decision == "reject":
        conn.execute("UPDATE triage_runs SET status='rejected', decided_by=?, decided_at=? WHERE id=?",
                     (user["id"], ts, run["id"]))
        add_event(conn, incident_id, "triage_rejected", f"{user['name']} rejected the AI draft", user["id"],
                  {"triage_id": run["id"]})
        return incident_detail(conn, incident_id)

    draft = json.loads(run["draft_json"])
    chosen = range(len(draft["tasks"])) if body.task_indexes is None else body.task_indexes
    if any(i < 0 or i >= len(draft["tasks"]) for i in chosen):
        raise HTTPException(422, "task_indexes out of range")
    for i in chosen:
        t = draft["tasks"][i]
        conn.execute(
            """INSERT INTO tasks (incident_id, title, owner_user_id, owner_label, priority, due_at, source,
                                  evidence_refs_json, triage_run_id, approved_by, created_by, created_at, updated_at)
               VALUES (?,?,?,?,?,?, 'ai', ?,?,?,?,?,?)""",
            (incident_id, t["title"], t.get("owner_user_id"), t.get("owner_role"), t.get("priority", "high"),
             t.get("due_at"), json.dumps(t.get("evidence_refs", [])), run["id"], user["id"], user["id"], ts, ts))
    conn.execute("UPDATE triage_runs SET status='approved', decided_by=?, decided_at=? WHERE id=?",
                 (user["id"], ts, run["id"]))
    add_event(conn, incident_id, "triage_approved",
              f"{user['name']} approved the AI draft — {len(list(chosen))} tasks created; external alert enabled",
              user["id"], {"triage_id": run["id"], "task_indexes": list(chosen)})
    return incident_detail(conn, incident_id)


@router.post("/notify")
def notify(incident_id: int, body: NotifyIn, user=Depends(current_user), conn=Depends(get_db)):
    inc = get_incident_or_404(conn, incident_id)
    run = row(conn.execute(
        "SELECT * FROM triage_runs WHERE incident_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1",
        (incident_id,)))
    if not run:
        raise HTTPException(409, "Approve an AI triage draft before sending an external alert")
    recipient = row(conn.execute("SELECT * FROM users WHERE id = ? AND active = 1", (body.recipient_user_id,)))
    if not recipient:
        raise HTTPException(404, "Recipient not found")
    if not recipient["alert_opt_in"] or not recipient["phone"]:
        raise HTTPException(422, "Recipient has not consented to phone alerts (admin sets phone + opt-in)")

    key = f"incident:{incident_id}:triage:{run['id']}:user:{recipient['id']}:{body.channel}"
    existing = row(conn.execute("SELECT * FROM notifications WHERE idempotency_key = ?", (key,)))
    if existing and existing["send_status"] != "failed":
        # Already sent or outcome unknown: never resend blindly.
        if existing["send_status"] == "unknown" and existing["provider_message_id"]:
            checked = photon.check(existing["provider_message_id"])
            if checked:
                conn.execute("UPDATE notifications SET send_status=?, provider_response_json=?, updated_at=? WHERE id=?",
                             (checked["send_status"], json.dumps(checked.get("raw", {})), now(), existing["id"]))
        out = incident_detail(conn, incident_id)
        out["notify_result"] = {"duplicate": True, "notification_id": existing["id"]}
        return out

    msg = (f"VIGIL ALERT {inc['code']}: incident response activated. "
           "Sign in to Vigil for details. Reply ACK to acknowledge.")  # generic: no client or case details
    ts = now()
    if existing:  # previous attempt definitely failed -> retry on the same row
        nid = existing["id"]
        conn.execute("UPDATE notifications SET send_status='pending', updated_at=? WHERE id=?", (ts, nid))
    else:
        nid = conn.execute(
            """INSERT INTO notifications (incident_id, triage_run_id, idempotency_key, channel, recipient_user_id,
                                          recipient_label, body, provider, requested_by, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (incident_id, run["id"], key, body.channel, recipient["id"],
             f"{recipient['name']} ({mask_phone(recipient['phone'])})", msg,
             "photon" if photon.config.PHOTON_ENABLED else "stub", user["id"], ts, ts)).lastrowid
    conn.commit()  # claim the idempotency key before calling the provider

    try:
        result = photon.send(recipient["phone"], msg, body.channel, key)
    except TimeoutError as exc:
        result = {"send_status": "unknown", "provider": "photon", "provider_message_id": None,
                  "raw": {"error": f"timeout: {exc}"}}
    except Exception as exc:
        result = {"send_status": "failed", "provider": "photon", "provider_message_id": None,
                  "raw": {"error": str(exc)[:300]}}
    conn.execute(
        """UPDATE notifications SET send_status=?, provider=?, provider_message_id=?, provider_response_json=?,
                  updated_at=? WHERE id=?""",
        (result["send_status"], result["provider"], result.get("provider_message_id"),
         json.dumps(result.get("raw", {})), now(), nid))
    mock = " (SIMULATED)" if result["provider"] == "stub" else ""
    add_event(conn, incident_id, "alert_sent" if result["send_status"] == "accepted" else "alert_" + result["send_status"],
              f"Alert{mock} to {recipient['name']} via {body.channel}: provider {result['send_status']}", user["id"],
              {"notification_id": nid})
    out = incident_detail(conn, incident_id)
    out["notify_result"] = {"duplicate": False, "notification_id": nid, "send_status": result["send_status"]}
    return out


@router.post("/notifications/{notification_id}/ack")
def acknowledge(incident_id: int, notification_id: int, user=Depends(current_user), conn=Depends(get_db)):
    """Record a human acknowledgement (e.g. recipient replied ACK or called in)."""
    n = row(conn.execute("SELECT * FROM notifications WHERE id = ? AND incident_id = ?", (notification_id, incident_id)))
    if not n:
        raise HTTPException(404, "Notification not found")
    if not n["acknowledged_at"]:
        conn.execute("UPDATE notifications SET acknowledged_at=?, updated_at=? WHERE id=?", (now(), now(), n["id"]))
        add_event(conn, incident_id, "alert_acknowledged", f"Alert acknowledged by {n['recipient_label']} "
                                                            f"(recorded by {user['name']})", user["id"])
    return incident_detail(conn, incident_id)
