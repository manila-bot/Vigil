"""Access page: admins add and deactivate responders. Everyone signed in can list active people
(needed to assign tasks)."""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from ..db import get_db, now, row, rows
from ..schemas import UserCreate, UserUpdate
from ..security import current_user, hash_password, require_admin

router = APIRouter(prefix="/users", tags=["users"])

PUBLIC_COLS = "id, email, name, role, team_role, active, alert_opt_in, created_at"


def mask_phone(phone):
    if not phone:
        return None
    digits = "".join(ch for ch in phone if ch.isdigit())
    return f"***-***-{digits[-4:]}" if len(digits) >= 4 else "***"


def _public(u: dict) -> dict:
    out = {k: u[k] for k in ("id", "email", "name", "role", "team_role", "created_at")}
    out["active"] = bool(u["active"])
    out["alert_opt_in"] = bool(u["alert_opt_in"])
    out["phone_masked"] = mask_phone(u.get("phone"))
    return out


@router.get("")
def list_users(user=Depends(current_user), conn=Depends(get_db)):
    q = "SELECT * FROM users" + ("" if user["role"] == "admin" else " WHERE active = 1") + " ORDER BY name"
    return [_public(u) for u in rows(conn.execute(q))]


@router.post("", status_code=201)
def create_user(body: UserCreate, admin=Depends(require_admin), conn=Depends(get_db)):
    try:
        cur = conn.execute(
            """INSERT INTO users (email, name, role, team_role, password_hash, phone, alert_opt_in, created_by, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (body.email.strip().lower(), body.name.strip(), body.role, body.team_role,
             hash_password(body.password), body.phone, int(body.alert_opt_in), admin["id"], now()),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "A person with that email already exists")
    return _public(row(conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,))))


@router.patch("/{user_id}")
def update_user(user_id: int, body: UserUpdate, admin=Depends(require_admin), conn=Depends(get_db)):
    target = row(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)))
    if not target:
        raise HTTPException(404, "User not found")
    changes = body.model_dump(exclude_unset=True)
    if user_id == admin["id"] and (changes.get("active") is False or changes.get("role") == "responder"):
        raise HTTPException(400, "You can't deactivate or demote your own account")
    if "password" in changes:
        changes["password_hash"] = hash_password(changes.pop("password"))
    for flag in ("active", "alert_opt_in"):
        if flag in changes:
            changes[flag] = int(changes[flag])
    if changes:
        sets = ", ".join(f"{k} = ?" for k in changes)
        conn.execute(f"UPDATE users SET {sets} WHERE id = ?", (*changes.values(), user_id))
        if changes.get("active") == 0:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))  # kick them out now
    return _public(row(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))))
