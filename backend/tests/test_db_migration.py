import sqlite3


def test_old_it_requests_table_is_moved_aside(tmp_path, monkeypatch):
    """A database from before the filing-request rename must still load incidents."""
    from app import config, db, services
    from app.it_triage import store
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "old.db")
    old = sqlite3.connect(tmp_path / "old.db")
    old.executescript("""
        CREATE TABLE it_requests (id INTEGER PRIMARY KEY, incident_id INTEGER NOT NULL, body TEXT NOT NULL,
                                  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX ix_it_requests_incident ON it_requests(incident_id, id);
        INSERT INTO it_requests VALUES (1, 1, 'old draft', '2026-11-08', '2026-11-08');
    """)
    old.commit()
    old.close()

    db.init_db()
    db.init_db()  # idempotent
    conn = db.connect()
    store.ensure_schema(conn)  # app startup creates the IT triage tables after init_db
    cols = {r[1] for r in conn.execute("PRAGMA table_info(it_requests)")}
    assert {"matter_id", "requester_id", "task_id"} <= cols
    assert conn.execute("SELECT body FROM it_requests_legacy").fetchone()[0] == "old draft"
    links = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'workspace_triage_links'").fetchone()[0]
    assert "REFERENCES it_requests(id)" in links
    ts = db.now()
    iid = conn.execute("INSERT INTO incidents (code, title, detected_at, source, created_at, updated_at) "
                       "VALUES ('VIG-0001', 't', ?, 'manual', ?, ?)", (ts, ts, ts)).lastrowid
    assert services.incident_detail(conn, iid)["requests"] == []


def test_demo_reset_works_after_migration(tmp_path, monkeypatch):
    from app import config, db
    from app.it_triage import store
    from app.routers import demo
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "old.db")
    old = sqlite3.connect(tmp_path / "old.db")
    old.executescript("""
        CREATE TABLE incidents (id INTEGER PRIMARY KEY, code TEXT, title TEXT, detected_at TEXT, source TEXT,
                                created_at TEXT, updated_at TEXT);
        INSERT INTO incidents (id, code, title, detected_at, source, created_at, updated_at)
            VALUES (1, 'VIG-0001', 't', 'x', 'manual', 'x', 'x');
        CREATE TABLE it_requests (id INTEGER PRIMARY KEY, incident_id INTEGER NOT NULL REFERENCES incidents(id),
                                  body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO it_requests VALUES (1, 1, 'old draft', 'x', 'x');
    """)
    old.commit()
    old.close()
    db.init_db()
    conn = db.connect()
    store.ensure_schema(conn)
    assert demo.reset(admin={"id": 1}, conn=conn) == {"ok": True}
    assert conn.execute("SELECT COUNT(*) FROM incidents").fetchone()[0] == 0
