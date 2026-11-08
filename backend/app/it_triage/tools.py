"""The two READ-ONLY tools Nemotron may call. The backend executes them and always scopes
them to the incident of the saved request: any incident_id the model passes is ignored."""
from datetime import datetime

from .. import config
from ..db import _local_tz, rows

TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "get_incident_evidence",
            "description": "What has been reported or verified about the affected systems and files for this "
                           "incident: evidence items (ref, time, description, certainty) and the scope records "
                           "(system, data, file availability, whether data copying is known).",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_affected_matters",
            "description": "Legal matters affected by this incident, with the filing deadline in Central Time, "
                           "the matter lead, and the record reference to cite.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
]


def format_ct(iso_utc: str) -> str:
    """'2026-11-08T20:00:00+00:00' -> '2:00 PM CT, Sun Nov 8'."""
    dt = datetime.fromisoformat(iso_utc).astimezone(_local_tz())
    return f"{dt.strftime('%I:%M %p').lstrip('0')} {config.FIRM_TIMEZONE_LABEL}, {dt.strftime('%a %b')} {dt.day}"


def get_incident_evidence(conn, incident_id: int) -> dict:
    evidence = rows(conn.execute(
        """SELECT ref, kind, observed_at, description, certainty FROM evidence
           WHERE incident_id = ? ORDER BY id""", (incident_id,)))
    scope = rows(conn.execute(
        """SELECT s.id AS scope_id, s.system, s.data_category, m.matter_code, s.availability,
                  s.copying AS data_copying, s.certainty, s.notes
           FROM scope_items s LEFT JOIN matters m ON m.id = s.matter_id
           WHERE s.incident_id = ? ORDER BY s.id""", (incident_id,)))
    return {"incident_id": incident_id, "evidence": evidence, "scope": scope,
            "note": "data_copying 'unknown' means nobody has verified whether files were copied."}


def get_affected_matters(conn, incident_id: int) -> dict:
    matters = rows(conn.execute(
        """SELECT DISTINCT m.matter_code, m.title, m.lead_name, m.lead_role, m.deadline_at, m.deadline_label
           FROM matters m JOIN scope_items s ON s.matter_id = m.id
           WHERE s.incident_id = ? ORDER BY m.deadline_at IS NULL, m.deadline_at""", (incident_id,)))
    for m in matters:
        m["record_ref"] = f"MATTER:{m['matter_code']}"
        m["deadline_ct"] = format_ct(m["deadline_at"]) if m["deadline_at"] else "unknown"
    return {"incident_id": incident_id, "matters": matters,
            "note": "Use deadline_ct exactly as given. If a deadline is 'unknown', say IT must verify it."}


IMPLEMENTATIONS = {"get_incident_evidence": get_incident_evidence, "get_affected_matters": get_affected_matters}


def run_tool(conn, incident_id: int, name: str):
    if name not in IMPLEMENTATIONS:
        raise ValueError(f"Unknown tool {name}")
    return IMPLEMENTATIONS[name](conn, incident_id)
