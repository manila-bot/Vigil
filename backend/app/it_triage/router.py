"""IT help request -> Nemotron triage -> IT task draft.

Integration points (see API_CONTRACT.md "IT help requests"):
  Person 2 (form):        POST /api/incidents/{id}/it-requests  {body, requester_label?}
  /dev review:            GET  /api/it-requests/{rid}    (poll)   ·  POST /api/it-requests/{rid}/triage (retry/rerun)
  Approval + Photon:      draft -> draft.task_fields(draft) -> existing task + notify flow (team integration)
"""
import json
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import config
from ..db import _local_tz, get_db, now, row, rows
from ..notify.sender_auth import find_authorized_it_sender
from ..routers.response import notify
from ..schemas import NotifyIn
from ..security import current_user, require_admin
from ..services import add_event, get_incident_or_404, next_incident_code
from . import agent, store
from .client import ProviderError
from .draft import ground, task_fields

log = logging.getLogger("vigil.it_triage")
router = APIRouter(tags=["it-requests"])


class ITRequestIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    requester_label: str | None = Field(None, max_length=120)
    run_triage: bool = True


def _run_triage(conn, rid: int, user: dict) -> dict:
    req = store.get(conn, rid)
    incident = get_incident_or_404(conn, req["incident_id"])
    started = conn.execute(
        "UPDATE nemotron_it_requests SET triage_status='running', triage_error=NULL, attempts=attempts+1, updated_at=? "
        "WHERE id=? AND triage_status!='running'", (now(), rid),
    )
    if not started.rowcount:
        raise HTTPException(409, "Triage is already running for this request")
    conn.commit()  # the saved request stays visible even if the model call below fails
    task_id = None
    try:
        result = agent.run(conn, incident, req)
        draft, notes = ground(result["model_draft"], result["evidence"], result["matters"], req["body"])
        conn.execute(
            """UPDATE nemotron_it_requests SET triage_status='drafted', provider=?, model=?, tool_calls_json=?, draft_json=?,
                      validation_json=?, updated_at=? WHERE id=?""",
            (result["provider"], result["model"], json.dumps(result["tool_calls"], default=str), json.dumps(draft),
             json.dumps(notes), now(), rid))
        workspace = row(conn.execute(
            """SELECT r.id, r.task_id, m.matter_code, m.deadline_at FROM workspace_triage_links l
               JOIN it_requests r ON r.id = l.request_id JOIN matters m ON m.id = r.matter_id
               WHERE l.triage_id = ?""", (rid,),
        ))
        if workspace and not workspace["task_id"]:
            task = task_fields(draft)
            ts = now()
            task_id = conn.execute(
                """INSERT INTO tasks (incident_id, title, owner_label, priority, due_at, source,
                                      evidence_refs_json, created_by, created_at, updated_at)
                   VALUES (?, ?, 'On-call IT', ?, ?, ?, ?, ?, ?, ?)""",
                (incident["id"], task["title"], task["priority"], workspace["deadline_at"],
                 "ai" if result["provider"] == "nemotron" else "manual", json.dumps(task["evidence_refs"]),
                 req["submitted_by"], ts, ts),
            ).lastrowid
            conn.execute("UPDATE it_requests SET task_id = ? WHERE id = ?", (task_id, workspace["id"]))
        label = "Nemotron (live)" if result["provider"] == "nemotron" else "FIXTURE (not live AI)"
        add_event(conn, incident["id"], "it_task_drafted", f"IT task drafted by {label}: {draft['title']}",
                  user["id"], {"it_request_id": rid, "provider": result["provider"]})
        conn.commit()
    except ProviderError as exc:
        conn.rollback()
        log.warning("Nemotron triage failed for request %s: %s | %s", rid, exc.public, exc.detail)
        _fail(conn, rid, incident["id"], user, exc.public)
        task_id = None
    except Exception:  # never lose the request or leave it 'running'
        conn.rollback()
        log.exception("IT triage crashed for request %s", rid)
        _fail(conn, rid, incident["id"], user, "Triage failed unexpectedly.")
        task_id = None
    if task_id is not None and config.PHOTON_ENABLED:
        recipient = find_authorized_it_sender(conn, os.getenv("PHOTON_TEST_SENDER", ""))
        if recipient:
            try:
                notify(incident["id"], NotifyIn(recipient_user_id=recipient["id"], task_id=task_id), user, conn)
            except Exception:
                conn.rollback()
                log.exception("Could not alert on filing task %s", task_id)
                add_event(conn, incident["id"], "alert_failed",
                          "Phone alert unavailable. IT can claim the task in Vigil.", user["id"], {"task_id": task_id})
        else:
            add_event(conn, incident["id"], "alert_skipped",
                      "No eligible on-call phone recipient. IT can claim the task in Vigil.",
                      user["id"], {"task_id": task_id})
    return store.payload(store.get(conn, rid))


def _fail(conn, rid, incident_id, user, message):
    conn.execute("UPDATE nemotron_it_requests SET triage_status='failed', triage_error=?, updated_at=? WHERE id=?",
                 (f"{message} The request is saved. You can retry triage.", now(), rid))
    add_event(conn, incident_id, "it_triage_failed", f"IT triage failed ({message}). Request saved; retry available.",
              user["id"], {"it_request_id": rid})


