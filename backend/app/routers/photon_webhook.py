"""Secure Photon 2.0 webhook receiver for Vigil."""

import base64
import hashlib
import hmac
import os
import time
import json

from ..db import connect, now
from ..services import add_event
from ..task_claims import claim_task
from ..notify.commands import parse_command
from ..notify.sender_auth import find_authorized_it_sender, normalize_phone

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/webhooks", tags=["photon"])

MAX_WEBHOOK_AGE_SECONDS = 300


def verify_photon_signature(
    raw_body: bytes,
    headers,
    secret: str,
) -> bool:
    """Verify a Standard Webhooks HMAC-SHA256 signature."""

    webhook_id = headers.get("webhook-id", "")
    timestamp = headers.get("webhook-timestamp", "")
    signature_header = headers.get("webhook-signature", "")

    if not webhook_id or not timestamp or not signature_header:
        return False

    # Reject malformed metadata.
    if len(webhook_id) > 256 or "." in webhook_id:
        return False

    try:
        event_time = int(timestamp)
    except (ValueError, TypeError):
        return False

    # Reject expired and excessively future-dated requests.
    if abs(time.time() - event_time) > MAX_WEBHOOK_AGE_SECONDS:
        return False

    # Standard Webhooks secrets are base64-encoded.
    if not secret.startswith("whsec_"):
        return False

    try:
        key = base64.b64decode(
            secret.removeprefix("whsec_"),
            validate=True,
        )
    except (ValueError, base64.binascii.Error):
        return False

    if not key:
        return False

    signed_content = (
        f"{webhook_id}.{timestamp}.".encode("utf-8")
        + raw_body
    )

    expected_signature = "v1," + base64.b64encode(
        hmac.new(
            key,
            signed_content,
            hashlib.sha256,
        ).digest()
    ).decode("ascii")

    # Multiple signatures may be provided during key rotation.
    return any(
        hmac.compare_digest(expected_signature, signature)
        for signature in signature_header.split()
    )


def extract_message(payload):
    """Photon public OpenAPI: ReceivedImessageMessage + user/space snapshots.

    https://api.photon.codes/openapi.json (verified 2026-11-08).
    Fail closed when recipient metadata is absent, rather than guessing.
    """
    required = ("PHOTON_PROJECT_ID", "PHOTON_SPACE_ID", "PHOTON_AGENT_USER_ID",
                "PHOTON_AGENT_HANDLE", "PHOTON_TEST_SENDER")
    if any(not os.getenv(key) for key in required):
        raise HTTPException(503, "Photon inbound configuration incomplete")
    data = payload.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("object"), dict):
        raise HTTPException(400, "Invalid message envelope")
    obj = data["object"]
    sender, recipient, space, content = (obj.get(k) for k in ("sentBy", "receivedBy", "space", "content"))
    if not all(isinstance(v, dict) for v in (sender, recipient, space, content)):
        raise HTTPException(400, "Missing message snapshots")
    project = os.environ["PHOTON_PROJECT_ID"]
    if data.get("projectId") != project or any(v.get("projectId") != project for v in (obj, sender, recipient, space)):
        raise HTTPException(403, "Wrong Photon project")
    if (payload.get("source") != "imessage.photon" or obj.get("status") != "received"
            or any(v.get("platform") != "imessage" for v in (obj, sender, recipient, space))):
        raise HTTPException(403, "Wrong message platform or direction")
    if (space.get("id") != os.environ["PHOTON_SPACE_ID"] or space.get("kind") != "direct"
            or recipient.get("id") != os.environ["PHOTON_AGENT_USER_ID"]
            or recipient.get("handle") != os.environ["PHOTON_AGENT_HANDLE"]
            or recipient.get("kind") != "agent" or sender.get("kind") == "agent"
            or not isinstance(sender.get("id"), str) or not sender["id"]
            or sender["id"] == recipient["id"]
            or not isinstance(space.get("participantIds"), list)
            or not all(isinstance(item, str) for item in space["participantIds"])
            or set(space["participantIds"]) != {sender["id"], recipient["id"]}):
        raise HTTPException(403, "Wrong Photon recipient or space")
    if normalize_phone(sender.get("handle")) != normalize_phone(os.environ["PHOTON_TEST_SENDER"]) or not normalize_phone(sender.get("handle")):
        raise HTTPException(403, "Sender outside configured test recipient")
    if content.get("type") != "text" or content.get("format") != "plain":
        return sender["handle"], None
    text = content.get("text")
    return sender["handle"], text if isinstance(text, str) and len(text) <= 256 else None


