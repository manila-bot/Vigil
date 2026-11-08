"""Shared helpers: timeline writes and the incident detail payload (the main API contract)."""
import json
from datetime import datetime

from fastapi import HTTPException

from .db import now, row, rows, _local_tz


def add_event(conn, incident_id: int, kind: str, summary: str, actor_id=None, detail=None) -> None:
    """Every state change goes through here so the Timeline is complete and timestamped."""
    conn.execute(
        "INSERT INTO timeline_events (incident_id, at, actor_user_id, kind, summary, detail_json) VALUES (?,?,?,?,?,?)",
        (incident_id, now(), actor_id, kind, summary, json.dumps(detail or {})),
    )
    conn.execute("UPDATE incidents SET updated_at = ? WHERE id = ?", (now(), incident_id))


def get_incident_or_404(conn, incident_id: int) -> dict:
    inc = row(conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)))
    if not inc:
        raise HTTPException(404, "Incident not found")
    return inc


def next_incident_code(conn) -> str:
    n = conn.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM incidents").fetchone()[0]
    return f"VIG-{n:04d}"


def local_time_label(iso: str) -> str:
    """'2026-11-07T20:00:00+00:00' -> '2:00 PM' in the firm's time zone."""
    tz = _local_tz()
    dt = datetime.fromisoformat(iso).astimezone(tz)
    clock = dt.strftime("%I:%M %p").lstrip("0")
    days = (dt.date() - datetime.now(tz).date()).days
    if days == 0:
        return clock
    if days == 1:
        return f"Tomorrow {clock}"
    if days == -1:
        return f"Yesterday {clock}"
    return f"{dt.strftime('%a %b')} {dt.day} {clock}"


def _loads(value, default):
    try:
        return json.loads(value) if value else default
    except ValueError:
        return default


def triage_payload(run: dict):
    if not run:
        return None
    return {
        "id": run["id"],
        "status": run["status"],
        "provider": run["provider"],
        "model": run["model"],
        "is_mock": run["provider"] == "stub",
        "tool_calls": _loads(run["tool_calls_json"], []),
        "draft": _loads(run["draft_json"], None),
        "error": run["error"],
        "created_by": run.get("created_by_name"),
        "created_at": run["created_at"],
        "decided_by": run.get("decided_by_name"),
        "decided_at": run["decided_at"],
    }


def headline(scope: list, matters_at_risk: list) -> list:
    """Short, plain-language status chips for the top of the incident. Color is paired with text."""
    chips = []
    for m in matters_at_risk:
        if m["deadline_at"] and m["at_risk"]:
            chips.append({"label": f"{local_time_label(m['deadline_at'])} {m['deadline_label'] or 'deadline'} at risk",
                          "tone": "critical", "kind": "deadline", "matter_code": m["matter_code"]})
    availability = {s["availability"] for s in scope}
    if "locked" in availability or "destroyed" in availability:
        chips.append({"label": "Files locked", "tone": "critical", "kind": "availability"})
    elif "degraded" in availability:
        chips.append({"label": "Systems degraded", "tone": "warning", "kind": "availability"})
    copying = {s["copying"] for s in scope}
    if "confirmed" in copying:
        chips.append({"label": "Data copying confirmed", "tone": "critical", "kind": "copying"})
    elif "suspected" in copying:
        chips.append({"label": "Data copying suspected", "tone": "warning", "kind": "copying"})
    elif "unknown" in copying:
        chips.append({"label": "Data copying unverified", "tone": "warning", "kind": "copying"})
    elif scope:
        chips.append({"label": "No data copying observed", "tone": "ok", "kind": "copying"})
    return chips


