"""
Dev-only DB sync endpoints — local ↔ Supabase ↔ LAN peer.

These TRUNCATE and replace entire databases and have no user authentication, so
they are mounted only when ``settings.dev_tools_active`` holds and every request
must carry the ``X-Dev-Tools-Token`` secret. Anything else 404s.

ENVIRONMENT alone is NOT sufficient to gate these: every deployment using the
project's compose file reports ``ENVIRONMENT=development``, including the
self-hosted Pi that serves real users over the internet behind Caddy. Before the
token requirement, `POST /dev/db-sync/pull` was an unauthenticated,
internet-reachable "replace this database" button.
"""

import logging
import ssl
from typing import AsyncGenerator

import asyncpg
from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse, StreamingResponse

from app.core.config import get_settings
from app.core.dev_tools import require_dev_tools_token

# Router-wide dependency: every route below requires the dev-tools secret.
router = APIRouter(dependencies=[Depends(require_dev_tools_token)])

logger = logging.getLogger(__name__)

_NOT_CONFIGURED = (
    "Database URL not configured — set SUPABASE_DB_URL / PEER_DB_URL in backend/.env"
)


def _error_line(context: str, exc: Exception) -> str:
    """The streamed failure line. The exception text (which can carry hostnames,
    DSN fragments and driver internals) goes to the backend log, not the response."""
    logger.warning("dev db-sync: %s", context, exc_info=exc)
    return f"✗ {context} ({type(exc).__name__}) — details in the backend log\n[exit 1]\n"


def _local_dsn() -> str:
    url = get_settings().DATABASE_URL
    return url.replace("postgresql+asyncpg://", "postgresql://").split("?")[0]


def _remote_dsn() -> str:
    url = get_settings().SUPABASE_DB_URL or ""
    if not url:
        raise ValueError(
            "SUPABASE_DB_URL is not set — add it to backend/.env"
        )
    return url.replace("postgresql+asyncpg://", "postgresql://").split("?")[0]


def _peer_dsn() -> str:
    """LAN peer DB (e.g. a Raspberry Pi self-host), from PEER_DB_URL."""
    url = get_settings().PEER_DB_URL or ""
    if not url:
        raise ValueError(
            "PEER_DB_URL is not set — add it to backend/.env "
            "(e.g. postgresql://aspiro_user:aspiro_password@<pi-ip>:5433/aspiro_db)"
        )
    return url.replace("postgresql+asyncpg://", "postgresql://").split("?")[0]


def _peer_label() -> str:
    return get_settings().PEER_DB_LABEL or "Peer"


def _ssl_for(dsn: str) -> ssl.SSLContext | None:
    if "supabase.co" not in dsn and "supabase.com" not in dsn:
        return None
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def _tables(conn: asyncpg.Connection) -> list[str]:
    rows = await conn.fetch(
        "SELECT tablename FROM pg_tables "
        "WHERE schemaname = 'public' "
        "AND tablename != 'alembic_version' "
        "ORDER BY tablename"
    )
    return [r["tablename"] for r in rows]


async def _status_gen_for(
    label_a: str, dsn_a: str, label_b: str, dsn_b: str
) -> AsyncGenerator[str, None]:
    yield f"Connecting to {label_a} and {label_b} databases...\n"
    try:
        a = await asyncpg.connect(dsn_a, ssl=_ssl_for(dsn_a))
    except Exception as exc:
        yield _error_line(f"Cannot connect to {label_a}", exc)
        return

    try:
        b = await asyncpg.connect(dsn_b, ssl=_ssl_for(dsn_b))
    except Exception as exc:
        await a.close()
        yield _error_line(f"Cannot connect to {label_b}", exc)
        return

    col_a, col_b = label_a[:8], label_b[:8]
    try:
        a_tables = set(await _tables(a))
        b_tables = set(await _tables(b))
        tables = sorted(a_tables | b_tables)
        yield f"\n{'Table':<32} {col_a:>8} {col_b:>8} {'Diff':>6}\n"
        yield f"{'─' * 58}\n"
        for table in tables:
            try:
                a_n = await a.fetchval(f'SELECT COUNT(*) FROM "{table}"')
            except Exception:
                a_n = "—"
            try:
                b_n = await b.fetchval(f'SELECT COUNT(*) FROM "{table}"')
            except Exception:
                b_n = "—"
            if isinstance(a_n, int) and isinstance(b_n, int):
                diff = a_n - b_n
                sign = "+" if diff > 0 else ""
                yield f"{table:<32} {a_n:>8} {b_n:>8} {sign}{diff:>5}\n"
            else:
                yield f"{table:<32} {str(a_n):>8} {str(b_n):>8} {'?':>6}\n"
        yield "\n[exit 0]\n"
    except Exception as exc:
        yield "\n" + _error_line("Status check failed", exc)
    finally:
        await a.close()
        await b.close()


async def _status_gen() -> AsyncGenerator[str, None]:
    try:
        local_dsn = _local_dsn()
        remote_dsn = _remote_dsn()
    except ValueError as exc:
        yield _error_line(_NOT_CONFIGURED, exc)
        return
    async for line in _status_gen_for("Local", local_dsn, "Remote", remote_dsn):
        yield line


async def _peer_status_gen() -> AsyncGenerator[str, None]:
    try:
        local_dsn = _local_dsn()
        peer_dsn = _peer_dsn()
    except ValueError as exc:
        yield _error_line(_NOT_CONFIGURED, exc)
        return
    async for line in _status_gen_for("Local", local_dsn, _peer_label(), peer_dsn):
        yield line