@router.post("/incidents/{incident_id}/it-requests", status_code=201)
def submit_request(incident_id: int, body: ITRequestIn, user=Depends(current_user), conn=Depends(get_db)):
    get_incident_or_404(conn, incident_id)
    rid = store.create(conn, incident_id, body.body.strip(), body.requester_label, user["id"])
    who = body.requester_label or user["name"]
    add_event(conn, incident_id, "it_request", f"IT help requested by {who}: \"{body.body.strip()[:160]}\"",
              user["id"], {"it_request_id": rid})
    conn.commit()  # saved before any model call
    if body.run_triage:
        return _run_triage(conn, rid, user)
    return store.payload(store.get(conn, rid))


@router.post("/it-requests/{request_id}/triage")
def retry_triage(request_id: int, user=Depends(current_user), conn=Depends(get_db)):
    req = store.get(conn, request_id)
    if not req:
        raise HTTPException(404, "IT request not found")
    if req["triage_status"] == "running":
        raise HTTPException(409, "Triage is already running for this request")
    return _run_triage(conn, request_id, user)


@router.get("/it-requests/{request_id}")
def get_request(request_id: int, user=Depends(current_user), conn=Depends(get_db)):
    req = store.get(conn, request_id)
    if not req:
        raise HTTPException(404, "IT request not found")
    return store.payload(req)


@router.get("/incidents/{incident_id}/it-requests")
def list_requests(incident_id: int, user=Depends(current_user), conn=Depends(get_db)):
    get_incident_or_404(conn, incident_id)
    return [store.payload(r) for r in rows(conn.execute(
        "SELECT * FROM nemotron_it_requests WHERE incident_id = ? ORDER BY id DESC", (incident_id,)))]


# ---------------- demo fixture (fictional data only) ----------------

class FixtureIn(BaseModel):
    deadline_local: str | None = None   # e.g. "2026-11-08T14:00" (Central Time); default from fixture file


class DeadlineIn(BaseModel):
    deadline_local: str | None          # None = remove the deadline (tests the 'unknown' path)


def _to_utc(local_str: str) -> str:
    try:
        dt = datetime.fromisoformat(local_str)
    except ValueError:
        raise HTTPException(422, "deadline_local must look like 2026-11-08T14:00")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_local_tz())  # fixture times are Central Time
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


@router.post("/demo/it-fixture", status_code=201)
def seed_fixture(body: FixtureIn = FixtureIn(), user=Depends(current_user), conn=Depends(get_db)):
    """Create the 'locked filing exhibits' incident from fixtures/it_triage/exhibits_incident.json."""
    fx = json.loads((config.FIXTURES_DIR / "it_triage" / "exhibits_incident.json").read_text())
    ts = now()
    iid = conn.execute(
        """INSERT INTO incidents (code, title, status, severity, category, summary, detected_at, source, created_by,
                                  created_at, updated_at) VALUES (?,?,'open','critical',?,?,?, 'simulated', ?,?,?)""",
        (next_incident_code(conn), fx["incident"]["title"], fx["incident"]["category"], fx["incident"]["summary"],
         ts, user["id"], ts, ts)).lastrowid
    mt = fx["matter"]
    conn.execute(
        """INSERT INTO matters (matter_code, client_label, title, practice_area, lead_name, lead_role, deadline_at,
                                deadline_label, path_prefix, is_simulated) VALUES (?,?,?,?,?,?,?,?,?,1)
           ON CONFLICT(matter_code) DO UPDATE SET deadline_at=excluded.deadline_at, deadline_label=excluded.deadline_label""",
        (mt["matter_code"], mt["client_label"], mt["title"], mt["practice_area"], mt["lead_name"], mt["lead_role"],
         _to_utc(body.deadline_local or mt["deadline_local"]), mt["deadline_label"], mt["path_prefix"]))
    mid = row(conn.execute("SELECT id FROM matters WHERE matter_code = ?", (mt["matter_code"],)))["id"]
    for n, e in enumerate(fx["evidence"], start=1):
        conn.execute(
            """INSERT INTO evidence (incident_id, ref, kind, observed_at, description, certainty, is_simulated, created_at)
               VALUES (?,?,?,?,?,?,1,?)""", (iid, f"EV-{n}", e["kind"], ts, e["description"], e["certainty"], ts))
    for s in fx["scope"]:
        conn.execute(
            """INSERT INTO scope_items (incident_id, system, data_category, matter_id, availability, copying, certainty,
                                        notes, updated_at) VALUES (?,?,?,?,?,?,?,?,?)""",
            (iid, s["system"], s["data_category"], mid, s["availability"], s["copying"], s["certainty"], s["notes"], ts))
    add_event(conn, iid, "detection", "[SIMULATED] IT-help demo incident created from fixture", user["id"])
    return {"incident_id": iid, "incident_code": row(conn.execute("SELECT code FROM incidents WHERE id=?", (iid,)))["code"],
            "sample_request": fx["sample_request"]}


@router.post("/demo/matters/{matter_code}/deadline")
def set_matter_deadline(matter_code: str, body: DeadlineIn, admin=Depends(require_admin), conn=Depends(get_db)):
    """Change a fictional matter's deadline (to verify a rerun uses the new time)."""
    if not row(conn.execute("SELECT id FROM matters WHERE matter_code = ?", (matter_code,))):
        raise HTTPException(404, "Matter not found")
    due = _to_utc(body.deadline_local) if body.deadline_local else None
    conn.execute("UPDATE matters SET deadline_at = ? WHERE matter_code = ?", (due, matter_code))
    return {"matter_code": matter_code, "deadline_at": due}
