"""Incidents, scope, evidence, chat, tasks and the Command Center summary."""
import json

from fastapi import APIRouter, Depends, HTTPException

from ..db import get_db, now, row, rows
from ..schemas import (EvidenceCreate, IncidentCreate, IncidentUpdate, MessageCreate, ScopeCreate, ScopeUpdate,
                       ITRequestCreate, TaskCreate, TaskUpdate)
from ..security import current_user
from ..services import add_event, get_incident_or_404, incident_detail, local_time_label, next_incident_code

from ..task_claims import claim_task as claim_task_service
from ..it_triage import store as it_triage_store
from ..it_triage.router import _run_triage

router = APIRouter(tags=["incidents"])

LABELS = {
    "availability": {"available": "available", "degraded": "degraded", "locked": "locked",
                     "destroyed": "destroyed", "unknown": "unknown"},
    "copying": {"none_observed": "no copying observed", "suspected": "copying suspected",
                "confirmed": "copying confirmed", "unknown": "copying unverified"},
}


@router.get("/dashboard")
def dashboard(user=Depends(current_user), conn=Depends(get_db)):
    """Command Center: urgent deadlines first, then open incidents, tasks, exposure and activity."""
    incidents = rows(conn.execute(
        "SELECT * FROM incidents WHERE status != 'closed' ORDER BY updated_at DESC"))
    urgent = rows(conn.execute(
        """SELECT m.matter_code, m.title, m.client_label, m.deadline_at, m.deadline_label, m.lead_name, m.lead_role,
                  s.incident_id, i.code AS incident_code,
                  GROUP_CONCAT(DISTINCT s.availability) AS availability, GROUP_CONCAT(DISTINCT s.copying) AS copying
           FROM scope_items s JOIN matters m ON m.id = s.matter_id JOIN incidents i ON i.id = s.incident_id
           WHERE i.status != 'closed' AND s.availability != 'available' AND m.deadline_at IS NOT NULL
           GROUP BY m.id, s.incident_id ORDER BY m.deadline_at"""))
    for u in urgent:
        u["deadline_local"] = local_time_label(u["deadline_at"])
        u["availability"] = (u["availability"] or "").split(",")
        u["copying"] = (u["copying"] or "").split(",")
    affected = rows(conn.execute(
        """SELECT s.system, s.availability, s.incident_id FROM scope_items s JOIN incidents i ON i.id = s.incident_id
           WHERE i.status != 'closed' AND s.availability != 'available' GROUP BY s.system, s.incident_id"""))
    open_tasks = rows(conn.execute(
        """SELECT t.id, t.incident_id, t.title, t.status, t.priority, t.due_at, t.owner_label, u.name AS owner_name
           FROM tasks t JOIN incidents i ON i.id = t.incident_id LEFT JOIN users u ON u.id = t.owner_user_id
           WHERE i.status != 'closed' AND t.status != 'done' ORDER BY t.due_at IS NULL, t.due_at LIMIT 20"""))
    unverified = conn.execute(
        """SELECT COUNT(*) FROM scope_items s JOIN incidents i ON i.id = s.incident_id
           WHERE i.status != 'closed' AND s.copying IN ('unknown','suspected')""").fetchone()[0]
    activity = rows(conn.execute(
        """SELECT t.id, t.incident_id, i.code AS incident_code, t.at, t.kind, t.summary, u.name AS actor_name
           FROM timeline_events t JOIN incidents i ON i.id = t.incident_id LEFT JOIN users u ON u.id = t.actor_user_id
           ORDER BY t.at DESC, t.id DESC LIMIT 15"""))
    return {"urgent_deadlines": urgent, "incidents": incidents, "affected_systems": affected,
            "open_tasks": open_tasks, "unverified_exposure_count": unverified,
            "recent_activity": activity, "server_time": now()}


@router.get("/incidents")
def list_incidents(user=Depends(current_user), conn=Depends(get_db)):
    return rows(conn.execute(
        """SELECT i.*, (SELECT COUNT(*) FROM tasks t WHERE t.incident_id = i.id AND t.status != 'done') AS open_tasks
           FROM incidents i ORDER BY i.status = 'closed', i.updated_at DESC"""))


@router.post("/incidents", status_code=201)
def create_incident(body: IncidentCreate, user=Depends(current_user), conn=Depends(get_db)):
    ts = now()
    cur = conn.execute(
        """INSERT INTO incidents (code, title, severity, category, summary, detected_at, source, created_by,
                                  created_at, updated_at) VALUES (?,?,?,?,?,?, 'manual', ?,?,?)""",
        (next_incident_code(conn), body.title.strip(), body.severity, body.category, body.summary,
         body.detected_at or ts, user["id"], ts, ts))
    add_event(conn, cur.lastrowid, "incident_created", f"Incident opened: {body.title.strip()}", user["id"])
    return incident_detail(conn, cur.lastrowid)


@router.get("/incidents/{incident_id}")
def get_incident(incident_id: int, user=Depends(current_user), conn=Depends(get_db)):
    return incident_detail(conn, incident_id)


