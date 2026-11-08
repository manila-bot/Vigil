
"""Strict inbound command parsing for Vigil Photon messages."""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class PhotonCommand:
    action: str
    task_id: int | None = None
    incident_code: str | None = None


def parse_command(text: str) -> PhotonCommand | None:
    """Recognize ACK or TAKE commands without executing them."""

    if not isinstance(text, str):
        return None

    # Phones add smart dashes, trailing punctuation and odd spacing ("Take VIG 001.", "TAKE VIG–001").
    text = re.sub(r"[\u2010-\u2015\u2212]", "-", text)
    text = re.sub(r"\s+", " ", text).strip().rstrip(".!?,;:").strip()
    text = re.sub(r"\bVIG\s*-?\s*0*([0-9]{1,10})\b", lambda m: f"VIG-{int(m.group(1)):03d}", text, flags=re.IGNORECASE)

    # ACK acknowledges receipt but does not claim a task.
    match = re.fullmatch(r"ACK(?:\s+([A-Z0-9][A-Z0-9-]{0,63}))?", text, flags=re.IGNORECASE)
    if match:
        return PhotonCommand(action="ack", incident_code=match.group(1))

    match = re.fullmatch(r"TAKE\s+(VIG-[0-9]{1,10})", text, flags=re.IGNORECASE)
    if match:
        return PhotonCommand(action="take", incident_code=match.group(1).upper())

    # Keep numeric task IDs for incidents with multiple alerted tasks.
    match = re.fullmatch(
        r"TAKE\s+([1-9][0-9]{0,9})",
        text,
        flags=re.IGNORECASE,
    )

    if match:
        return PhotonCommand(
            action="take",
            task_id=int(match.group(1)),
        )

    return None
