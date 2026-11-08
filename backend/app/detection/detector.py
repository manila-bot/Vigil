"""SIMULATED detection over fictional log fixtures.

Owner: NVIDIA & Detection teammate (core ships this minimal working version so the demo runs).
Contract: detect(events) -> list of findings. Each finding is a dict with keys
    host, user, window_start, window_end, rename_count, new_extension, matter_codes,
    signals (list of {kind, observed_at, description, detail}).
An empty list means "no alert" — the normal_activity fixture must return [].
"""
import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

RENAME_THRESHOLD = 15            # renames ...
WINDOW = timedelta(seconds=60)   # ... from one host within this window
KNOWN_EXTENSIONS = {".docx", ".doc", ".pdf", ".xlsx", ".xls", ".pptx", ".txt", ".msg", ".eml"}


def load_events(path: Path) -> list:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _ts(e):
    return datetime.fromisoformat(e["ts"].replace("Z", "+00:00"))


def _ext(path):
    name = path.rsplit("/", 1)[-1]
    return "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _matter(path):
    parts = path.split("/")
    return parts[3] if len(parts) > 3 and parts[1] == "dms" and parts[2] == "matters" else None


def detect(events: list) -> list:
    renames = defaultdict(list)
    for e in events:
        if e.get("event") == "file_rename" and _ext(e.get("new_path", "")) not in KNOWN_EXTENSIONS:
            renames[e["host"]].append(e)

    findings = []
    for host, evs in renames.items():
        evs.sort(key=_ts)
        start = 0
        best = None
        for end in range(len(evs)):
            while _ts(evs[end]) - _ts(evs[start]) > WINDOW:
                start += 1
            if end - start + 1 >= RENAME_THRESHOLD and (best is None or end - start > best[1] - best[0]):
                best = (start, end)
        if not best:
            continue
        burst = evs[best[0]: best[1] + 1]
        w_start, w_end = _ts(burst[0]), _ts(burst[-1])
        exts = sorted({_ext(e["new_path"]) for e in burst})
        matters = sorted({m for m in (_matter(e["path"]) for e in burst) if m})
        signals = [{
            "kind": "file_rename_burst",
            "observed_at": burst[0]["ts"],
            "description": f"{len(burst)} files renamed to {', '.join(exts)} on {host} in "
                           f"{int((w_end - w_start).total_seconds())} seconds",
            "detail": {"host": host, "user": burst[0]["user"], "sample_paths": [e["path"] for e in burst[:5]],
                       "matter_codes": matters},
        }]
        # Related signals from the same host or core services around the burst (±30 min).
        near = [e for e in events if abs(_ts(e) - w_start) <= timedelta(minutes=30)]
        renamed_paths = {e["path"] for e in burst}
        for e in near:
            if e["event"] == "file_create" and e["host"] == host and "readme" in e["path"].lower():
                signals.append({"kind": "ransom_note", "observed_at": e["ts"],
                                "description": f"Possible ransom note created: {e['path'].rsplit('/', 1)[-1]}",
                                "detail": {"path": e["path"], "host": host}})
            elif e["event"] == "network_outbound" and e["host"] == host:
                mb = round(e.get("bytes", 0) / 1_048_576, 1)
                signals.append({"kind": "outbound_transfer", "observed_at": e["ts"],
                                "description": f"{mb} MB sent to {e['dest']} — contents unknown, copying not verified",
                                "detail": {"dest": e["dest"], "bytes": e.get("bytes"), "host": host}})
            elif (e["event"] == "file_open_failed" and e["host"] == host
                  and e["path"] in renamed_paths and _ts(e) >= w_start):
                signals.append({"kind": "file_open_failed", "observed_at": e["ts"],
                                "description": f"Filing exhibit could not be opened: {e['path'].rsplit('/', 1)[-1]}",
                                "detail": {"host": host, "path": e["path"], "result": e["result"]}})
            elif e["event"] == "outbound_telemetry_gap" and e["host"] == host:
                signals.append({"kind": "outbound_telemetry_gap", "observed_at": e["ts"],
                                "description": f"Outbound telemetry is missing on {host}; copying remains unknown.",
                                "detail": {"host": host, "window_start": e["window_start"],
                                           "window_end": e["window_end"]}})
            elif e["event"] == "service_stopped":
                signals.append({"kind": "service_disruption", "observed_at": e["ts"],
                                "description": f"{e.get('service', 'service')} stopped on {e['host']}",
                                "detail": {"host": e["host"], "service": e.get("service")}})
        signals.sort(key=lambda s: s["observed_at"])
        findings.append({"host": host, "user": burst[0]["user"], "window_start": burst[0]["ts"],
                         "window_end": burst[-1]["ts"], "rename_count": len(burst), "new_extension": exts,
                         "matter_codes": matters, "signals": signals})
    return findings
