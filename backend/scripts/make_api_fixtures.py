"""Regenerate fixtures/api/*.json by running the demo flow against a throwaway database.
Frontend builds against these files first. Run from backend/:  python scripts/make_api_fixtures.py"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from fastapi.testclient import TestClient  # noqa: E402

from app import config  # noqa: E402

tmp = Path(tempfile.mkdtemp())
config.DATA_DIR, config.DB_PATH = tmp, tmp / "fixture.db"
config.ADMIN_PASSWORD, config.RESPONDER_PASSWORD = "fixture-admin-1", "fixture-responder-1"
config.NEMOTRON_ENABLED = config.PHOTON_ENABLED = False
from app.main import app  # noqa: E402

out = config.FIXTURES_DIR / "api"
out.mkdir(exist_ok=True)


def save(name, data):
    (out / name).write_text(json.dumps(data, indent=2) + "\n")


with TestClient(app) as c:
    login = c.post("/api/auth/login", json={"email": "responder@vigil.local", "password": "fixture-responder-1"}).json()
    r = {"Authorization": f"Bearer {login['token']}"}
    a = {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": "admin@vigil.local",
                                                                       "password": "fixture-admin-1"}).json()["token"]}
    login["token"] = "<opaque-session-token>"
    save("login.json", login)
    save("simulate_normal.json", c.post("/api/demo/simulate", json={"fixture": "normal_activity"}, headers=r).json())
    sim = c.post("/api/demo/simulate", json={"fixture": "ransomware_burst"}, headers=r).json()
    iid = sim["incident_id"]
    save("incident_after_simulate.json", sim["incident"])
    d = c.post(f"/api/incidents/{iid}/triage", headers=r).json()
    save("incident_with_triage_draft.json", d)
    rid = login["user"]["id"]
    c.patch(f"/api/users/{rid}", json={"phone": "+15555550123", "alert_opt_in": True}, headers=a)
    c.post(f"/api/incidents/{iid}/approve", json={"triage_id": d["triage"]["id"]}, headers=r)
    c.post(f"/api/incidents/{iid}/notify", json={"recipient_user_id": rid}, headers=r)
    c.post(f"/api/incidents/{iid}/messages", json={"body": "Backup copy located."}, headers=r)
    save("incident_full.json", c.get(f"/api/incidents/{iid}", headers=r).json())
    save("dashboard.json", c.get("/api/dashboard", headers=r).json())
    save("users_admin_view.json", c.get("/api/users", headers=a).json())
    save("system_status.json", c.get("/api/system/status", headers=r).json())
print("wrote", sorted(p.name for p in out.iterdir()))
