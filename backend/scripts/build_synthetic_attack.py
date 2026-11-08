"""Build a fictional Vigil replay from the Data Designer filing preview."""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath

from app.detection.detector import detect, load_events
from scripts.preview_synthetic_activity import FILING_WORK, filing_events, generate_documents


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
ATTACK_HOST = "FILE-07"
RENAME_COUNT = 47
ATTACK_START = datetime(2026, 11, 7, 15, 0, tzinfo=timezone.utc)


def attack_replay(background, additional_paths):
    filing_paths = [event["new_path"] for event in background if event["event"] == "file_rename"]
    exhibit = next(
        (path for path in filing_paths if "/Exhibits/" in path and path.endswith(".pdf")),
        None,
    )
    if exhibit is None:
        raise SystemExit("The filing preview must contain a versioned PDF exhibit.")

    paths = [exhibit, *(path for path in filing_paths if path != exhibit), *additional_paths]
    if len(paths) != RENAME_COUNT or len(set(paths)) != RENAME_COUNT:
        raise SystemExit("Expected 47 distinct documents in the ransomware burst.")

    events = list(background)
    for index, path in enumerate(paths):
        renamed = f"{path}.vgl0ck"
        events.append(
            {
                "ts": (ATTACK_START + timedelta(seconds=index)).isoformat().replace("+00:00", "Z"),
                "host": ATTACK_HOST,
                "user": "demo-file-service",
                "event": "file_rename",
                "path": path,
                "new_path": renamed,
                # Synthetic fields modeled on Microsoft Defender DeviceFileEvents.
                "PreviousFileName": PurePosixPath(path).name,
                "FileName": PurePosixPath(renamed).name,
                "PreviousFolderPath": str(PurePosixPath(path).parent),
                "FolderPath": str(PurePosixPath(renamed).parent),
                "InitiatingProcessAccountName": "demo-file-service",
                "InitiatingProcessFileName": "unrecognized_worker.exe",
            }
        )
    events.extend(
        [
            {
                "ts": "2026-11-07T15:01:00Z",
                "host": ATTACK_HOST,
                "user": "demo-attorney",
                "event": "file_open_failed",
                "path": exhibit,
                "result": "original_path_missing_after_rename",
            },
            {
                "ts": "2026-11-07T15:02:00Z",
                "host": ATTACK_HOST,
                "event": "outbound_telemetry_gap",
                "window_start": "2026-11-07T14:59:00Z",
                "window_end": "2026-11-07T15:02:00Z",
                "copying": "unknown",
            },
        ]
    )
    findings = detect(events)
    if len(findings) != 1 or findings[0]["host"] != ATTACK_HOST or findings[0]["rename_count"] != RENAME_COUNT:
        raise SystemExit("Vigil did not detect exactly one 47-rename burst.")
    return events


def main():
    preview_path = DATA_DIR / "synthetic_filing_activity_preview.jsonl"
    if not preview_path.exists():
        raise SystemExit("Run scripts.preview_synthetic_activity before building the attack replay.")
    background = load_events(preview_path)
    if detect(background) or sum(event["event"] == "file_rename" for event in background) != len(FILING_WORK):
        raise SystemExit("Expected a benign filing preview with five versioned documents.")

    # Use two seeds per document type in each small batch to keep preview calls bounded.
    work = (FILING_WORK * 9)[: RENAME_COUNT - len(FILING_WORK)]
    documents = []
    for start in range(0, len(work), 10):
        documents.extend(generate_documents(work[start : start + 10]))
    additional_paths = [
        event["new_path"].replace("_v02.", "_share_copy_v02.")
        for event in filing_events(documents)
        if event["event"] == "file_rename"
    ]
    events = attack_replay(background, additional_paths)
    output = DATA_DIR / "synthetic_filing_attack_replay.jsonl"
    output.write_text("".join(json.dumps(event) + "\n" for event in events), encoding="utf-8")
    print(f"Wrote {len(events)} events. Vigil detected one 47-rename burst on {ATTACK_HOST}.")
    print(output)


if __name__ == "__main__":
    main()
