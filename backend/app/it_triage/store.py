"""IT help requests: saved BEFORE any model call, so a failed triage never loses the request.

Owner: NVIDIA (Person 3). Additive table only; core tables are untouched.
"""
import json

from ..db import now, row

DDL = """
CREATE TABLE IF NOT EXISTS it_requests (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    body TEXT NOT NULL,                       -- the lawyer's words, stored as typed
    requester_label TEXT,                     -- e.g. 'Dana Ortiz (Litigation)'
    submitted_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    triage_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (triage_status IN ('pending','running','drafted','failed')),
    triage_error TEXT,                        -- safe, user-facing message
    attempts INTEGER NOT NULL DEFAULT 0,
    provider TEXT,                            -- 'nemotron' (live) or 'fixture'
    model TEXT,
    tool_calls_json TEXT NOT NULL DEFAULT '[]',
    draft_json TEXT,
    validation_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_it_requests_incident ON it_requests(incident_id, id);
"""


def ensure_schema(conn) -> None:
    conn.executescript(DDL)


def create(conn, incident_id: int, body: str, requester_label, user_id) -> int:
    ts = now()
    return conn.execute(
        """INSERT INTO it_requests (incident_id, body, requester_label, submitted_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?)""", (incident_id, body, requester_label, user_id, ts, ts)).lastrowid


def get(conn, request_id: int):
    return row(conn.execute("SELECT * FROM it_requests WHERE id = ?", (request_id,)))


def payload(r: dict) -> dict:
    """API shape for one request (what /dev and Person 2's form render)."""
    loads = lambda v, d: json.loads(v) if v else d  # noqa: E731
    return {
        "id": r["id"],
        "incident_id": r["incident_id"],
        "body": r["body"],
        "requester_label": r["requester_label"],
        "created_at": r["created_at"],
        "triage": {
            "status": r["triage_status"],
            "can_retry": r["triage_status"] in ("failed", "drafted"),
            "error": r["triage_error"],
            "attempts": r["attempts"],
            "provider": r["provider"],
            "is_live_nemotron": r["provider"] == "nemotron",
            "model": r["model"],
            "tool_calls": loads(r["tool_calls_json"], []),
            "validation": loads(r["validation_json"], []),
        },
        "draft": loads(r["draft_json"], None),
        "updated_at": r["updated_at"],
    }
