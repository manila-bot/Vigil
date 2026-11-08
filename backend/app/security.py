"""Vigil's own authentication. Deliberately independent of the firm's directory/SSO,
which we assume may be compromised."""
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone
from threading import Lock

from fastapi import Depends, HTTPException, Request, status

from . import config
from .db import get_db, now

_ITERATIONS = 200_000

# The two account roles. Use these names instead of typing the strings, so a typo fails loudly.
# (The database CHECK constraint and the Literal types in schemas.py must list the same values.)
ADMIN = "admin"
RESPONDER = "responder"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False


# Checked against when the email is unknown, so login takes the same time either way and
# doesn't reveal which accounts exist.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(conn, user_id: int) -> tuple:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=config.SESSION_HOURS)
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)",
        (_token_hash(token), user_id, now(), expires.isoformat(timespec="seconds")),
    )
    return token, expires.isoformat(timespec="seconds")


def delete_session(conn, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


def _bearer(request: Request):
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def current_user(request: Request, conn=Depends(get_db)) -> dict:
    token = _bearer(request)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")
    r = conn.execute(
        """SELECT u.id, u.email, u.name, u.role, u.team_role, u.active, s.expires_at
           FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?""",
        (_token_hash(token),),
    ).fetchone()
    # expires_at and now() are both ISO-8601 UTC strings, which sort in time order,
    # so comparing them as text is a correct "has it expired?" check.
    if not r or not r["active"] or r["expires_at"] < now():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired or invalid")
    user = dict(r)
    user.pop("expires_at")
    request.state.token = token  # kept so /auth/logout can delete this exact session
    return user


def require_admin(user: dict = Depends(current_user)) -> dict:
    if user["role"] != ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    return user


class LoginLimiter:
    """In-memory brute-force brake: N failures per email locks it briefly."""

    def __init__(self):
        self._fails = {}
        self._lock = Lock()

    def check(self, key: str) -> None:
        with self._lock:
            count, locked_until = self._fails.get(key, (0, 0.0))
            if locked_until > time.time():
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                                    "Too many failed sign-ins. Wait a minute and try again.")

    def fail(self, key: str) -> None:
        with self._lock:
            count, _ = self._fails.get(key, (0, 0.0))
            count += 1
            locked_until = time.time() + config.LOGIN_LOCK_SECONDS if count >= config.LOGIN_MAX_FAILURES else 0.0
            self._fails[key] = (0 if locked_until else count, locked_until)

    def success(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)


login_limiter = LoginLimiter()
