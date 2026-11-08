
"""Secure Photon 2.0 webhook receiver for Vigil."""

import base64
import hashlib
import hmac
import os
import time

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/webhooks", tags=["photon"])

MAX_WEBHOOK_AGE_SECONDS = 300


def verify_photon_signature(
    raw_body: bytes,
    headers,
    secret: str,
) -> bool:
    """Verify a Standard Webhooks HMAC-SHA256 signature."""

    webhook_id = headers.get("webhook-id", "")
    timestamp = headers.get("webhook-timestamp", "")
    signature_header = headers.get("webhook-signature", "")

    if not webhook_id or not timestamp or not signature_header:
        return False

    # Reject malformed metadata.
    if len(webhook_id) > 256 or "." in webhook_id:
        return False

    try:
        event_time = int(timestamp)
    except (ValueError, TypeError):
        return False

    # Reject expired and excessively future-dated requests.
    if abs(time.time() - event_time) > MAX_WEBHOOK_AGE_SECONDS:
        return False

    # Standard Webhooks secrets are base64-encoded.
    if not secret.startswith("whsec_"):
        return False

    try:
        key = base64.b64decode(
            secret.removeprefix("whsec_"),
            validate=True,
        )
    except (ValueError, base64.binascii.Error):
        return False

    if not key:
        return False

    signed_content = (
        f"{webhook_id}.{timestamp}.".encode("utf-8")
        + raw_body
    )

    expected_signature = "v1," + base64.b64encode(
        hmac.new(
            key,
            signed_content,
            hashlib.sha256,
        ).digest()
    ).decode("ascii")

    # Multiple signatures may be provided during key rotation.
    return any(
        hmac.compare_digest(expected_signature, signature)
        for signature in signature_header.split()
    )


@router.post("/photon")
async def receive_photon_webhook(request: Request):
    """Verify incoming events before any processing."""

    secret = os.getenv("PHOTON_WEBHOOK_SECRET")

    if not secret:
        raise HTTPException(
            status_code=503,
            detail="Photon webhook signing secret not configured",
        )

    raw_body = await request.body()

    if len(raw_body) > 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Webhook payload too large",
        )

   
    if not verify_photon_signature(
        raw_body,
        request.headers,
        secret,
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid Photon webhook signature",
        )

    # Temporary diagnostic for verified Photon events only.
    # Never print message text, phone numbers, or secrets.
    import json

    try:
        payload = json.loads(raw_body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(
            status_code=400,
            detail="Invalid JSON",
        )

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=400,
            detail="Expected JSON object",
        )

    event_data = payload.get("data")

    event_object = (
        event_data.get("object")
        if isinstance(event_data, dict)
        else None
    )

    print(
        "[Photon webhook diagnostic]",
        {
            "event_type": payload.get("type"),
            "top_level_keys": sorted(payload.keys()),
            "data_keys": (
                sorted(event_data.keys())
                if isinstance(event_data, dict)
                else []
            ),
            "object_keys": (
                sorted(event_object.keys())
                if isinstance(event_object, dict)
                else []
            ),
        },
        flush=True,
    )

    # Do not acknowledge events before processing is implemented.
    raise HTTPException(
        status_code=503,
        detail="Verified event processing not yet implemented",
    )
