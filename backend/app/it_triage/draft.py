"""IT task draft: schema + server-side grounding.

The model writes the wording. Vigil's records decide the facts:
  * deadline time      -> always taken from the matter record (never trusted from the model)
  * file copying       -> derived from scope/evidence records; stays 'unknown' unless a record says otherwise
  * evidence refs      -> must exist for THIS incident (EV-n or MATTER:<code>)
  * urgency            -> can't be set below what the deadline + locked files imply
"""
import re
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

URGENCY_ORDER = ["normal", "high", "urgent"]


class ModelDraft(BaseModel):
    """What we ask Nemotron to return (JSON)."""
    title: str = Field(min_length=3, max_length=120)
    suggested_team: str = Field(default="On-call IT", max_length=60)
    urgency: Literal["urgent", "high", "normal"] = "high"
    issue: str = Field(min_length=3, max_length=400)
    affected: str = Field(default="", max_length=300)
    why_urgent: str = Field(min_length=3, max_length=400)
    first_action: str = Field(min_length=3, max_length=300)
    evidence_refs: List[str] = []
    unknowns: List[str] = []

    @field_validator("urgency", mode="before")
    @classmethod
    def norm_urgency(cls, v):
        return str(v).strip().lower() if v else "high"


TIME_RE = re.compile(r"\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?\s*m\.?(?:\s*(?:CT|CST|CDT|Central))?", re.I)
COPY_CLAIM_RE = re.compile(r"\b(were|was|have been|has been)\s+(copied|exfiltrated|stolen|leaked)\b", re.I)


def _clock(dt_local: datetime) -> tuple:
    return (dt_local.hour % 12 or 12, dt_local.minute, "p" if dt_local.hour >= 12 else "a")


def _fix_times(text: str, record_clock, record_short: str, notes: list, field: str) -> str:
    def sub(m):
        h, mi, ap = int(m.group(1)), int(m.group(2) or 0), m.group(3).lower()
        if record_clock and (h, mi, ap) == record_clock:
            return m.group(0)
        notes.append(f"{field}: replaced time '{m.group(0)}' with the deadline on record ({record_short}).")
        return record_short
    return TIME_RE.sub(sub, text)


def derive_copying(evidence_result: dict) -> dict:
    scope = evidence_result.get("scope", [])
    states = {s["data_copying"] for s in scope}
    copy_ev = [e["ref"] for e in evidence_result.get("evidence", [])
               if e["kind"] in ("data_copy_confirmed", "exfiltration_confirmed") and e["certainty"] == "confirmed"]
    if "confirmed" in states or copy_ev:
        return {"status": "confirmed", "label": "Confirmed", "basis": "Incident record confirms data copying."}
    if "suspected" in states:
        return {"status": "suspected", "label": "Suspected", "basis": "Incident record marks copying as suspected, not confirmed."}
    if scope and states == {"none_observed"}:
        return {"status": "none_observed", "label": "None observed", "basis": "Records show no copying observed."}
    return {"status": "unknown", "label": "Unknown",
            "basis": "No record verifies whether files were copied."}


def pick_deadline(matters_result: dict, now_utc: datetime) -> Optional[dict]:
    with_deadline = [m for m in matters_result.get("matters", []) if m["deadline_at"]]
    upcoming = [m for m in with_deadline if datetime.fromisoformat(m["deadline_at"]) > now_utc]
    return (upcoming or with_deadline or [None])[0]


