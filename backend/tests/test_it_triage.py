"""Nemotron IT-help workflow. The provider is faked here (no network); live runs use scripts/it_triage_demo.py."""
import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import config
    from app.security import login_limiter
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "t.db")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "admin-pass-123")
    monkeypatch.setattr(config, "RESPONDER_PASSWORD", "responder-pass-123")
    monkeypatch.setattr(config, "NEMOTRON_ENABLED", False)
    login_limiter._fails.clear()
    from app.main import app
    with TestClient(app) as c:
        c.headers["Authorization"] = "Bearer " + c.post(
            "/api/auth/login", json={"email": "admin@vigil.local", "password": "admin-pass-123"}).json()["token"]
        yield c


def seed(c, deadline="2099-01-05T14:00"):
    fx = c.post("/api/demo/it-fixture", json={"deadline_local": deadline}).json()
    return fx["incident_id"], fx["sample_request"]


class FakeNemotron:
    """Scripted chat() replies. Records every request so tests can inspect what the model saw."""

    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, messages, tools=None, max_tokens=1500):
        self.calls.append({"messages": json.loads(json.dumps(messages)), "tools": tools})
        nxt = self.replies.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


def tool_call(name, args="{}", cid=None):
    return {"id": cid or f"call_{name}", "type": "function", "function": {"name": name, "arguments": args}}


def final(**over):
    d = {"title": "Restore access to the filing exhibits for the 2 p.m. court filing", "suggested_team": "On-call IT",
         "urgency": "high", "issue": "The lawyer can't open the filing exhibits on the litigation document drive.",
         "affected": "Filing exhibits (LIT-4417)", "why_urgent": "The exhibits are needed for the 2 p.m. filing.",
         "first_action": "Check for a clean backup and confirm the lawyer can open the recovered exhibits.",
         "evidence_refs": ["EV-1", "EV-2", "MATTER:LIT-4417"], "unknowns": []}
    d.update(over)
    return {"role": "assistant", "content": json.dumps(d)}


def go_live(monkeypatch, replies):
    from app import config
    from app.it_triage import client as nem
    fake = FakeNemotron(replies)
    monkeypatch.setattr(config, "NEMOTRON_ENABLED", True)
    monkeypatch.setattr(config, "NVIDIA_API_KEY", "test-key")
    monkeypatch.setattr(nem, "chat", fake)
    return fake


def test_live_workflow_uses_tools_and_records(client, monkeypatch):
    iid, req = seed(client)
    other_iid, _ = seed(client)  # a second incident the model must not be able to read
    fake = go_live(monkeypatch, [
        {"role": "assistant", "content": None, "tool_calls": [
            tool_call("get_incident_evidence", json.dumps({"incident_id": other_iid})),
            tool_call("get_affected_matters")]},
        final(),
    ])
    r = client.post(f"/api/incidents/{iid}/it-requests", json=req)
    assert r.status_code == 201
    d = r.json()
    assert d["body"] == "I can't open the exhibits"
    assert d["triage"]["status"] == "drafted" and d["triage"]["is_live_nemotron"]
    calls = d["triage"]["tool_calls"]
    assert [c["tool"] for c in calls] == ["get_incident_evidence", "get_affected_matters"]
    assert all(c["scoped_to_incident"] == iid for c in calls)  # model's incident_id ignored
    assert fake.calls[0]["tools"][0]["function"]["name"] == "get_incident_evidence"
    draft = d["draft"]
    assert draft["header"] == "High · On-call IT"  # deadline is far off in this test, so no urgency floor
    assert draft["deadline"]["due_ct"].startswith("2:00 PM CT")
    assert "2 p.m." in draft["title"]  # matches the record, so the model's wording is kept
    assert not any("replaced time" in n for n in d["triage"]["validation"])
    assert "backup" in draft["first_action"].lower()
    assert {e["ref"] for e in draft["evidence"]} == {"EV-1", "EV-2", "MATTER:LIT-4417"}
    assert draft["file_copying"]["status"] == "unknown"
    assert any("copied" in u.lower() for u in draft["unknowns"])


