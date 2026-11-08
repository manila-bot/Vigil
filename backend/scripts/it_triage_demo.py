"""Terminal demo of the Nemotron IT-help workflow. Uses a throwaway database (your real one is untouched).

    cd backend
    python scripts/it_triage_demo.py                       # submit "I can't open the exhibits", show the IT task
    python scripts/it_triage_demo.py --rerun-deadline 15:30 # then move the deadline and rerun triage
    python scripts/it_triage_demo.py --fail                # simulate Nemotron being down, then retry

Live Nemotron is used when backend/.env has VIGIL_NEMOTRON_ENABLED=1 and NVIDIA_API_KEY=nvapi-...
Otherwise it runs the FIXTURE provider. The output always says which one ran.
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from fastapi.testclient import TestClient  # noqa: E402

from app import config  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--request", default=None, help="what the lawyer typed")
ap.add_argument("--deadline", default=None, help="Central Time, e.g. 2026-11-08T14:00 (default: fixture file)")
ap.add_argument("--rerun-deadline", default=None, help="after the first draft, change the deadline (HH:MM) and rerun")
ap.add_argument("--fail", action="store_true", help="simulate Nemotron being unreachable on the first attempt")
ap.add_argument("--json", action="store_true", help="also print the full API response")
args = ap.parse_args()

tmp = Path(tempfile.mkdtemp())
config.DATA_DIR, config.DB_PATH = tmp, tmp / "demo.db"
config.ADMIN_PASSWORD, config.RESPONDER_PASSWORD = "demo-admin-pass", "demo-responder-pass"
from app.it_triage import client as nem  # noqa: E402
from app.it_triage.draft import as_text_card  # noqa: E402
from app.main import app  # noqa: E402

BAR = "─" * 72


def show(d):
    t = d["triage"]
    src = (f"LIVE NEMOTRON · model {t['model']}" if t["is_live_nemotron"]
           else "FIXTURE (not a live model response)" if t["provider"] == "fixture" else t["provider"] or "—")
    print(BAR)
    print(f"Request #{d['id']} (saved {d['created_at']}): \"{d['body']}\"  —  {d['requester_label'] or ''}")
    print(f"Triage: {t['status'].upper()} · attempt {t['attempts']} · provider: {src}")
    if t["tool_calls"]:
        for c in t["tool_calls"]:
            print(f"  tool {c['step']}: {c['tool']} (called by {c['requested_by']}, incident {c['scoped_to_incident']})"
                  f" → {c['result_summary']}")
    if t["error"]:
        print(f"  ERROR: {t['error']}")
    for n in t["validation"]:
        print(f"  validation: {n}")
    if d["draft"]:
        print(BAR)
        print(as_text_card(d["draft"]))
    print(BAR)
    if args.json:
        print(json.dumps(d, indent=2))


with TestClient(app) as c:
    tok = c.post("/api/auth/login", json={"email": "admin@vigil.local", "password": "demo-admin-pass"}).json()["token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    fx = c.post("/api/demo/it-fixture", json={"deadline_local": args.deadline} if args.deadline else {}).json()
    req = dict(fx["sample_request"])
    if args.request:
        req["body"] = args.request
    print(f"Demo incident {fx['incident_code']} (fictional). Live Nemotron configured: {nem.live_enabled()}")

    if args.fail:
        real_url, real_enabled, real_key = config.NEMOTRON_BASE_URL, config.NEMOTRON_ENABLED, config.NVIDIA_API_KEY
        config.NEMOTRON_BASE_URL, config.NEMOTRON_ENABLED = "http://127.0.0.1:9", True
        config.NVIDIA_API_KEY = real_key or "unreachable-test"
        d = c.post(f"/api/incidents/{fx['incident_id']}/it-requests", json=req).json()
        print("\n1) Provider down (simulated):")
        show(d)
        saved = c.get(f"/api/it-requests/{d['id']}").json()
        print(f"Request still visible: \"{saved['body']}\" · can retry: {saved['triage']['can_retry']}")
        config.NEMOTRON_BASE_URL, config.NEMOTRON_ENABLED, config.NVIDIA_API_KEY = real_url, real_enabled, real_key
        print("\n2) Retry:")
        d = c.post(f"/api/it-requests/{d['id']}/triage").json()
    else:
        d = c.post(f"/api/incidents/{fx['incident_id']}/it-requests", json=req).json()
    show(d)

    if args.rerun_deadline:
        day = (args.deadline or json.loads((config.FIXTURES_DIR / "it_triage" / "exhibits_incident.json")
                                           .read_text())["matter"]["deadline_local"]).split("T")[0]
        c.post("/api/demo/matters/LIT-4417/deadline", json={"deadline_local": f"{day}T{args.rerun_deadline}"})
        print(f"\nDeadline changed to {args.rerun_deadline} CT on the matter record. Rerunning triage…")
        show(c.post(f"/api/it-requests/{d['id']}/triage").json())
