"""Read-only readiness report. Run: backend/.venv/bin/python backend/scripts/photon_preflight.py.

Never prints credentials or phone numbers and never creates a database.
"""
import os
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import config
from app.notify.sender_auth import find_authorized_it_sender

required = ('PHOTON_API_KEY', 'PHOTON_PROJECT_ID', 'PHOTON_TEST_SENDER',
            'PHOTON_AGENT_HANDLE', 'PHOTON_SPACE_ID', 'PHOTON_AGENT_USER_ID',
            'PHOTON_WEBHOOK_SECRET')
missing = [key for key in required if not os.getenv(key)]
print('Database:', config.DB_PATH.resolve())
print('Live Photon enabled:', config.PHOTON_ENABLED)
print('Missing configuration:', ', '.join(missing) or 'none')
if not config.DB_PATH.is_file():
    print('Database does not exist; start the backend first.')
    sys.exit(1)
conn = sqlite3.connect(config.DB_PATH.resolve().as_uri() + '?mode=ro', uri=True)
conn.row_factory = sqlite3.Row
try:
    sender = find_authorized_it_sender(conn, os.getenv('PHOTON_TEST_SENDER'))
    print('Exactly one authorized account matches test phone:', bool(sender))
    print('Readiness:', 'ready for supervised live test' if not missing and sender and config.PHOTON_ENABLED else 'not ready')
finally:
    conn.close()
