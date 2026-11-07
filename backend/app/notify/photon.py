"""Photon alert adapter. OWNER: Photon & Submission teammate.

send(phone, body, channel, idempotency_key) -> dict
    {"send_status": "accepted" | "failed" | "unknown",   # provider ACCEPTANCE only
     "provider": "photon" | "stub",
     "provider_message_id": str | None,
     "raw": {...}}                                        # stored as provider_response_json
Delivery confirmation and human acknowledgement are recorded later, separately
(POST /api/incidents/{id}/notifications/{nid}/ack for humans; add a delivery webhook here). Use 'unknown' on timeouts — the router will
NOT resend an 'unknown' send; implement check(provider_message_id) to resolve it.

Credentials come from env (e.g. PHOTON_API_KEY) and never leave the server.
"""
import uuid

from .. import config


def send(phone: str, body: str, channel: str, idempotency_key: str) -> dict:
    if not config.PHOTON_ENABLED:
        return {"send_status": "accepted", "provider": "stub",
                "provider_message_id": f"mock-{uuid.uuid4().hex[:12]}",
                "raw": {"mock": True, "note": "SIMULATED send — Photon disabled (VIGIL_PHOTON_ENABLED=0). "
                                              "No message left this server."}}
    return _send_photon(phone, body, channel, idempotency_key)


def _send_photon(phone, body, channel, idempotency_key):
    raise NotImplementedError("Real Photon send not implemented yet")


def check(provider_message_id: str):
    """Optional: look up a previous send's outcome. Return the same dict shape as send(), or None."""
    return None