def test_rerun_uses_updated_deadline_and_fixes_stale_time(client, monkeypatch):
    iid, req = seed(client)
    go_live(monkeypatch, [final(), final()])  # model skips tools; backend runs them, asks again
    rid = client.post(f"/api/incidents/{iid}/it-requests", json=req).json()["id"]
    client.post("/api/demo/matters/LIT-4417/deadline", json={"deadline_local": "2099-01-05T15:30"})
    fake = go_live(monkeypatch, [final(), final()])  # model still says '2 p.m.'
    d = client.post(f"/api/it-requests/{rid}/triage").json()
    assert d["triage"]["attempts"] == 2
    assert d["draft"]["deadline"]["due_ct"].startswith("3:30 PM CT")
    assert "3:30 PM CT" in d["draft"]["title"] and "2 p.m." not in d["draft"]["why_urgent"]
    assert any("replaced time" in n for n in d["triage"]["validation"])
    assert all(c["requested_by"] == "backend" for c in d["triage"]["tool_calls"])
    sent = json.dumps(fake.calls[-1]["messages"])
    assert "3:30 PM CT" in sent  # the model was given the new time


def test_copying_stays_unknown_and_bad_refs_dropped(client, monkeypatch):
    iid, req = seed(client)
    bad = final(issue="Exhibits are locked and files were copied to an outside server.",
                evidence_refs=["EV-1", "EV-99", "MATTER:OTHER-1"])
    go_live(monkeypatch, [bad, bad])
    d = client.post(f"/api/incidents/{iid}/it-requests", json=req).json()["draft"]
    assert d["file_copying"]["status"] == "unknown"
    assert "were copied" not in d["issue"] and "unverified" in d["issue"]
    refs = {e["ref"] for e in d["evidence"]}
    assert "EV-99" not in refs and "MATTER:OTHER-1" not in refs and "MATTER:LIT-4417" in refs


def test_copying_reflects_record_when_confirmed(client, monkeypatch):
    iid, req = seed(client)
    sid = client.get(f"/api/incidents/{iid}").json()["scope"][0]["id"]
    client.patch(f"/api/incidents/{iid}/scope/{sid}", json={"copying": "confirmed", "certainty": "confirmed"})
    go_live(monkeypatch, [final(), final()])
    d = client.post(f"/api/incidents/{iid}/it-requests", json=req).json()["draft"]
    assert d["file_copying"]["status"] == "confirmed"


def test_missing_deadline_shows_unknown(client, monkeypatch):
    iid, req = seed(client)
    client.post("/api/demo/matters/LIT-4417/deadline", json={"deadline_local": None})
    go_live(monkeypatch, [final(), final()])
    d = client.post(f"/api/incidents/{iid}/it-requests", json=req).json()["draft"]
    assert d["deadline"]["known"] is False and d["deadline"]["text"].startswith("Unknown")
    assert any("deadline" in u.lower() and "confirm" in u.lower() for u in d["unknowns"])
    assert "2 p.m." not in d["title"] and "unverified" in d["title"]


def test_provider_failure_keeps_request_and_retry_works(client, monkeypatch):
    from app.it_triage.client import ProviderError
    iid, req = seed(client)
    go_live(monkeypatch, [ProviderError("Nemotron did not respond in time.", "timeout")])
    r = client.post(f"/api/incidents/{iid}/it-requests", json=req)
    assert r.status_code == 201
    d = r.json()
    assert d["triage"]["status"] == "failed" and d["triage"]["can_retry"] and d["draft"] is None
    assert "request is saved" in d["triage"]["error"].lower()
    assert client.get(f"/api/it-requests/{d['id']}").json()["body"] == "I can't open the exhibits"
    assert client.get(f"/api/incidents/{iid}/it-requests").json()[0]["id"] == d["id"]
    tl = client.get(f"/api/incidents/{iid}").json()["timeline"]
    assert any(e["kind"] == "it_triage_failed" for e in tl)
    go_live(monkeypatch, [final(), final()])
    d2 = client.post(f"/api/it-requests/{d['id']}/triage").json()
    assert d2["triage"]["status"] == "drafted" and d2["triage"]["attempts"] == 2


def test_bad_json_gets_one_repair_then_fails_cleanly(client, monkeypatch):
    iid, req = seed(client)
    go_live(monkeypatch, [{"role": "assistant", "content": "<think>hmm</think>Sure! Here you go"},
                          {"role": "assistant", "content": "still not json"}])
    d = client.post(f"/api/incidents/{iid}/it-requests", json=req).json()
    assert d["triage"]["status"] == "failed" and d["body"]


def test_fixture_provider_is_labeled(client):
    iid, req = seed(client)
    d = client.post(f"/api/incidents/{iid}/it-requests", json=req).json()
    assert d["triage"]["provider"] == "fixture" and d["triage"]["is_live_nemotron"] is False
    assert d["draft"]["deadline"]["due_ct"].startswith("2:00 PM CT")


