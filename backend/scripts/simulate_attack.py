"""Trigger the synthetic ransomware detection from the backend (no button in the app).

Run from backend/ while the server is running. Everything it creates is labeled SIMULATED.

    .venv/bin/python -m scripts.simulate_attack           # replay the ransomware log -> opens VIG-00x
    .venv/bin/python -m scripts.simulate_attack normal    # replay a normal day -> no incident
    .venv/bin/python -m scripts.simulate_attack reset     # wipe incidents (keeps users and matters)
    .venv/bin/python -m scripts.simulate_attack reset attack   # clean slate, then the attack

Signed-in screens pick up the new incident within two seconds.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import connect, init_db  # noqa: E402
from app.routers.demo import reset_demo, run_detection  # noqa: E402

FIXTURES = {"attack": "ransomware_burst", "normal": "normal_activity"}


def main(args) -> int:
    steps = args or ["attack"]
    unknown = [a for a in steps if a not in (*FIXTURES, "reset")]
    if unknown:
        print(f"Unknown step {unknown[0]!r}. Use: attack, normal, reset.")
        return 2
    init_db()
    conn = connect()
    try:
        for step in steps:
            if step == "reset":
                reset_demo(conn)
                conn.commit()
                print("Reset: incidents, tasks, messages and alerts removed. Users and matters kept.")
                continue
            result = run_detection(conn, FIXTURES[step])
            conn.commit()
            if not result["detected"]:
                print(f"Scanned {result['events_scanned']} events: {result['message']}")
            elif not result["created"]:
                print(f"Already tracked as incident id {result['incident_id']}: {result['message']}")
            else:
                inc = result["incident"]["incident"]
                print(f"Detected ransomware: opened {inc['code']} - {inc['title']}")
                print(f"Open http://localhost:8080/incidents/{inc['id']}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
