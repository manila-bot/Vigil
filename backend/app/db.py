"""SQLite storage. Core owner manages this schema — coordinate before changing columns."""
import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','responder')),
    team_role TEXT,                       -- e.g. 'Litigation lead', 'IT lead'
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    phone TEXT,                           -- only used for consented alerts
    alert_opt_in INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matters (
    id INTEGER PRIMARY KEY,
    matter_code TEXT NOT NULL UNIQUE,
    client_label TEXT NOT NULL,
    title TEXT NOT NULL,
    practice_area TEXT,
    lead_name TEXT,
    lead_role TEXT,
    deadline_at TEXT,
    deadline_label TEXT,
    path_prefix TEXT,
    is_simulated INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,            -- generic code safe to send outside Vigil
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','investigating','contained','recovering','closed')),
    severity TEXT NOT NULL DEFAULT 'high'
        CHECK (severity IN ('low','medium','high','critical')),
    category TEXT,                        -- e.g. 'ransomware'
    summary TEXT,
    detected_at TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','simulated')),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    ref TEXT NOT NULL,                    -- stable label like 'EV-1' used by tasks/AI
    kind TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    description TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    certainty TEXT NOT NULL DEFAULT 'observed' CHECK (certainty IN ('observed','confirmed','unknown')),
    is_simulated INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scope_items (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    system TEXT NOT NULL,
    data_category TEXT NOT NULL,
    matter_id INTEGER REFERENCES matters(id),
    availability TEXT NOT NULL DEFAULT 'unknown'
        CHECK (availability IN ('available','degraded','locked','destroyed','unknown')),
    copying TEXT NOT NULL DEFAULT 'unknown'
        CHECK (copying IN ('none_observed','suspected','confirmed','unknown')),
    certainty TEXT NOT NULL DEFAULT 'unknown' CHECK (certainty IN ('observed','confirmed','unknown')),
    notes TEXT,
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS triage_runs (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    status TEXT NOT NULL CHECK (status IN ('running','draft','approved','rejected','failed')),
    provider TEXT NOT NULL,               -- 'nemotron' or 'stub'
    model TEXT,
    tool_calls_json TEXT NOT NULL DEFAULT '[]',
    draft_json TEXT,
    error TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    decided_by INTEGER REFERENCES users(id),
    decided_at TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    title TEXT NOT NULL,
    owner_user_id INTEGER REFERENCES users(id),
    owner_label TEXT,
    priority TEXT NOT NULL DEFAULT 'high' CHECK (priority IN ('low','medium','high','critical')),
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','blocked')),
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
    evidence_refs_json TEXT NOT NULL DEFAULT '[]',
    triage_run_id INTEGER REFERENCES triage_runs(id),
    approved_by INTEGER REFERENCES users(id),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timeline_events (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    at TEXT NOT NULL,
    actor_user_id INTEGER REFERENCES users(id),
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    triage_run_id INTEGER REFERENCES triage_runs(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL,
    recipient_user_id INTEGER REFERENCES users(id),
    recipient_label TEXT NOT NULL,        -- masked, e.g. '***-***-1234'
    body TEXT NOT NULL,
    -- provider acceptance, confirmed delivery and human acknowledgement are tracked separately
    send_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (send_status IN ('pending','accepted','failed','unknown')),
    delivery_status TEXT NOT NULL DEFAULT 'unconfirmed'
        CHECK (delivery_status IN ('unconfirmed','delivered','undeliverable')),
    acknowledged_at TEXT,
    provider TEXT NOT NULL,               -- 'photon' or 'stub'
    provider_message_id TEXT,
    provider_response_json TEXT NOT NULL DEFAULT '{}',
    requested_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_timeline_incident ON timeline_events(incident_id, at);
CREATE INDEX IF NOT EXISTS ix_messages_incident ON messages(incident_id, id);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def get_db():
    """FastAPI dependency: one connection per request, committed at the end."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _local_tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(config.TIMEZONE)
    except Exception:  # tz database missing: fall back to US Central standard time
        return timezone(timedelta(hours=-6))


def local_deadline(hhmm: str, day_offset: int = 0) -> str:
    """Turn '14:00' into today's (or a later day's) local deadline, stored as UTC ISO."""
    tz = _local_tz()
    h, m = (int(x) for x in hhmm.split(":"))
    local = datetime.now(tz).replace(hour=h, minute=m, second=0, microsecond=0) + timedelta(days=day_offset)
    return local.astimezone(timezone.utc).isoformat(timespec="seconds")


def load_matters(conn: sqlite3.Connection) -> None:
    """(Re)load synthetic legal matters so deadlines are relative to 'today'."""
    data = json.loads((config.FIXTURES_DIR / "matters.json").read_text())
    for m in data["matters"]:
        deadline = local_deadline(m["deadline_local_time"], m.get("deadline_day_offset", 0)) \
            if m.get("deadline_local_time") else None
        conn.execute(
            """INSERT INTO matters (matter_code, client_label, title, practice_area, lead_name, lead_role,
                                    deadline_at, deadline_label, path_prefix, is_simulated)
               VALUES (?,?,?,?,?,?,?,?,?,1)
               ON CONFLICT(matter_code) DO UPDATE SET deadline_at=excluded.deadline_at,
                   deadline_label=excluded.deadline_label, title=excluded.title,
                   lead_name=excluded.lead_name, lead_role=excluded.lead_role,
                   path_prefix=excluded.path_prefix""",
            (m["matter_code"], m["client_label"], m["title"], m.get("practice_area"), m.get("lead_name"),
             m.get("lead_role"), deadline, m.get("deadline_label"), m.get("path_prefix")),
        )


def _bootstrap_users(conn: sqlite3.Connection) -> None:
    from .security import hash_password

    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        return
    lines = []
    admin_pw = config.ADMIN_PASSWORD or secrets.token_urlsafe(12)
    conn.execute(
        "INSERT INTO users (email, name, role, team_role, password_hash, created_at) VALUES (?,?,?,?,?,?)",
        (config.ADMIN_EMAIL, "Vigil Admin", "admin", "Incident commander", hash_password(admin_pw), now()),
    )
    if not config.ADMIN_PASSWORD:
        lines.append(f"admin      {config.ADMIN_EMAIL}  {admin_pw}")
    if config.SEED_DEMO_RESPONDER:
        resp_pw = config.RESPONDER_PASSWORD or secrets.token_urlsafe(12)
        conn.execute(
            "INSERT INTO users (email, name, role, team_role, password_hash, created_by, created_at)"
            " VALUES (?,?,?,?,?,1,?)",
            (config.RESPONDER_EMAIL, "Demo Responder", "responder", "Litigation lead",
             hash_password(resp_pw), now()),
        )
        if not config.RESPONDER_PASSWORD:
            lines.append(f"responder  {config.RESPONDER_EMAIL}  {resp_pw}")
    if lines:
        cred_file = config.DATA_DIR / "initial_credentials.txt"
        cred_file.parent.mkdir(parents=True, exist_ok=True)
        cred_file.write_text("Generated on first run. Change or delete after reading.\n" + "\n".join(lines) + "\n")
        print(f"[vigil] First-run accounts created. Credentials written to {cred_file}")


def init_db() -> None:
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        load_matters(conn)
        _bootstrap_users(conn)
        conn.commit()
    finally:
        conn.close()


def rows(cur) -> list:
    return [dict(r) for r in cur.fetchall()]


def row(cur):
    r = cur.fetchone()
    return dict(r) if r else None