async def _sync_gen(source_dsn: str, target_dsn: str) -> AsyncGenerator[str, None]:
    yield "Connecting to source and target...\n"
    try:
        source = await asyncpg.connect(source_dsn, ssl=_ssl_for(source_dsn))
        yield "✓ Connected to source\n"
    except Exception as exc:
        yield _error_line("Cannot connect to source", exc)
        return

    try:
        target = await asyncpg.connect(target_dsn, ssl=_ssl_for(target_dsn))
        yield "✓ Connected to target\n"
    except Exception as exc:
        await source.close()
        yield _error_line("Cannot connect to target", exc)
        return

    try:
        source_tables = set(await _tables(source))
        target_tables = set(await _tables(target))
        tables = sorted(source_tables & target_tables)
        skipped = sorted(source_tables - target_tables)

        yield f"\nFound {len(tables)} tables in common\n"
        if skipped:
            yield f"⚠ Skipping {len(skipped)} table(s) not on target (run migrations first):\n"
            for t in skipped:
                yield f"  – {t}\n"

        # Read all data from source first
        yield "\n▶ Reading source data...\n"
        table_data: dict[str, list] = {}
        for table in tables:
            rows = await source.fetch(f'SELECT * FROM "{table}"')
            table_data[table] = rows
            yield f"  {table}: {len(rows)} rows\n"

        # Truncate + restore inside ONE transaction so a mid-restore failure
        # rolls back cleanly and never leaves the target half-wiped — the exact
        # failure mode that emptied prod when an INSERT hit a schema mismatch
        # after the TRUNCATE had already committed. `SET LOCAL` scopes the
        # FK-check bypass to this transaction; it auto-reverts on commit/rollback.
        yield "\n▶ Replacing target data (atomic — rolls back on any error)...\n"
        async with target.transaction():
            await target.execute("SET LOCAL session_replication_role = 'replica'")
            for table in reversed(tables):
                await target.execute(f'TRUNCATE TABLE "{table}" CASCADE')
            for table in tables:
                rows = table_data[table]
                if not rows:
                    continue
                columns = list(rows[0].keys())
                col_list = ", ".join(f'"{c}"' for c in columns)
                placeholders = ", ".join(f"${i + 1}" for i in range(len(columns)))
                stmt = f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders})'
                await target.executemany(stmt, [tuple(r[c] for c in columns) for r in rows])
                yield f"  {table}: {len(rows)} rows\n"
        yield "\n✓ Sync complete!\n[exit 0]\n"

    except Exception as exc:
        # The transaction above already rolled back — target left unchanged.
        yield "\n" + _error_line("Error (rolled back, target unchanged)", exc)

    finally:
        await source.close()
        await target.close()


@router.get("/status")
async def dev_db_sync_status():
    return StreamingResponse(_status_gen(), media_type="text/plain; charset=utf-8")


# Explicit, conscious opt-in required for the destructive direction.
_PUSH_CONFIRM_TOKEN = "WIPE_REMOTE_AND_REPLACE_WITH_LOCAL"


@router.post("/push")
async def dev_db_sync_push(confirm: str = ""):
    """local → REMOTE. Destructive: TRUNCATEs every table on SUPABASE_DB_URL and
    replaces it with local data. Gated behind an explicit confirm token so it
    can't be fired by accident against a DB with real users."""
    if confirm != _PUSH_CONFIRM_TOKEN:
        return PlainTextResponse(
            "REFUSED.\n\n"
            "/push TRUNCATEs every table on the REMOTE (SUPABASE_DB_URL) and "
            "replaces it with your LOCAL data. Against a database with real "
            "users this is unrecoverable without a backup.\n\n"
            "Only run this against a throwaway / empty target. If you are sure, "
            f"re-run with the query param:  ?confirm={_PUSH_CONFIRM_TOKEN}\n",
            status_code=400,
        )
    return StreamingResponse(
        _sync_gen(_local_dsn(), _remote_dsn()),
        media_type="text/plain; charset=utf-8",
    )


@router.post("/pull")
async def dev_db_sync_pull():
    return StreamingResponse(
        _sync_gen(_remote_dsn(), _local_dsn()),
        media_type="text/plain; charset=utf-8",
    )


# ── LAN peer (e.g. Raspberry Pi self-host) — PEER_DB_URL ──────────────────────

async def _peer_sync_gen(direction: str) -> AsyncGenerator[str, None]:
    """direction: 'push' = local → peer, 'pull' = peer → local."""
    try:
        local_dsn = _local_dsn()
        peer_dsn = _peer_dsn()
    except ValueError as exc:
        yield _error_line(_NOT_CONFIGURED, exc)
        return
    source, target = (local_dsn, peer_dsn) if direction == "push" else (peer_dsn, local_dsn)
    async for line in _sync_gen(source, target):
        yield line


@router.get("/status-pi")
async def dev_db_sync_status_pi():
    return StreamingResponse(_peer_status_gen(), media_type="text/plain; charset=utf-8")


@router.post("/push-pi")
async def dev_db_sync_push_pi():
    return StreamingResponse(_peer_sync_gen("push"), media_type="text/plain; charset=utf-8")


@router.post("/pull-pi")
async def dev_db_sync_pull_pi():
    return StreamingResponse(_peer_sync_gen("pull"), media_type="text/plain; charset=utf-8")
