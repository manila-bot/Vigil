"""Multi-step Nemotron workflow: saved request -> tool calls (backend-executed, incident-scoped)
-> JSON draft -> server-side grounding. Falls back to a clearly labeled FIXTURE provider when
live Nemotron isn't configured (VIGIL_NEMOTRON_ENABLED=1 + the selected provider's key)."""
import json
import re

from pydantic import ValidationError

from .. import config
from . import client
from .draft import ModelDraft
from .tools import TOOL_SPECS, run_tool

SYSTEM_PROMPT = """You are Vigil's IT triage assistant at a law firm during a cyber incident.
A lawyer asked for IT help. Turn the request into ONE clear task an on-call IT responder can act on at a glance.

Rules:
- First call ALL THREE tools: get_incident_evidence, get_affected_matters and get_on_call_roles. They are read-only and already scoped to this incident.
- Use only facts from the request and the tool results. Never invent systems, files, times or evidence.
- Use the deadline exactly as given in deadline_ct. If it is "unknown", say IT must verify it.
- If data_copying is "unknown", do NOT say files were or were not copied; list it under unknowns.
- The first action must be one concrete step IT can start now.
- Cite evidence with refs from the tools: evidence refs like "EV-1" and filing records like "MATTER:LIT-2291".
- notify_role must be a role name returned by get_on_call_roles.
- Plain language, no jargon. Title under 80 characters, starting with a verb.

When you have the tool results, reply with ONLY this JSON object (no prose, no code fences):
{"title": str, "suggested_team": str, "urgency": "urgent"|"high"|"normal", "issue": str, "affected": str,
 "why_urgent": str, "first_action": str, "evidence_refs": [str], "unknowns": [str], "notify_role": str}"""

REQUIRED_TOOLS = ("get_incident_evidence", "get_affected_matters", "get_on_call_roles")


def _parse_json(text: str) -> dict:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in model reply")
    return json.loads(text[start:end + 1])


def _summ(name, result):
    if name == "get_incident_evidence":
        return f"{len(result['evidence'])} evidence items, {len(result['scope'])} scope records"
    if name == "get_on_call_roles":
        return ", ".join(f"{r['role']}: {r['active_responders']} active" for r in result["roles"]) or "no roles"
    deadlines = [m["deadline_ct"] for m in result["matters"]]
    return f"{len(result['matters'])} matters; deadline {deadlines[0] if deadlines else 'unknown'}"


def _execute(conn, incident_id, name, args, log, results, requested_by):
    result = run_tool(conn, incident_id, name)  # args ignored on purpose: always this incident
    results[name] = result
    log.append({"step": len(log) + 1, "tool": name, "requested_by": requested_by,
                "args_from_model": args, "scoped_to_incident": incident_id,
                "result_summary": _summ(name, result), "result": result})
    return result


def _user_prompt(incident, request) -> str:
    who = request.get("requester_label") or "A lawyer"
    return (f"Incident {incident['code']}: {incident['title']}\n"
            f"{who} submitted this IT help request:\n\"{request['body']}\"")


def run_live(conn, incident, request) -> dict:
    iid = incident["id"]
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": _user_prompt(incident, request)}]
    log, results, final_text = [], {}, None
    for _ in range(4):
        msg = client.chat(messages, tools=TOOL_SPECS)
        calls = msg.get("tool_calls") or []
        if not calls:
            final_text = msg.get("content") or ""
            break
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for c in calls:
            name = c["function"]["name"]
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
            except ValueError:
                args = {}
            try:
                out = _execute(conn, iid, name, args, log, results, "model")
            except ValueError as exc:
                out = {"error": str(exc)}
            messages.append({"role": "tool", "tool_call_id": c.get("id", name), "name": name,
                             "content": json.dumps(out, default=str)})

    missing = [t for t in REQUIRED_TOOLS if t not in results]
    if missing or final_text is None:
        # Grounding guarantee: the backend runs any lookup the model skipped, then asks for the draft.
        extra = {t: _execute(conn, iid, t, {}, log, results, "backend") for t in missing}
        note = (f"Lookup results (run by Vigil): {json.dumps(extra, default=str)}\n" if extra else "")
        messages.append({"role": "user", "content": note + "Now reply with ONLY the JSON object."})
        final_text = client.chat(messages).get("content") or ""

    try:
        draft = ModelDraft.model_validate(_parse_json(final_text))
    except (ValueError, ValidationError) as exc:
        messages += [{"role": "assistant", "content": final_text},
                     {"role": "user", "content": f"That was not valid ({str(exc)[:300]}). Reply with ONLY the JSON object."}]
        try:
            draft = ModelDraft.model_validate(_parse_json(client.chat(messages).get("content") or ""))
        except (ValueError, ValidationError) as exc2:
            raise client.ProviderError("Nemotron's draft didn't match the task format.", str(exc2))
    return {"provider": "nemotron", "model": client.describe(), "tool_calls": log, "model_draft": draft,
            "evidence": results["get_incident_evidence"], "matters": results["get_affected_matters"],
            "roles": results["get_on_call_roles"]}


def run_fixture(conn, incident, request) -> dict:
    """Deterministic stand-in (labeled FIXTURE). Calls the same real tools, then fills a template."""
    iid = incident["id"]
    log, results = [], {}
    ev = _execute(conn, iid, "get_incident_evidence", {}, log, results, "fixture")
    mt = _execute(conn, iid, "get_affected_matters", {}, log, results, "fixture")
    roles = _execute(conn, iid, "get_on_call_roles", {}, log, results, "fixture")
    locked = [s for s in ev["scope"] if s["availability"] in ("locked", "destroyed")]
    target = locked[0] if locked else (ev["scope"][0] if ev["scope"] else None)
    thing = target["data_category"] if target else "the files named in the request"
    thing_lc = thing[0].lower() + thing[1:]
    system = target["system"] if target else "the affected system"
    m = next((x for x in mt["matters"] if x["deadline_at"]), None)
    when = f"{m['deadline_ct'].split(',')[0]} {m['deadline_label'] or 'deadline'}" if m else "upcoming filing"
    draft = ModelDraft(
        title=f"Restore access to {thing_lc} for the {when}",
        suggested_team="On-call IT",
        urgency="urgent" if locked and m else "high",
        issue=f"The lawyer reports: \"{request['body']}\". {thing} on {system} can't be opened.",
        affected=f"{thing} on {system}",
        why_urgent=(f"The lawyer needs these files to complete the {m['deadline_label'] or 'filing'}, and the working "
                    "copies are inaccessible." if m else "The lawyer can't work until access is restored."),
        first_action=f"Check for a clean backup of the {thing_lc} and confirm the lawyer can open the recovered copy.",
        evidence_refs=[e["ref"] for e in ev["evidence"]][:3] + ([m["record_ref"]] if m else []),
        unknowns=[],
        notify_role="it_on_call",
    )
    return {"provider": "fixture", "model": "fixture-template-v1", "tool_calls": log, "model_draft": draft,
            "evidence": ev, "matters": mt, "roles": roles}


def run(conn, incident, request) -> dict:
    return run_live(conn, incident, request) if client.live_enabled() else run_fixture(conn, incident, request)
