"""Demo controls. Everything created here is labeled SIMULATED."""
import json
import os

from fastapi import APIRouter, Depends, HTTPException

from .. import config
from ..db import get_db, load_matters, now, row
from ..detection.detector import detect, load_events
from ..schemas import SimulateIn
from ..security import current_user, require_admin
from ..services import add_event, incident_detail, next_incident_code

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post("/simulate")
def simulate(body: SimulateIn = SimulateIn(), user=Depends(current_user), conn=Depends(get_db)):
    fixture_path = config.FIXTURES_DIR / "logs" / f"{body.fixture}.jsonl"
    if body.fixture == "ransomware_burst" and os.getenv("VIGIL_USE_GENERATED_REPLAY") == "1":
        replay_name = "synthetic_filing_attack_replay.jsonl"
        fixture_path = config.DATA_DIR / replay_name
        if not fixture_path.is_file():
            fixture_path = config.FIXTURES_DIR / "logs" / replay_name
        if not fixture_path.is_file():
            raise HTTPException(503, "The synthetic filing attack replay is unavailable.")
    events = load_events(fixture_path)
    findings = detect(events)
    if not findings:
        return {"detected": False, "fixture": body.fixture, "events_scanned": len(events), "incident_id": None,
                "message": "No suspicious activity found in this log sample."}

    f = findings[0]
    # Don't open duplicate incidents if Simulate is clicked twice.
    existing = row(conn.execute(
        """SELECT i.id FROM incidents i JOIN evidence e ON e.incident_id = i.id
           WHERE i.source = 'simulated' AND i.status != 'closed' AND e.kind = 'file_rename_burst'
             AND e.observed_at = ? LIMIT 1""", (f["window_start"],)))
    if existing:
        return {"detected": True, "created": False, "fixture": body.fixture, "events_scanned": len(events),
                "incident_id": existing["id"], "message": "This activity is already tracked as an open incident."}

    load_matters(conn)  # make deadlines relative to the moment the demo runs
    ts = now()
    title = f"[SIMULATED] Ransomware-like file encryption on {f['host']}"
    summary = (f"Simulated detection: {f['rename_count']} document files renamed to {', '.join(f['new_extension'])} "
               f"within one minute on {f['host']} (account {f['user']}). Affected matters: "
               f"{', '.join(f['matter_codes'])}. Whether data was copied out is not verified.")
    cur = conn.execute(
        """INSERT INTO incidents (code, title, status, severity, category, summary, detected_at, source, created_by,
                                  created_at, updated_at) VALUES (?,?,'open','critical','ransomware',?,?,'simulated',?,?,?)""",
        (next_incident_code(conn), title, summary, f["window_start"], user["id"], ts, ts))
    iid = cur.lastrowid
    add_event(conn, iid, "detection", f"Simulated detector flagged {f['rename_count']} file renames on {f['host']}",
              None, {"fixture": body.fixture, "simulated": True})

    for n, s in enumerate(f["signals"], start=1):
        conn.execute(
            """INSERT INTO evidence (incident_id, ref, kind, observed_at, description, detail_json, certainty,
                                     is_simulated, created_at) VALUES (?,?,?,?,?,?,?,1,?)""",
            (iid, f"EV-{n}", s["kind"], s["observed_at"], s["description"], json.dumps(s["detail"]),
             "unknown" if s["kind"] in {"outbound_transfer", "outbound_telemetry_gap"} else "observed", ts))
        add_event(conn, iid, "evidence_added", f"Evidence EV-{n} recorded: {s['description']}", None,
                  {"simulated": True})

    for code in f["matter_codes"]:
        m = row(conn.execute("SELECT id, title FROM matters WHERE matter_code = ?", (code,)))
        conn.execute(
            """INSERT INTO scope_items (incident_id, system, data_category, matter_id, availability, copying, certainty,
                                        notes, updated_at) VALUES (?,?,?,?,?,?,?,?,?)""",
            (iid, "Document management (DMS)", f"Matter files {code}", m["id"] if m else None, "locked", "unknown",
             "observed", "Files renamed with .vgl0ck extension; cannot be opened. Copying not verified.", ts))
    email_disrupted = any(s["kind"] == "service_disruption" for s in f["signals"])
    if email_disrupted:
        conn.execute(
            """INSERT INTO scope_items (incident_id, system, data_category, availability, copying, certainty, notes,
                                        updated_at) VALUES (?,?,?,?,?,?,?,?)""",
            (iid, "Email", "Firm mailboxes", "degraded", "unknown", "observed",
             "Mail transport stopped. Use Vigil chat and phone alerts instead of firm email.", ts))
    email_scope = "email degraded, " if email_disrupted else ""
    add_event(conn, iid, "scope_added", f"Initial scope recorded from detection: matter files locked, "
                                         f"{email_scope}data copying unverified", None, {"simulated": True})
    return {"detected": True, "created": True, "fixture": body.fixture, "events_scanned": len(events),
            "incident_id": iid, "incident": incident_detail(conn, iid)}


@router.post("/reset")
def reset(admin=Depends(require_admin), conn=Depends(get_db)):
    """Wipe incident data (keeps users and matters). Admin only — for re-running the demo."""
    for table in ("notifications", "it_requests", "tasks", "triage_runs", "messages", "timeline_events", "scope_items",
                  "evidence", "incidents"):
        conn.execute(f"DELETE FROM {table}")
    load_matters(conn)  # refresh deadlines to today
    return {"ok": True}