def test_requires_sign_in(client):
    iid, req = seed(client)
    client.headers.pop("Authorization")
    assert client.post(f"/api/incidents/{iid}/it-requests", json=req).status_code == 401
    assert client.get("/api/it-requests/1").status_code == 401


# ---------------- provider selection (NVIDIA vs OpenRouter) ----------------

class _Resp:
    def __init__(self, status, payload):
        self.status_code, self._p = status, payload
        self.text = json.dumps(payload)

    def json(self):
        return self._p


def _use_provider(monkeypatch, name, base, model):
    from app import config
    monkeypatch.setattr(config, "NEMOTRON_ENABLED", True)
    monkeypatch.setattr(config, "NEMOTRON_PROVIDER", name)
    monkeypatch.setattr(config, "NEMOTRON_BASE_URL", base)
    monkeypatch.setattr(config, "NEMOTRON_MODEL", model)
    monkeypatch.setattr(config, "NVIDIA_API_KEY", "nvapi-SECRET-NVIDIA")
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "sk-or-SECRET-OPENROUTER")


def test_openrouter_uses_its_own_key_url_and_model(monkeypatch):
    from app.it_triage import client as nem
    _use_provider(monkeypatch, "openrouter", "https://openrouter.ai/api/v1", "nvidia/nemotron-3-super-120b-a12b:free")
    seen = {}

    def fake_post(url, json=None, timeout=None, headers=None):
        seen.update(url=url, body=json, headers=headers)
        return _Resp(200, {"choices": [{"message": {"role": "assistant", "content": "{}"}}]})

    monkeypatch.setattr(nem.httpx, "post", fake_post)
    nem.chat([{"role": "user", "content": "hi"}], tools=[{"type": "function"}])
    assert seen["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert seen["body"]["model"] == "nvidia/nemotron-3-super-120b-a12b:free"
    assert seen["body"]["tools"] and seen["body"]["tool_choice"] == "auto"
    assert seen["headers"]["Authorization"] == "Bearer sk-or-SECRET-OPENROUTER"
    assert "nvapi-SECRET-NVIDIA" not in json.dumps(seen)  # NVIDIA key never sent to OpenRouter
    assert nem.live_enabled() and nem.describe() == "openrouter · nvidia/nemotron-3-super-120b-a12b:free"


def test_nvidia_provider_never_sends_openrouter_key(monkeypatch):
    from app.it_triage import client as nem
    _use_provider(monkeypatch, "nvidia", "https://integrate.api.nvidia.com/v1", "nvidia/nemotron-3-super-120b-a12b")
    seen = {}
    monkeypatch.setattr(nem.httpx, "post", lambda url, json=None, timeout=None, headers=None: (
        seen.update(url=url, headers=headers) or _Resp(200, {"choices": [{"message": {"content": "{}"}}]})))
    nem.chat([{"role": "user", "content": "hi"}])
    assert seen["url"].startswith("https://integrate.api.nvidia.com/")
    assert seen["headers"]["Authorization"] == "Bearer nvapi-SECRET-NVIDIA"
    assert "sk-or-SECRET-OPENROUTER" not in json.dumps(seen)


def test_openrouter_needs_its_key(monkeypatch):
    from app import config
    from app.it_triage import client as nem
    _use_provider(monkeypatch, "openrouter", "https://openrouter.ai/api/v1", "m")
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "")
    assert nem.live_enabled() is False  # NVIDIA key alone doesn't enable OpenRouter


def test_unavailable_free_model_surfaces_provider_error(client, monkeypatch):
    from app.it_triage import client as nem
    _use_provider(monkeypatch, "openrouter", "https://openrouter.ai/api/v1", "nvidia/nemotron-3-super-120b-a12b:free")
    monkeypatch.setattr(nem.httpx, "post", lambda *a, **k: _Resp(
        404, {"error": {"message": "No endpoints found for nvidia/nemotron-3-super-120b-a12b:free.", "code": 404}}))
    iid, req = seed(client)
    d = client.post(f"/api/incidents/{iid}/it-requests", json=req).json()
    assert d["triage"]["status"] == "failed" and d["draft"] is None and d["body"]
    assert "isn't available on OpenRouter" in d["triage"]["error"] and "404" in d["triage"]["error"]
    try:
        nem.chat([{"role": "user", "content": "x"}])
    except nem.ProviderError as exc:
        assert "No endpoints found" in exc.detail
