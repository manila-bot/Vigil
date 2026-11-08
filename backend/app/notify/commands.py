
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

    text = text.strip()

    # ACK acknowledges receipt but does not claim a task.
    match = re.fullmatch(r"ACK(?:\s+([A-Z0-9][A-Z0-9-]{0,63}))?", text, flags=re.IGNORECASE)
    if match:
        return PhotonCommand(action="ack", incident_code=match.group(1))

    # TAKE must identify a numeric task ID.
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
