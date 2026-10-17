"""Startup refusal of placeholder secrets. Must not depend on ENVIRONMENT."""
import pytest
from pydantic import ValidationError

from app.core.config import Settings

STRONG = "a" * 8 + "0123456789abcdef" * 3
DEV_PLACEHOLDER = "dev-only-key-do-not-use-in-production-abc123xyz"
REMOTE = "postgresql+asyncpg://u:{pw}@postgres:5432/db"


def make(**kw):
    kw.setdefault("DATABASE_URL", REMOTE.format(pw="strongpw"))
    kw.setdefault("SECRET_KEY", STRONG)
    # _env_file=None skips .env files, but os.environ is still read, and the dev
    # compose file sets ALLOW_INSECURE_DEFAULTS=true in the backend container.
    kw.setdefault("ALLOW_INSECURE_DEFAULTS", False)
    return Settings(_env_file=None, **kw)


def test_strong_key_passes():
    assert make().SECRET_KEY == STRONG


@pytest.mark.parametrize("key", [
    DEV_PLACEHOLDER,
    "generate-with--python-m-secrets-token-hex-32",
    "your-production-secret-key-minimum-32-chars",
])
def test_placeholder_key_rejected_with_hint(key):
    with pytest.raises(ValidationError) as e:
        make(SECRET_KEY=key)
    assert "SECRET_KEY" in str(e.value) and "openssl rand -hex 32" in str(e.value)


def test_short_key_rejected():
    with pytest.raises(ValidationError):
        make(SECRET_KEY="short")


def test_placeholder_db_password_rejected_on_compose_host():
    with pytest.raises(ValidationError) as e:
        make(DATABASE_URL=REMOTE.format(pw="aspiro_password"))
    assert "POSTGRES_PASSWORD" in str(e.value)


def test_placeholder_db_password_allowed_on_loopback():
    url = "postgresql+asyncpg://u:aspiro_password@localhost:5433/db"
    assert make(DATABASE_URL=url).database_host == "localhost"


def test_opt_out_allows_placeholders():
    s = make(SECRET_KEY=DEV_PLACEHOLDER,
             DATABASE_URL=REMOTE.format(pw="aspiro_password"),
             ALLOW_INSECURE_DEFAULTS=True)
    assert s.ALLOW_INSECURE_DEFAULTS


@pytest.mark.parametrize("env", ["development", "dev", "local", "production", "test"])
def test_environment_does_not_bypass(env):
    with pytest.raises(ValidationError):
        make(ENVIRONMENT=env, DEBUG=True, SECRET_KEY=DEV_PLACEHOLDER)


def test_upload_path_default_unchanged():
    assert make().UPLOAD_PATH == "./uploads/transactions"
