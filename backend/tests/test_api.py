import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import config
    from app.security import login_limiter
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "admin-pass-123")
    monkeypatch.setattr(config, "RESPONDER_PASSWORD", "responder-pass-123")
    monkeypatch.setattr(config, "NEMOTRON_ENABLED", False)
    monkeypatch.setattr(config, "PHOTON_ENABLED", False)
    login_limiter._fails.clear()
    from app.main import app
    with TestClient(app) as c:
        yield c


import json


def login(c, email, pw):
    r = c.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def admin(c):
    return login(c, "admin@vigil.local", "admin-pass-123")


def responder(c):
    return login(c, "responder@vigil.local", "responder-pass-123")


def test_generated_replay_surfaces_exhibit_and_telemetry_gap(client, tmp_path, monkeypatch):
    from scripts.build_synthetic_attack import attack_replay

    exhibit = "/dms/matters/LIT-2291/Exhibits/Exhibit_A_v02.pdf"
    background = [{
        "ts": "2026-11-07T14:50:00Z",
        "host": "WS-LIT-07",
        "event": "file_rename",
        "path": exhibit.replace("_v02", "_v01"),
        "new_path": exhibit,
    }]
    events = attack_replay(background, [f"/dms/matters/LIT-2291/Doc_{n}.pdf" for n in range(46)])
    (tmp_path / "synthetic_filing_attack_replay.jsonl").write_text(
        "".join(json.dumps(event) + "\n" for event in events), encoding="utf-8",
    )
    monkeypatch.setenv("VIGIL_USE_GENERATED_REPLAY", "1")

    headers = responder(client)
    response = client.post("/api/demo/simulate", headers=headers)
    assert response.status_code == 200, response.text
    result = response.json()
    evidence = {item["kind"]: item for item in result["incident"]["evidence"]}
    assert "47 files renamed" in evidence["file_rename_burst"]["description"]
    assert evidence["file_open_failed"]["detail"]["path"] == exhibit
    assert evidence["outbound_telemetry_gap"]["certainty"] == "unknown"
    assert result["incident"]["scope"][0]["copying"] == "unknown"
    replay = client.post("/api/demo/simulate", headers=headers).json()
    assert (replay["created"], replay["incident_id"]) == (False, result["incident_id"])


def test_it_request_can_only_be_claimed_once(client):
    lawyer = responder(client)
    admin_headers = admin(client)
    it_users = []
    for index in (1, 2):
        email = f"it-{index}@vigil.local"
        response = client.post("/api/users", headers=admin_headers, json={
            "email": email, "name": f"IT {index}", "role": "responder",
            "team_role": "IT lead", "password": "demo-it-password",
        })
        assert response.status_code == 201, response.text
        it_users.append((response.json()["id"], login(client, email, "demo-it-password")))

    incident_id = client.post("/api/demo/simulate", headers=lawyer).json()["incident_id"]
    path = f"/api/incidents/{incident_id}"
    body = {"matter_code": "LIT-2291", "body": "Please verify a clean copy of the exhibits."}
    request = client.post(f"{path}/requests", headers=lawyer, json=body).json()
    duplicate = client.post(f"{path}/requests", headers=lawyer, json=body).json()
    assert duplicate["request_id"] == request["request_id"]
    assert duplicate["request_status"] == "task_ready"
    assert len(duplicate["tasks"]) == 1
    task_id = request["requests"][0]["task_id"]
    task_path = f"{path}/tasks/{task_id}"
    claim_path = f"{task_path}/claim"
    owner_id, owner_headers = it_users[0]
    assert client.post(claim_path, headers=lawyer).status_code == 403
    assert client.patch(task_path, headers=lawyer, json={"owner_user_id": owner_id}).status_code == 409
    assert client.post(claim_path, headers=owner_headers).status_code == 200
    assert client.post(claim_path, headers=owner_headers).status_code == 200
    assert client.post(claim_path, headers=it_users[1][1]).status_code == 409

    incident = client.get(path, headers=lawyer).json()
    assert incident["requests"][0]["status"] == "claimed"
    assert incident["tasks"][0]["owner_user_id"] == owner_id
    assert [event["kind"] for event in incident["timeline"]].count("task_claimed") == 1
    assert client.post("/api/demo/reset", headers=admin_headers).status_code == 200