@router.patch("/incidents/{incident_id}")
def update_incident(incident_id: int, body: IncidentUpdate, user=Depends(current_user), conn=Depends(get_db)):
    inc = get_incident_or_404(conn, incident_id)
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None and v != inc[k]}
    if changes:
        sets = ", ".join(f"{k} = ?" for k in changes)
        conn.execute(f"UPDATE incidents SET {sets} WHERE id = ?", (*changes.values(), incident_id))
        parts = [f"{k} {inc[k]} → {v}" if k in ("status", "severity") else f"{k} updated" for k, v in changes.items()]
        add_event(conn, incident_id, "incident_updated", "; ".join(parts).capitalize(), user["id"],
                  {k: {"from": inc[k], "to": v} for k, v in changes.items()})
    return incident_detail(conn, incident_id)


# ---- Scope ----

def _matter_id(conn, code):
    if not code:
        return None
    m = row(conn.execute("SELECT id FROM matters WHERE matter_code = ?", (code,)))
    if not m:
        raise HTTPException(422, f"Unknown matter code {code}")
    return m["id"]


@router.post("/incidents/{incident_id}/scope", status_code=201)
def add_scope(incident_id: int, body: ScopeCreate, user=Depends(current_user), conn=Depends(get_db)):
    get_incident_or_404(conn, incident_id)
    conn.execute(
        """INSERT INTO scope_items (incident_id, system, data_category, matter_id, availability, copying, certainty,
                                    notes, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (incident_id, body.system, body.data_category, _matter_id(conn, body.matter_code), body.availability,
         body.copying, body.certainty, body.notes, user["id"], now()))
    add_event(conn, incident_id, "scope_added",
              f"Scope added: {body.system} / {body.data_category} — {LABELS['availability'][body.availability]}, "
              f"{LABELS['copying'][body.copying]} ({body.certainty})", user["id"])
    return incident_detail(conn, incident_id)


@router.patch("/incidents/{incident_id}/scope/{scope_id}")
def update_scope(incident_id: int, scope_id: int, body: ScopeUpdate, user=Depends(current_user),
                 conn=Depends(get_db)):
    item = row(conn.execute("SELECT * FROM scope_items WHERE id = ? AND incident_id = ?", (scope_id, incident_id)))
    if not item:
        raise HTTPException(404, "Scope item not found")
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None and v != item[k]}
    if changes:
        sets = ", ".join(f"{k} = ?" for k in changes)
        conn.execute(f"UPDATE scope_items SET {sets}, updated_by = ?, updated_at = ? WHERE id = ?",
                     (*changes.values(), user["id"], now(), scope_id))
        desc = []
        for k, v in changes.items():
            if k in LABELS:
                desc.append(f"{k}: {LABELS[k][item[k]]} → {LABELS[k][v]}")
            elif k == "certainty":
                desc.append(f"certainty: {item[k]} → {v}")
            else:
                desc.append("notes updated")
        add_event(conn, incident_id, "scope_updated", f"{item['system']} / {item['data_category']}: " + "; ".join(desc),
                  user["id"], {"scope_id": scope_id, **{k: {"from": item[k], "to": v} for k, v in changes.items()}})
    return incident_detail(conn, incident_id)


# ---- Evidence ----

@router.post("/incidents/{incident_id}/evidence", status_code=201)
def add_evidence(incident_id: int, body: EvidenceCreate, user=Depends(current_user), conn=Depends(get_db)):
    get_incident_or_404(conn, incident_id)
    n = conn.execute("SELECT COUNT(*) FROM evidence WHERE incident_id = ?", (incident_id,)).fetchone()[0] + 1
    conn.execute(
        """INSERT INTO evidence (incident_id, ref, kind, observed_at, description, certainty, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (incident_id, f"EV-{n}", body.kind, body.observed_at or now(), body.description, body.certainty,
         user["id"], now()))
    add_event(conn, incident_id, "evidence_added", f"Evidence EV-{n} recorded: {body.description[:120]}", user["id"])
    return incident_detail(conn, incident_id)


# ---- Response Room (chat) ----

@router.post("/incidents/{incident_id}/messages", status_code=201)
def post_message(incident_id: int, body: MessageCreate, user=Depends(current_user), conn=Depends(get_db)):
    get_incident_or_404(conn, incident_id)
    cur = conn.execute("INSERT INTO messages (incident_id, user_id, body, created_at) VALUES (?,?,?,?)",
                       (incident_id, user["id"], body.body, now()))
    add_event(conn, incident_id, "message", f"{user['name']}: {body.body[:200]}", user["id"],
              {"message_id": cur.lastrowid})
    return incident_detail(conn, incident_id)


@router.get("/incidents/{incident_id}/messages")
def list_messages(incident_id: int, after_id: int = 0, user=Depends(current_user), conn=Depends(get_db)):
    """Cheap poll for chat: only messages newer than after_id."""
    get_incident_or_404(conn, incident_id)
    return rows(conn.execute(
        """SELECT m.id, m.body, m.created_at, m.user_id, u.name AS user_name, u.team_role FROM messages m
           JOIN users u ON u.id = m.user_id WHERE m.incident_id = ? AND m.id > ? ORDER BY m.id""",
        (incident_id, after_id)))


# ---- Tasks ----

@router.post("/incidents/{incident_id}/requests")
def request_it_help(incident_id: int, body: ITRequestCreate, user=Depends(current_user), conn=Depends(get_db)):
    if (user["team_role"] or "").strip().lower() not in {"litigation lead", "lawyer"}:
        raise HTTPException(403, "Only litigation responders can request filing help")
    message = body.body.strip()
    if not message:
        raise HTTPException(422, "Enter a request for IT")

    conn.execute("BEGIN IMMEDIATE")
    incident = get_incident_or_404(conn, incident_id)
    matter = row(conn.execute(
        """SELECT m.id, m.deadline_at FROM matters m WHERE m.matter_code = ?
           AND EXISTS (SELECT 1 FROM scope_items WHERE incident_id = ? AND matter_id = m.id)""",
        (body.matter_code, incident_id),
    ))
    if not matter or not matter["deadline_at"]:
        raise HTTPException(422, "Choose a filing linked to this incident")
    request = row(conn.execute(
        "SELECT id FROM it_requests WHERE incident_id = ? AND matter_id = ? AND requester_id = ?",
        (incident_id, matter["id"], user["id"]),
    ))
    if request:
        request_id = request["id"]
    else:
        if incident["status"] == "closed":
            raise HTTPException(409, "This incident is closed")
        ts = now()
        request_id = conn.execute(
            "INSERT INTO it_requests (incident_id, matter_id, requester_id, body, created_at) VALUES (?,?,?,?,?)",
            (incident_id, matter["id"], user["id"], message, ts),
        ).lastrowid
        triage_id = it_triage_store.create(conn, incident_id, message, user["name"], user["id"])
        conn.execute("INSERT INTO workspace_triage_links VALUES (?, ?)", (request_id, triage_id))
        add_event(conn, incident_id, "it_help_requested", f"IT help requested for {body.matter_code}", user["id"],
                  {"request_id": request_id, "it_request_id": triage_id})
        _run_triage(conn, triage_id, user)

    detail = incident_detail(conn, incident_id)
    status = next(item["status"] for item in detail["requests"] if item["id"] == request_id)
    return {**detail, "request_id": request_id, "request_status": status}


@router.post("/incidents/{incident_id}/tasks/{task_id}/claim")
def claim_task(incident_id: int, task_id: int, user=Depends(current_user), conn=Depends(get_db)):
    claim_task_service(conn, incident_id, task_id, user)
    return incident_detail(conn, incident_id)


def _check_owner(conn, owner_user_id):
    if owner_user_id is not None and not row(conn.execute(
            "SELECT id FROM users WHERE id = ? AND active = 1", (owner_user_id,))):
        raise HTTPException(422, "Owner must be an active Vigil user")


@router.post("/incidents/{incident_id}/tasks", status_code=201)
def create_task(incident_id: int, body: TaskCreate, user=Depends(current_user), conn=Depends(get_db)):
    get_incident_or_404(conn, incident_id)
    _check_owner(conn, body.owner_user_id)
    ts = now()
    conn.execute(
        """INSERT INTO tasks (incident_id, title, owner_user_id, owner_label, priority, due_at, source,
                              evidence_refs_json, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?, 'manual', ?,?,?,?)""",
        (incident_id, body.title, body.owner_user_id, body.owner_label, body.priority, body.due_at,
         json.dumps(body.evidence_refs), user["id"], ts, ts))
    add_event(conn, incident_id, "task_created", f"Task created: {body.title}", user["id"])
    return incident_detail(conn, incident_id)


@router.patch("/incidents/{incident_id}/tasks/{task_id}")
def update_task(incident_id: int, task_id: int, body: TaskUpdate, user=Depends(current_user),
                conn=Depends(get_db)):
    conn.execute("BEGIN IMMEDIATE")
    task = row(conn.execute("SELECT * FROM tasks WHERE id = ? AND incident_id = ?", (task_id, incident_id)))
    if not task:
        raise HTTPException(404, "Task not found")
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v != task[k]}
    if changes and conn.execute("SELECT 1 FROM it_requests WHERE task_id = ?", (task_id,)).fetchone():
        if {"owner_user_id", "owner_label"} & changes.keys():
            raise HTTPException(409, "Use the claim route to assign an IT request task")
        if "status" in changes and task["owner_user_id"] != user["id"]:
            raise HTTPException(403, "Only the claimed owner can change this task's status")
    if "owner_user_id" in changes:
        _check_owner(conn, changes["owner_user_id"])
    if changes:
        sets = ", ".join(f"{k} = ?" for k in changes)
        conn.execute(f"UPDATE tasks SET {sets}, updated_at = ? WHERE id = ?", (*changes.values(), now(), task_id))
        what = f"status {task['status']} → {changes['status']}" if "status" in changes else "updated"
        add_event(conn, incident_id, "task_updated", f"Task '{task['title']}' {what}", user["id"],
                  {"task_id": task_id, **{k: {"from": task[k], "to": v} for k, v in changes.items()}})
    return incident_detail(conn, incident_id)