def incident_detail(conn, incident_id: int) -> dict:
    inc = get_incident_or_404(conn, incident_id)
    inc["created_by_name"] = (row(conn.execute("SELECT name FROM users WHERE id=?", (inc["created_by"],))) or {}).get("name")

    scope = rows(conn.execute(
        """SELECT s.*, m.matter_code, u.name AS updated_by_name FROM scope_items s
           LEFT JOIN matters m ON m.id = s.matter_id LEFT JOIN users u ON u.id = s.updated_by
           WHERE s.incident_id = ? ORDER BY s.id""", (incident_id,)))

    matters = rows(conn.execute(
        """SELECT DISTINCT m.* FROM matters m JOIN scope_items s ON s.matter_id = m.id
           WHERE s.incident_id = ? ORDER BY m.deadline_at IS NULL, m.deadline_at""", (incident_id,)))
    for m in matters:
        items = [s for s in scope if s["matter_id"] == m["id"]]
        m["availability"] = sorted({s["availability"] for s in items})
        m["copying"] = sorted({s["copying"] for s in items})
        m["at_risk"] = any(s["availability"] != "available" for s in items)
        m["deadline_local"] = local_time_label(m["deadline_at"]) if m["deadline_at"] else None
        m["is_simulated"] = bool(m["is_simulated"])

    evidence = rows(conn.execute("SELECT * FROM evidence WHERE incident_id = ? ORDER BY observed_at, id", (incident_id,)))
    for e in evidence:
        e["detail"] = _loads(e.pop("detail_json"), {})
        e["is_simulated"] = bool(e["is_simulated"])

    tasks = rows(conn.execute(
        """SELECT t.*, o.name AS owner_name, a.name AS approved_by_name FROM tasks t
           LEFT JOIN users o ON o.id = t.owner_user_id LEFT JOIN users a ON a.id = t.approved_by
           WHERE t.incident_id = ? ORDER BY t.status = 'done', t.due_at IS NULL, t.due_at, t.id""", (incident_id,)))
    for t in tasks:
        t["evidence_refs"] = _loads(t.pop("evidence_refs_json"), [])

    messages = rows(conn.execute(
        """SELECT m.id, m.body, m.created_at, m.user_id, u.name AS user_name, u.team_role
           FROM messages m JOIN users u ON u.id = m.user_id WHERE m.incident_id = ? ORDER BY m.id""", (incident_id,)))

    timeline = rows(conn.execute(
        """SELECT t.id, t.at, t.kind, t.summary, t.detail_json, t.actor_user_id, u.name AS actor_name
           FROM timeline_events t LEFT JOIN users u ON u.id = t.actor_user_id
           WHERE t.incident_id = ? ORDER BY t.at, t.id""", (incident_id,)))
    for t in timeline:
        t["detail"] = _loads(t.pop("detail_json"), {})

    run = row(conn.execute(
        """SELECT r.*, c.name AS created_by_name, d.name AS decided_by_name FROM triage_runs r
           LEFT JOIN users c ON c.id = r.created_by LEFT JOIN users d ON d.id = r.decided_by
           WHERE r.incident_id = ? ORDER BY r.id DESC LIMIT 1""", (incident_id,)))

    notifications = rows(conn.execute(
        """SELECT n.id, n.channel, n.recipient_label, n.body, n.send_status, n.delivery_status, n.acknowledged_at,
                  n.provider, n.provider_message_id, n.created_at, n.updated_at, n.triage_run_id,
                  u.name AS requested_by_name
           FROM notifications n LEFT JOIN users u ON u.id = n.requested_by
           WHERE n.incident_id = ? ORDER BY n.id""", (incident_id,)))
    for n in notifications:
        n["is_mock"] = n["provider"] == "stub"

    open_tasks = [t for t in tasks if t["status"] != "done"]
    requests = rows(conn.execute(
        """SELECT r.id, m.matter_code, r.requester_id, r.body, r.created_at, r.task_id, n.id AS triage_id, n.triage_status, n.triage_error, n.provider,
                  CASE WHEN t.owner_user_id IS NOT NULL THEN 'claimed'
                       WHEN r.task_id IS NOT NULL THEN 'task_ready' ELSE 'saved' END AS status
           FROM it_requests r JOIN matters m ON m.id = r.matter_id
           LEFT JOIN tasks t ON t.id = r.task_id LEFT JOIN workspace_triage_links l ON l.request_id = r.id
           LEFT JOIN nemotron_it_requests n ON n.id = l.triage_id WHERE r.incident_id = ? ORDER BY r.id""",
        (incident_id,),
    ))
    return {
        "incident": inc,
        "headline": headline(scope, matters),
        "matters_at_risk": matters,
        "scope": scope,
        "evidence": evidence,
        "tasks": tasks,
        "requests": requests,
        "messages": messages,
        "timeline": timeline,
        "triage": triage_payload(run),
        "notifications": notifications,
        "counts": {
            "open_tasks": len(open_tasks),
            "unverified_exposure": sum(1 for s in scope if s["copying"] in ("unknown", "suspected")),
            "affected_systems": len({s["system"] for s in scope if s["availability"] != "available"}),
            "messages": len(messages),
        },
        "server_time": now(),
    }