def test_unauthorized_requests_blocked(client):
    for method, path in [("get", "/api/dashboard"), ("get", "/api/incidents"), ("post", "/api/demo/simulate"),
                         ("get", "/api/incidents/1"), ("post", "/api/incidents/1/messages"), ("get", "/api/users")]:
        assert getattr(client, method)(path).status_code == 401, path
    bad = client.get("/api/incidents", headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401


def test_wrong_password_and_lockout(client):
    for _ in range(5):
        assert client.post("/api/auth/login", json={"email": "admin@vigil.local", "password": "x"}).status_code == 401
    assert client.post("/api/auth/login",
                       json={"email": "admin@vigil.local", "password": "admin-pass-123"}).status_code == 429


def test_admin_adds_and_deactivates_responder(client):
    a, r = admin(client), responder(client)
    new = {"email": "it@vigil.local", "name": "Pat IT", "role": "responder", "team_role": "IT lead",
           "password": "it-lead-pass-1", "phone": "+15555550123", "alert_opt_in": True}
    assert client.post("/api/users", json=new, headers=r).status_code == 403  # responders can't add people
    created = client.post("/api/users", json=new, headers=a)
    assert created.status_code == 201 and created.json()["phone_masked"] == "***-***-0123"
    assert "phone" not in created.json()
    it = login(client, "it@vigil.local", "it-lead-pass-1")
    uid = created.json()["id"]
    assert client.patch(f"/api/users/{uid}", json={"active": False}, headers=a).status_code == 200
    assert client.get("/api/incidents", headers=it).status_code == 401  # session revoked immediately
    assert client.post("/api/auth/login", json={"email": "it@vigil.local", "password": "it-lead-pass-1"}).status_code == 401


def test_normal_logs_produce_no_alert(client):
    r = client.post("/api/demo/simulate", json={"fixture": "normal_activity"}, headers=responder(client))
    assert r.status_code == 200 and r.json()["detected"] is False
    assert client.get("/api/incidents", headers=responder(client)).json() == []


def test_full_demo_flow(client):
    a, r = admin(client), responder(client)
    sim = client.post("/api/demo/simulate", json={"fixture": "ransomware_burst"}, headers=r).json()
    assert sim["detected"] and sim["created"]
    iid = sim["incident_id"]
    again = client.post("/api/demo/simulate", json={"fixture": "ransomware_burst"}, headers=r).json()
    assert again["created"] is False and again["incident_id"] == iid  # no duplicate incidents

    d = client.get(f"/api/incidents/{iid}", headers=r).json()
    labels = [h["label"] for h in d["headline"]]
    assert any(l.endswith("court filing at risk") for l in labels)
    assert "Files locked" in labels and "Data copying unverified" in labels
    assert {s["availability"] for s in d["scope"]} == {"locked", "degraded"}
    assert all(e["is_simulated"] for e in d["evidence"])

    # AI triage (mock) uses real tools and waits for approval
    d = client.post(f"/api/incidents/{iid}/triage", headers=r).json()
    t = d["triage"]
    assert t["status"] == "draft" and t["is_mock"]
    assert [c["tool"] for c in t["tool_calls"]] == ["get_incident_evidence", "get_affected_matters", "list_responders"]
    assert "backup" in t["draft"]["tasks"][0]["title"].lower()
    assert d["tasks"] == []  # nothing created before approval

    # Alert is blocked until a human approves
    users_list = client.get("/api/users", headers=a).json()
    resp_id = next(u["id"] for u in users_list if u["email"] == "responder@vigil.local")
    assert client.post(f"/api/incidents/{iid}/notify", json={"recipient_user_id": resp_id},
                       headers=r).status_code == 409

    d = client.post(f"/api/incidents/{iid}/approve", json={"triage_id": t["id"]}, headers=r).json()
    assert d["triage"]["status"] == "approved" and d["triage"]["decided_by"] == "Demo Responder"
    assert len(d["tasks"]) == len(t["draft"]["tasks"]) and all(x["source"] == "ai" for x in d["tasks"])
    backup = next(x for x in d["tasks"] if "backup" in x["title"].lower())
    assert backup["approved_by_name"] == "Demo Responder"
    assert backup["owner_name"] == "Demo Responder"  # matched 'Litigation lead'
    assert client.post(f"/api/incidents/{iid}/approve", json={"triage_id": t["id"]}, headers=r).status_code == 409

    # Recipient must consent first
    assert client.post(f"/api/incidents/{iid}/notify", json={"recipient_user_id": resp_id},
                       headers=r).status_code == 422
    client.patch(f"/api/users/{resp_id}", json={"phone": "+15555550199", "alert_opt_in": True}, headers=a)
    first = client.post(f"/api/incidents/{iid}/notify", json={"recipient_user_id": resp_id}, headers=r).json()
    second = client.post(f"/api/incidents/{iid}/notify", json={"recipient_user_id": resp_id}, headers=r).json()
    assert first["notify_result"]["duplicate"] is False and second["notify_result"]["duplicate"] is True
    assert len(second["notifications"]) == 1  # repeated clicks -> one send
    n = second["notifications"][0]
    assert n["send_status"] == "accepted" and n["delivery_status"] == "unconfirmed" and n["acknowledged_at"] is None
    assert n["is_mock"] and "Harlow" not in n["body"] and "LIT-2291" not in n["body"]

    # Chat visible from a second session; timeline records it
    client.post(f"/api/incidents/{iid}/messages", json={"body": "Backup copy located."}, headers=r)
    other = client.get(f"/api/incidents/{iid}", headers=a).json()
    assert other["messages"][-1]["body"] == "Backup copy located."
    kinds = [e["kind"] for e in other["timeline"]]
    for k in ("detection", "triage_drafted", "triage_approved", "alert_sent", "message"):
        assert k in kinds
    assert client.get(f"/api/incidents/{iid}/messages?after_id=0", headers=a).json()[-1]["user_name"] == "Demo Responder"

    # Scope update + task status are recorded
    sid = other["scope"][0]["id"]
    d = client.patch(f"/api/incidents/{iid}/scope/{sid}", json={"copying": "none_observed", "certainty": "confirmed"},
                     headers=a).json()
    assert any("copying unverified → no copying observed" in e["summary"] for e in d["timeline"])
    task_id = d["tasks"][0]["id"]
    d = client.patch(f"/api/incidents/{iid}/tasks/{task_id}", json={"status": "done"}, headers=r).json()
    assert any(x["id"] == task_id and x["status"] == "done" for x in d["tasks"])

    dash = client.get("/api/dashboard", headers=r).json()
    assert dash["urgent_deadlines"][0]["matter_code"] == "LIT-2291"
    assert dash["recent_activity"]


def test_records_survive_restart(client):
    r = responder(client)
    iid = client.post("/api/incidents", json={"title": "Phishing report"}, headers=r).json()["incident"]["id"]
    client.post(f"/api/incidents/{iid}/messages", json={"body": "hello"}, headers=r)
    import app.main
    with TestClient(app.main.app) as c2:  # new app lifespan, same database file
        d = c2.get(f"/api/incidents/{iid}", headers=r).json()
        assert d["incident"]["title"] == "Phishing report" and d["messages"][0]["body"] == "hello"


def test_core_works_with_providers_failing(client, monkeypatch):
    """Even with the Photon/Nemotron modules broken, records, status and chat keep working."""
    import app.notify.photon as photon
    import app.routers.response as response
    monkeypatch.setattr(response, "run_triage", lambda conn, inc: (_ for _ in ()).throw(RuntimeError("model down")))
    monkeypatch.setattr(photon, "send", lambda *a, **k: (_ for _ in ()).throw(TimeoutError("no answer")))
    r = responder(client)
    iid = client.post("/api/demo/simulate", headers=r).json()["incident_id"]
    d = client.post(f"/api/incidents/{iid}/triage", headers=r).json()
    assert d["triage"]["status"] == "failed"
    d = client.patch(f"/api/incidents/{iid}", json={"status": "contained"}, headers=r).json()
    assert d["incident"]["status"] == "contained"
    d = client.post(f"/api/incidents/{iid}/messages", json={"body": "Still coordinating here"}, headers=r).json()
    assert d["messages"][-1]["body"] == "Still coordinating here"


def test_unknown_send_is_not_repeated(client, monkeypatch):
    import app.notify.photon as photon
    calls = []

    def flaky(*a, **k):
        calls.append(1)
        raise TimeoutError("timed out")

    monkeypatch.setattr(photon, "send", flaky)
    a, r = admin(client), responder(client)
    iid = client.post("/api/demo/simulate", headers=r).json()["incident_id"]
    tid = client.post(f"/api/incidents/{iid}/triage", headers=r).json()["triage"]["id"]
    client.post(f"/api/incidents/{iid}/approve", json={"triage_id": tid}, headers=r)
    rid = next(u["id"] for u in client.get("/api/users", headers=a).json() if u["role"] == "responder")
    client.patch(f"/api/users/{rid}", json={"phone": "+15555550100", "alert_opt_in": True}, headers=a)
    first = client.post(f"/api/incidents/{iid}/notify", json={"recipient_user_id": rid}, headers=r).json()
    assert first["notifications"][0]["send_status"] == "unknown"
    second = client.post(f"/api/incidents/{iid}/notify", json={"recipient_user_id": rid}, headers=r).json()
    assert second["notify_result"]["duplicate"] is True and len(calls) == 1


def test_runbook_aliases_codes_and_me(client):
    r = responder(client)
    assert client.post("/api/demo/simulate", json={"fixture": "benign"}, headers=r).json()["detected"] is False
    sim = client.post("/api/demo/simulate", json={"fixture": "rename_burst"}, headers=r).json()
    assert sim["created"] is True
    detail = client.get(f"/api/incidents/{sim['incident_id']}", headers=r).json()
    assert detail["incident"]["code"] == "VIG-001"
    lit = next(m for m in detail["matters_at_risk"] if m["matter_code"] == "LIT-2291")
    assert lit["deadline_local"] == "Tomorrow 2:00 PM"
    assert client.get("/api/me", headers=r).json()["email"] == "responder@vigil.local"
