from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def pytest_configure(config):
    _ = config
    import os

    if os.getenv("YUZIK_TEST_ALLOW_REAL_SUPABASE"):
        return

    for name in (
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_JWT_ISSUER",
        "SUPABASE_JWT_AUDIENCE",
    ):
        os.environ[name] = ""
