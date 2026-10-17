"""database_url_sync must name the psycopg2 driver explicitly.

SQLAlchemy 2.1 made a bare ``postgresql://`` mean psycopg 3, which is not installed,
so the old conversion (asyncpg -> bare postgresql) broke every Alembic run in the
production image. The image smoke test in CI (scripts/ci/smoke_images.sh) runs
`alembic upgrade head` for real; this pins the conversion itself.
"""

import pytest
from sqlalchemy.engine import make_url

from app.core.config import Settings

SECRET = "test-secret-key-0123456789abcdef0123456789"


@pytest.mark.unit
@pytest.mark.parametrize(
    "url",
    [
        "postgresql+asyncpg://u:p@db:5432/app",
        "postgresql://u:p@db:5432/app",
        "postgres://u:p@db:5432/app",
    ],
)
def test_sync_url_uses_psycopg2(url):
    sync = Settings(DATABASE_URL=url, SECRET_KEY=SECRET).database_url_sync
    assert sync == "postgresql+psycopg2://u:p@db:5432/app"
    assert make_url(sync).get_dialect().driver == "psycopg2"


@pytest.mark.unit
def test_sync_url_normalises_ssl_for_psycopg2():
    sync = Settings(
        DATABASE_URL="postgresql+asyncpg://u:p@db:6543/app?ssl=require", SECRET_KEY=SECRET
    ).database_url_sync
    assert sync == "postgresql+psycopg2://u:p@db:6543/app?sslmode=require"


@pytest.mark.unit
def test_sync_url_leaves_sqlite_alone():
    url = "sqlite+aiosqlite:///:memory:"
    assert Settings(DATABASE_URL=url, SECRET_KEY=SECRET).database_url_sync == url
