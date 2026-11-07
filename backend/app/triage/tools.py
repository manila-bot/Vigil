"""Tools the AI triage agent can call. They read ONLY from Vigil's own database.

Owner: NVIDIA & Detection teammate may extend these. Keep the names and the JSON-serializable
return values stable — the UI shows them in the tool activity panel.
"""
from ..db import row, rows
from ..services import local_time_label

TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "get_incident_evidence",
            "description": "Return the evidence recorded for an incident (ref, kind, time, description, certainty).",
            "parameters": {"type": "object", "properties": {"incident_id": {"type": "integer"}},
                           "required": ["incident_id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_affected_matters",
            "description": "Return legal matters touched by the incident with deadlines, leads, file availability "
                           "and data-copying status.",
            "parameters": {"type": "object", "properties": {"incident_id": {"type": "integer"}},
                           "required": ["incident_id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_responders",
            "description": "Return active Vigil responders and their team roles, for assigning task owners.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def get_incident_evidence(conn, incident_id: int) -> list:
    return rows(conn.execute(
        "SELECT ref, kind, observed_at, description, certainty FROM evidence WHERE incident_id = ? ORDER BY id",
        (incident_id,)))


def get_affected_matters(conn, incident_id: int) -> list:
    out = rows(conn.execute(
        """SELECT m.matter_code, m.title, m.lead_name, m.lead_role, m.deadline_at, m.deadline_label,
                  s.system, s.availability, s.copying, s.certainty
           FROM scope_items s JOIN matters m ON m.id = s.matter_id WHERE s.incident_id = ?
           ORDER BY m.deadline_at IS NULL, m.deadline_at""", (incident_id,)))
    for m in out:
        m["deadline_local"] = local_time_label(m["deadline_at"]) if m["deadline_at"] else None
    return out


def list_responders(conn) -> list:
    return rows(conn.execute("SELECT id, name, role, team_role FROM users WHERE active = 1 ORDER BY id"))


def call_tool(conn, incident_id: int, name: str, args: dict):
    """Dispatch a tool call. incident_id is forced to the current incident so the model can't read others."""
    if name == "get_incident_evidence":
        return get_incident_evidence(conn, incident_id)
    if name == "get_affected_matters":
        return get_affected_matters(conn, incident_id)
    if name == "list_responders":
        return list_responders(conn)
    raise ValueError(f"Unknown tool {name}")
