"""Generate fictional background activity for review before building the attack replay."""

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.detection.detector import detect


FILING_WORK = (
    ("exhibit index", "Exhibits", "paralegal", "WS-LIT-03", "docx"),
    ("signed declaration", "Declarations", "paralegal", "WS-LIT-03", "pdf"),
    ("motion draft", "Pleadings", "attorney", "WS-LIT-07", "docx"),
    ("supporting exhibit", "Exhibits", "attorney", "WS-LIT-07", "pdf"),
    ("filing checklist", "Filing", "docketing", "WS-LIT-12", "docx"),
)


def filing_events(documents):
    start = datetime(2026, 11, 7, 14, 45, tzinfo=timezone.utc)
    events = []
    for index, document in enumerate(documents, start=1):
        stem = str(document["document_stem"]).strip()
        if not re.fullmatch(r"[A-Za-z0-9_]{3,48}", stem):
            raise SystemExit(f"Invalid filename stem in generated row {index}. No preview was written.")
        directory = f"/dms/matters/LIT-2291/{document['folder']}"
        extension = document["extension"]
        path = f"{directory}/{stem}_{index}_v01.{extension}"
        for offset, kind in ((0, "file_open"), (35, "file_save"), (45, "file_rename")):
            event = {
                "ts": (start + timedelta(minutes=index, seconds=offset)).isoformat().replace("+00:00", "Z"),
                "host": document["host"],
                "user": f"demo-{document['role']}",
                "event": kind,
                "path": path,
            }
            if kind == "file_rename":
                event["new_path"] = f"{directory}/{stem}_{index}_v02.{extension}"
            events.append(event)
    return events


def generate_documents(work):
    if not os.environ.get("NVIDIA_API_KEY"):
        raise SystemExit("Set NVIDIA_API_KEY in this PowerShell session before running the preview.")

    import data_designer.config as dd
    import pandas as pd
    from data_designer.interface import DataDesigner

    model = dd.ModelConfig(
        alias="vigil-nemotron",
        model="nvidia/nemotron-3.5-lightning-30b-a3b",
        provider="nvidia",
        inference_parameters=dd.ChatCompletionInferenceParams(
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        ),
    )
    provider = dd.ModelProvider(
        name="nvidia",
        endpoint="https://integrate.api.nvidia.com/v1",
        api_key="NVIDIA_API_KEY",
    )
    builder = dd.DataDesignerConfigBuilder(model_configs=[model])
    builder.with_seed_dataset(
        dd.DataFrameSeedSource(
            df=pd.DataFrame(work, columns=["document_kind", "folder", "role", "host", "extension"]),
        ),
    )
    builder.add_column(
        dd.LLMTextColumnConfig(
            name="document_stem",
            model_alias=model.alias,
            prompt=(
                "Invent one routine document filename stem for a fictional law firm's "
                "civil litigation filing packet. A {{ role }} is working on a {{ document_kind }}. "
                "Return only the stem, using 3 to 48 ASCII letters, "
                "numbers, and underscores. Omit extensions, version numbers, real names, "
                "and client information. Example format: Exhibit_Index."
            ),
        )
    )
    preview = DataDesigner(model_providers=[provider]).preview(builder, num_records=len(work))
    if preview.dataset is None or len(preview.dataset) != len(work):
        raise SystemExit(f"Expected {len(work)} generated records. No preview was written.")
    return preview.dataset.to_dict(orient="records")


def main():
    events = filing_events(generate_documents(FILING_WORK))
    if detect(events):
        raise SystemExit("The benign preview triggered an alert. No preview was written.")

    output = Path(__file__).resolve().parents[1] / "data" / "synthetic_filing_activity_preview.jsonl"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("".join(json.dumps(event) + "\n" for event in events), encoding="utf-8")
    print(f"Wrote {len(events)} synthetic events with zero detector alerts to {output}")


if __name__ == "__main__":
    main()
