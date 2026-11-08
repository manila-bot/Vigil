
"""Shared task-claim service for browser and Photon requests."""

from fastapi import HTTPException

from .db import now, row
from .services import add_event


def claim_task(conn, incident_id: int, task_id: int, user: dict):
    """Atomically claim an unassigned task for an authorized IT responder."""

    if (
        not user.get("active")
        or user.get("role") != "responder"
        or (user.get("team_role") or "").strip().casefold() != "it lead"
    ):
        raise HTTPException(403, "Only active IT leads can claim this task")

    task = row(conn.execute(
        "SELECT * FROM tasks WHERE id = ? AND incident_id = ?",
        (task_id, incident_id),
    ))

    if not task:
        raise HTTPException(404, "Task not found")

    if task["owner_user_id"] is not None:
        raise HTTPException(409, "Task already claimed")

    if task["status"] in ("done", "blocked"):
        raise HTTPException(409, "Task cannot be claimed in its current status")

    timestamp = now()

    result = conn.execute(
        """
        UPDATE tasks
        SET owner_user_id = ?,
            owner_label = ?,
            status = 'in_progress',
            updated_at = ?
        WHERE id = ?
          AND incident_id = ?
          AND owner_user_id IS NULL
          AND status = 'open'
        """,
        (user["id"], user["name"], timestamp, task_id, incident_id),
    )

    if result.rowcount != 1:
        raise HTTPException(409, "Task was already claimed or changed")

    add_event(
        conn,
        incident_id,
        "task_claimed",
        f"Task '{task['title']}' claimed by {user['name']}",
        user["id"],
        {"task_id": task_id, "owner_user_id": user["id"]},
    )

    return {
        "task_id": task_id,
        "incident_id": incident_id,
        "owner_user_id": user["id"],
        "status": "in_progress",
    }
