
"""Verify whether a Photon sender is an authorized Vigil IT responder."""

import re


def normalize_phone(phone: str) -> str | None:
    """Normalize US test phone numbers into +1XXXXXXXXXX format."""

    if not isinstance(phone, str):
        return None

    value = phone.strip()

    # Allow only common phone formatting characters.
    if not re.fullmatch(r"\+?[\d\s().-]+", value):
        return None

    digits = re.sub(r"\D", "", value)

    if len(digits) == 10:
        return "+1" + digits

    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits

    return None


def find_authorized_it_sender(conn, sender_handle: str):
    """Match a Photon sender to exactly one active, opted-in IT lead."""

    incoming = normalize_phone(sender_handle)

    if not incoming:
        return None

    candidates = conn.execute(
        """
        SELECT id, name, role, team_role, active,
               phone, alert_opt_in
        FROM users
        WHERE active = 1
          AND role = 'responder'
          AND alert_opt_in = 1
          AND lower(trim(team_role)) = 'it lead'
          AND phone IS NOT NULL
        """
    ).fetchall()

    matches = [
        dict(user)
        for user in candidates
        if normalize_phone(user["phone"]) == incoming
    ]

    # Never guess if two users share the same phone.
    if len(matches) != 1:
        return None

    return matches[0]
