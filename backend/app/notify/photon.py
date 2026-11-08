
"""Photon 2.0 notification adapter for Vigil."""

import os
import uuid

import httpx

from .. import config


def send(phone: str, body: str, channel: str, idempotency_key: str) -> dict:
    if not config.PHOTON_ENABLED:
        return {
            "send_status": "accepted",
            "provider": "stub",
            "provider_message_id": f"mock-{uuid.uuid4().hex[:12]}",
            "raw": {
                "mock": True,
                "note": "SIMULATED send. No message left this server."
            },
        }

    return _send_photon(phone, body, channel, idempotency_key)


def _send_photon(phone, body, channel, idempotency_key):
    if channel != "imessage":
        raise ValueError("Only iMessage is configured for Photon.")

    # Initial test safeguard: allow only the configured phone.
    if phone != os.environ.get("PHOTON_TEST_SENDER"):
        raise ValueError("Recipient is not the authorized test sender.")

    project_id = os.environ["PHOTON_PROJECT_ID"]
    api_key = os.environ["PHOTON_API_KEY"]
    space_id = os.environ["PHOTON_SPACE_ID"]
    agent_id = os.environ["PHOTON_AGENT_USER_ID"]

    url = f"https://api.photon.codes/v1/projects/{project_id}/messages"

    payload = {
        "spaceId": space_id,
        "senderId": agent_id,
        "content": {
            "type": "text",
            "format": "plain",
            "text": body,
        },
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
    }

    try:
        response = httpx.post(
            url,
            headers=headers,
            json=payload,
            timeout=15.0,
        )
    except httpx.TimeoutException:
        return {
            "send_status": "unknown",
            "provider": "photon",
            "provider_message_id": None,
            "raw": {"error": "Request timed out; delivery outcome unknown"},
        }
    except httpx.RequestError:
        return {
            "send_status": "unknown",
            "provider": "photon",
            "provider_message_id": None,
            "raw": {"error": "Transport error; request outcome unknown"},
        }

    if 200 <= response.status_code < 300:
        try:
            data = response.json()
        except ValueError:
            data = {}

        return {
            "send_status": "accepted",
            "provider": "photon",
            "provider_message_id": data.get("id"),
            "raw": {
                "http_status": response.status_code,
                "message_id_present": bool(data.get("id")),
            },
        }

    return {
        "send_status": "failed" if response.status_code < 500 else "unknown",
        "provider": "photon",
        "provider_message_id": None,
        "raw": {
            "http_status": response.status_code,
            "error": "Photon API did not accept the request",
        },
    }


def check(provider_message_id: str):
    """Outcome lookup is not implemented yet."""
    return None