def ground(model: ModelDraft, evidence_result: dict, matters_result: dict, request_body: str) -> tuple:
    """Return (final_draft_dict, validation_notes)."""
    from .tools import format_ct
    from ..db import _local_tz

    notes: list = []
    now_utc = datetime.now(timezone.utc)
    m = pick_deadline(matters_result, now_utc)

    # ---- deadline (record is the authority) ----
    if m:
        due_local = datetime.fromisoformat(m["deadline_at"]).astimezone(_local_tz())
        due_ct = format_ct(m["deadline_at"])
        short = due_ct.split(",")[0]                      # '2:00 PM CT'
        record_clock = _clock(due_local)
        label = (m["deadline_label"] or "Filing deadline").capitalize()
        deadline = {"known": True, "text": f"{label} due {due_ct}.", "due_ct": due_ct, "due_at": m["deadline_at"],
                    "matter_code": m["matter_code"], "matter_title": m["title"], "record_ref": m["record_ref"]}
        hours_left = (datetime.fromisoformat(m["deadline_at"]) - now_utc).total_seconds() / 3600
    else:
        short, record_clock, hours_left = "the filing deadline (unverified)", None, None
        deadline = {"known": False, "text": "Unknown. No filing deadline is on record for the affected matter.",
                    "due_ct": None, "due_at": None, "matter_code": None, "record_ref": None}
        notes.append("No deadline on record: deadline shown as Unknown.")

    fields = {k: getattr(model, k) for k in ("title", "issue", "affected", "why_urgent", "first_action")}
    for k in fields:
        fields[k] = _fix_times(fields[k], record_clock, short, notes, k)

    # ---- file copying (records only; model can't upgrade or downgrade) ----
    copying = derive_copying(evidence_result)
    if copying["status"] in ("unknown", "suspected"):
        for k, v in fields.items():
            if COPY_CLAIM_RE.search(v):
                fields[k] = COPY_CLAIM_RE.sub(lambda mm: f"{mm.group(1)} possibly {mm.group(2)} (unverified)", v)
                notes.append(f"{k}: removed an unverified claim that files were copied.")

    # ---- evidence references must exist for this incident ----
    ev_by_ref = {e["ref"]: e for e in evidence_result.get("evidence", [])}
    matter_refs = {mm["record_ref"]: mm for mm in matters_result.get("matters", [])}
    evidence, seen = [], set()
    for ref in model.evidence_refs:
        ref = ref.strip()
        if ref.upper().startswith("MATTER:"):
            ref = "MATTER:" + ref.split(":", 1)[1].strip().upper()
        if ref in seen:
            continue
        if ref in ev_by_ref:
            evidence.append({"ref": ref, "kind": "evidence", "description": ev_by_ref[ref]["description"],
                             "certainty": ev_by_ref[ref]["certainty"]})
        elif ref in matter_refs:
            mm = matter_refs[ref]
            evidence.append({"ref": ref, "kind": "filing_record", "description": f"{mm['matter_code']} · {mm['title']}",
                             "certainty": "confirmed"})
        else:
            notes.append(f"Dropped evidence reference '{ref}': not in this incident's records.")
            continue
        seen.add(ref)
    if deadline["known"] and deadline["record_ref"] not in seen:
        mm = matter_refs[deadline["record_ref"]]
        evidence.append({"ref": deadline["record_ref"], "kind": "filing_record",
                         "description": f"{mm['matter_code']} · {mm['title']}", "certainty": "confirmed"})
        notes.append("Added the filing record that the deadline comes from.")

    # ---- unknowns ----
    unknowns = [u.strip() for u in model.unknowns if u and u.strip()]
    if copying["status"] in ("unknown", "suspected") and not any("cop" in u.lower() for u in unknowns):
        unknowns.insert(0, "Whether any files were copied.")
    if not deadline["known"]:
        unknowns.insert(0, "The filing deadline: IT must confirm the due time with the matter lead.")
    if not any(e["kind"] == "evidence" for e in evidence):
        unknowns.append("No verified evidence yet: IT must confirm the lawyer's report on the affected system.")

    # ---- urgency floor ----
    locked = any(s["availability"] in ("locked", "destroyed") for s in evidence_result.get("scope", []))
    floor = "urgent" if (hours_left is not None and hours_left <= 24 and locked) else "normal"
    urgency = model.urgency
    if URGENCY_ORDER.index(urgency) < URGENCY_ORDER.index(floor):
        notes.append(f"Raised urgency from {urgency} to {floor}: locked files and a deadline within 24 hours.")
        urgency = floor

    team = model.suggested_team.strip() or "On-call IT"
    title = fields["title"].strip()
    if len(title) > 90:
        title = title[:87].rstrip() + "…"
    return ({
        "header": f"{urgency.capitalize()} · {team}",
        "title": title,
        "urgency": urgency,
        "suggested_team": team,
        "issue": fields["issue"].strip(),
        "affected": fields["affected"].strip(),
        "deadline": deadline,
        "why_urgent": fields["why_urgent"].strip(),
        "first_action": fields["first_action"].strip(),
        "evidence": evidence,
        "file_copying": copying,
        "unknowns": unknowns,
        "request_text": request_body,
    }, notes)


def as_text_card(d: dict) -> str:
    """Plain-text rendering of the card (terminal demo + Photon-friendly)."""
    ev = "; ".join(f"{e['ref']} ({e['description'][:60]})" for e in d["evidence"]) or "none"
    lines = [d["header"], d["title"], "",
             f"• Issue: {d['issue']}",
             f"• Deadline: {d['deadline']['text']}",
             f"• Why it's urgent: {d['why_urgent']}",
             f"• First action: {d['first_action']}",
             f"• Evidence: {ev}",
             f"• File copying: {d['file_copying']['label']}. {d['file_copying']['basis']}",
             f"• Still unknown: {'; '.join(d['unknowns']) or 'nothing flagged'}"]
    return "\n".join(lines)


def task_fields(d: dict) -> dict:
    """Map an approved draft onto the existing task model (POST /api/incidents/{id}/tasks body).
    Used at team integration time by the shared approval -> Photon claim flow."""
    return {
        "title": d["title"],
        "owner_label": d["suggested_team"],
        "priority": {"urgent": "critical", "high": "high", "normal": "medium"}[d["urgency"]],
        "due_at": d["deadline"]["due_at"],
        "evidence_refs": [e["ref"] for e in d["evidence"] if e["kind"] == "evidence"],
    }
