"""Which connection settings the engine gets, direct Postgres versus a pooler.

The statement cache must be off behind a transaction-mode pooler (named
statements would hit the wrong backend) and on otherwise. Pre-ping stays on
everywhere so a connection killed by a Postgres restart never reaches a request.
"""

import importlib.util
from unittest.mock import patch

import pytest

import app.core.config as config
from app.core.config import Settings

SECRET = "test-secret-key-0123456789abcdef0123456789"


def _settings(url, **overrides):
    return Settings(_env_file=None, DATABASE_URL=url, SECRET_KEY=SECRET, **overrides)


def _load_database_module(settings):
    """Execute core/database.py against these settings, as a separate module."""
    spec = importlib.util.spec_from_file_location(
        "_database_under_test", config.__file__.replace("config.py", "database.py")
    )
    module = importlib.util.module_from_spec(spec)
    with patch.object(config, "get_settings", return_value=settings):
        spec.loader.exec_module(module)
    return module


@pytest.mark.unit
@pytest.mark.parametrize(
    "url, flag, via_pooler",
    [
        ("postgresql+asyncpg://u:p@db:5432/app", False, False),
        ("postgresql+asyncpg://u:p@db:6543/app", False, True),
        ("postgresql+asyncpg://u:p@pgbouncer:6432/app", True, True),
    ],
)
def test_pooler_detection_honours_the_explicit_flag(url, flag, via_pooler):
    assert _settings(url, DATABASE_VIA_POOLER=flag).database_via_pooler is via_pooler


@pytest.mark.unit
@pytest.mark.parametrize(
    "url, flag, cache_on",
    [
        ("postgresql+asyncpg://u:p@db:5432/app", False, True),
        ("postgresql+asyncpg://u:p@db:6543/app", False, False),
        ("postgresql+asyncpg://u:p@pgbouncer:6432/app", True, False),
    ],
)
def test_engine_pre_pings_always_and_caches_statements_only_off_pooler(url, flag, cache_on):
    module = _load_database_module(_settings(url, DATABASE_VIA_POOLER=flag))
    try:
        assert module.engine.pool._pre_ping is True
        assert ("statement_cache_size" not in module._connect_args) is cache_on
    finally:
        module.engine.sync_engine.dispose()