def apply_command(conn, user, command):
    # An accepted real alert tied to an approved run is our activation record.
    alerts = conn.execute(
        """SELECT n.*, req.task_id AS authorized_task_id FROM notifications n
           LEFT JOIN triage_runs r ON r.id=n.triage_run_id AND r.incident_id=n.incident_id
           LEFT JOIN it_requests req ON req.incident_id=n.incident_id
             AND n.idempotency_key = printf('incident:%d:task:%d:user:%d:imessage',
                                           n.incident_id, req.task_id, n.recipient_user_id)
           JOIN incidents i ON i.id=n.incident_id
           WHERE n.recipient_user_id=? AND n.provider='photon' AND n.channel='imessage'
             AND n.send_status='accepted' AND (r.status='approved' OR req.task_id IS NOT NULL)
             AND i.status!='closed'""",
        (user["id"],)).fetchall()
    if command.action == "ack":
        pending = [n for n in alerts if not n["acknowledged_at"]]
        if command.incident_code:
            pending = [n for n in pending if conn.execute(
                "SELECT 1 FROM incidents WHERE id=? AND code=? COLLATE NOCASE",
                (n["incident_id"], command.incident_code)).fetchone()]
        incidents = {n["incident_id"] for n in pending}
        if len(incidents) > 1:
            return "ambiguous_ack: reply ACK <incident-code>"
        if not pending:
            return "no_outstanding_alert"
        for n in pending:
            conn.execute("UPDATE notifications SET acknowledged_at=?,updated_at=? WHERE id=? AND acknowledged_at IS NULL",
                         (now(), now(), n["id"]))
        add_event(conn, pending[0]["incident_id"], "alert_acknowledged",
                  "Responder acknowledged alert via signed Photon reply", user["id"],
                  {"notification_ids": [n["id"] for n in pending]})
        return "acknowledged"
    task = conn.execute("SELECT incident_id FROM tasks WHERE id=?", (command.task_id,)).fetchone()
    if not task or not any(n["incident_id"] == task["incident_id"] and
                           n["authorized_task_id"] in (None, command.task_id) for n in alerts):
        return "task_not_authorized"
    try:
        claimed = claim_task(conn, task["incident_id"], command.task_id, user)
    except HTTPException as exc:
        if exc.status_code not in (403, 404, 409):
            raise
        return "task_unavailable"
    return "claimed" if claimed else "task_unavailable"


@router.post("/photon")
async def receive_photon_webhook(request: Request):
    secret = os.getenv("PHOTON_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(503, "Photon webhook signing secret not configured")
    raw_body = await request.body()
    if len(raw_body) > 1024 * 1024:
        raise HTTPException(413, "Webhook payload too large")
    if not verify_photon_signature(raw_body, request.headers, secret):
        raise HTTPException(401, "Invalid Photon webhook signature")
    try:
        payload = json.loads(raw_body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid JSON")
    if not isinstance(payload, dict):
        raise HTTPException(400, "Expected JSON object")
    event_id = payload.get("id")
    event_type = payload.get("type")
    if not isinstance(event_id, str) or not 0 < len(event_id) <= 256 or not isinstance(event_type, str) or len(event_type) > 128:
        raise HTTPException(400, "Invalid event identity")
    sender, text = extract_message(payload) if event_type == "message.received" else (None, None)
    conn = connect()
    try:
        # Serialize deduplication and command writes; commit them together.
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT status FROM photon_webhook_events WHERE event_id=?", (event_id,)).fetchone()
        if existing and existing["status"] == "processed":
            conn.rollback()
            return {"ok": True, "result": "duplicate"}
        conn.execute("DELETE FROM photon_webhook_events WHERE event_id=?", (event_id,))
        conn.execute("INSERT INTO photon_webhook_events(event_id,event_type,received_at) VALUES (?,?,?)",
                     (event_id, event_type, now()))
        result = "ignored_event"
        if sender:
            user = find_authorized_it_sender(conn, sender)
            command = parse_command(text)
            result = "unauthorized_sender" if not user else "invalid_command"
            if user and command:
                result = apply_command(conn, user, command)
        conn.execute("UPDATE photon_webhook_events SET status='processed',processed_at=?,error=? WHERE event_id=?",
                     (now(), result, event_id))
        conn.commit()
        return {"ok": True, "result": result}
    except Exception:
        conn.rollback()
        # Leave no completed receipt: provider retries can safely reapply the transaction.
        raise HTTPException(503, "Photon processing temporarily unavailable")
    finally:
        conn.close()
