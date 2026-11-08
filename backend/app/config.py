"""Runtime settings. Everything sensitive comes from environment variables, never from the repo."""
import os
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent

# Load private local configuration before reading environment variables.
load_dotenv(BACKEND_DIR / ".env")

FIXTURES_DIR = BACKEND_DIR / "fixtures"
DATA_DIR = Path(os.getenv("VIGIL_DATA_DIR", BACKEND_DIR / "data"))
DB_PATH = Path(os.getenv("VIGIL_DB_PATH", DATA_DIR / "vigil.db"))
FRONTEND_DIST = Path(os.getenv("VIGIL_FRONTEND_DIST", REPO_DIR / "frontend" / "dist"))

# Local time zone used for legal deadlines in the synthetic fixture (e.g. "2:00 PM filing").
TIMEZONE = os.getenv("VIGIL_TZ", "America/Chicago")

SESSION_HOURS = int(os.getenv("VIGIL_SESSION_HOURS", "12"))
LOGIN_MAX_FAILURES = int(os.getenv("VIGIL_LOGIN_MAX_FAILURES", "5"))
LOGIN_LOCK_SECONDS = int(os.getenv("VIGIL_LOGIN_LOCK_SECONDS", "60"))

# Comma-separated origins allowed to call the API from a browser during development
# (e.g. the Lovable preview URL). The production demo serves the UI from the same origin.
CORS_ORIGINS = [o.strip() for o in os.getenv("VIGIL_CORS_ORIGINS", "").split(",") if o.strip()]

# External providers are OFF unless explicitly enabled. Core features never depend on them.
NEMOTRON_ENABLED = os.getenv("VIGIL_NEMOTRON_ENABLED", "0") == "1"
PHOTON_ENABLED = os.getenv("VIGIL_PHOTON_ENABLED", "0") == "1"

# First-run bootstrap accounts. If passwords are not provided, random ones are generated
# and written once to data/initial_credentials.txt (gitignored).
ADMIN_EMAIL = os.getenv("VIGIL_ADMIN_EMAIL", "admin@vigil.local")
ADMIN_PASSWORD = os.getenv("VIGIL_ADMIN_PASSWORD")
SEED_DEMO_RESPONDER = os.getenv("VIGIL_SEED_DEMO_RESPONDER", "1") == "1"
RESPONDER_EMAIL = os.getenv("VIGIL_RESPONDER_EMAIL", "responder@vigil.local")
RESPONDER_PASSWORD = os.getenv("VIGIL_RESPONDER_PASSWORD")
