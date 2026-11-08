"""AI triage entry point.

run_triage(conn, incident) -> {"provider", "model", "tool_calls", "draft"}
  tool_calls: [{"step", "tool", "args", "result_summary", "result"}]  (shown in the UI)
  draft:      must validate as schemas.TriageDraft

When VIGIL_NEMOTRON_ENABLED=1 this calls triage/nemotron.py (NVIDIA teammate's module).
Otherwise a deterministic, clearly labeled MOCK runs the same real tools and builds a draft,
so the UI and approval flow work with no external provider.
"""
from datetime import datetime, timedelta, timezone

from .. import config
from . import tools


def _summarize(name, result):
    if name == "get_incident_evidence":
        return f"{len(result)} evidence items"
    if name == "get_affected_matters":
        return f"{len(result)} affected matter records"
    if name == "list_responders":
        return f"{len(result)} active responders"
    return "ok"


def run_tool_logged(conn, incident_id, step, name, args, log):
    result = tools.call_tool(conn, incident_id, name, args)
    log.append({"step": step, "tool": name, "args": args, "result_summary": _summarize(name, result),
                "result": result})
    return result


def _stub(conn, incident):
    iid = incident["id"]
    log = []
    evidence = run_tool_logged(conn, iid, 1, "get_incident_evidence", {"incident_id": iid}, log)
    matters = run_tool_logged(conn, iid, 2, "get_affected_matters", {"incident_id": iid}, log)
    people = run_tool_logged(conn, iid, 3, "list_responders", {}, log)

    def owner(role):
        for p in people:
            if (p["team_role"] or "").lower() == role.lower():
                return p["id"]
        return None

    refs = [e["ref"] for e in evidence]
    by_kind = {e["kind"]: e["ref"] for e in evidence}
    now = datetime.now(timezone.utc)
    tasks = []
    urgent = [m for m in matters if m["deadline_at"] and m["availability"] != "available"]
    if urgent:
        m = urgent[0]
        deadline = datetime.fromisoformat(m["deadline_at"])
        tasks.append({
            "title": f"Locate a clean backup copy of the {m['matter_code']} filing and confirm it opens",
            "owner_role": m["lead_role"] or "Litigation lead", "owner_user_id": owner(m["lead_role"] or ""),
            "due_at": (deadline - timedelta(hours=3)).isoformat(timespec="seconds"), "priority": "critical",
            "evidence_refs": [by_kind.get("file_rename_burst", refs[0] if refs else "")], "matter_code": m["matter_code"],
            "rationale": f"{m['deadline_local']} {m['deadline_label']} depends on files that are currently locked.",
        })
        tasks.append({
            "title": f"Prepare an extension request for the {m['matter_code']} {m['deadline_label']} as a fallback",
            "owner_role": m["lead_role"] or "Litigation lead", "owner_user_id": owner(m["lead_role"] or ""),
            "due_at": (deadline - timedelta(hours=2)).isoformat(timespec="seconds"), "priority": "high",
            "evidence_refs": [], "matter_code": m["matter_code"],
            "rationale": "Protects the deadline if no usable backup is found in time.",
        })
    tasks.append({
        "title": "Isolate the affected workstation from the network and preserve its logs",
        "owner_role": "IT lead", "owner_user_id": owner("IT lead"),
        "due_at": (now + timedelta(minutes=30)).isoformat(timespec="seconds"), "priority": "critical",
        "evidence_refs": [r for r in (by_kind.get("file_rename_burst"), by_kind.get("ransom_note")) if r],
        "rationale": "Stops further encryption and keeps evidence intact.",
    })
    if "outbound_transfer" in by_kind:
        tasks.append({
            "title": "Determine whether data was copied out in the outbound transfer",
            "owner_role": "IT lead", "owner_user_id": owner("IT lead"),
            "due_at": (now + timedelta(hours=2)).isoformat(timespec="seconds"), "priority": "high",
            "evidence_refs": [by_kind["outbound_transfer"]],
            "rationale": "Copying is unverified; the answer drives client and regulator notification.",
        })
    unknowns = ["Whether any client data was copied out (outbound transfer contents unknown)"] \
        if "outbound_transfer" in by_kind else []
    unknowns += ["How the attacker gained access", "Whether backups are intact and unencrypted"]
    draft = {
        "summary": "MOCK DRAFT (no AI provider enabled). Document files are locked by suspected ransomware; "
                   + (f"the {urgent[0]['deadline_local']} {urgent[0]['deadline_label']} for {urgent[0]['matter_code']} "
                      "is at risk. " if urgent else "")
                   + "Data copying is not verified.",
        "tasks": tasks[:5],
        "unknowns": unknowns,
        "evidence_refs": refs,
        "recommend_alert": True,
    }
    return {"provider": "stub", "model": "mock-triage-v0", "tool_calls": log, "draft": draft}


def run_triage(conn, incident: dict) -> dict:
    # Live Nemotron currently powers the IT-help workflow (app/it_triage). Incident-level triage
    # stays on the labeled mock until the team wires it to the same client at integration.
    return _stub(conn, incident)
