"""
Only one process may run the background scheduler.

uvicorn --workers N forks N full application processes, and each one ran the
lifespan startup — so `ENABLE_SCHEDULER=true` with `--workers 2` started two
APSchedulers and fired all seven cron jobs twice. Verified by booting the real
app with `--workers 2`: two "Background scheduler started" lines, two worker
PIDs. On the Pi (which is production and does not set ENABLE_SCHEDULER, so it
defaults on) that means the FinLab price refresh runs twice per trigger against
a 500MB/day quota, and the nightly snapshot job double-writes.

Leader election uses a Postgres session-level advisory lock: whichever worker
takes it owns the scheduler, and the lock dies with the connection, so a
crashed leader releases automatically and the next boot re-elects.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core import scheduler as scheduler_module
from app.core.scheduler import (
    SCHEDULER_ADVISORY_LOCK_KEY,
    release_scheduler_lock,
    try_acquire_scheduler_lock,
)


class _FakeConn:
    """Mimics AsyncConnection: engine.connect() is awaited to get the connection."""

    def __init__(self, acquired, calls):
        self._acquired = acquired
        self._calls = calls
        self.statements = []

    def __await__(self):
        async def _self():
            return self

        return _self().__await__()

    async def execute(self, stmt, params=None):
        self.statements.append((str(stmt), params))
        result = MagicMock()
        result.scalar.return_value = self._acquired
        return result

    async def close(self):
        self._calls["closed"] += 1


def _fake_engine(results):
    """Engine whose connect() hands out connections returning `results` in turn."""
    calls = {"connects": 0, "closed": 0, "conns": []}

    def _connect():
        conn = _FakeConn(results[calls["connects"]], calls)
        calls["connects"] += 1
        calls["conns"].append(conn)
        return conn

    engine = MagicMock()
    engine.connect = MagicMock(side_effect=_connect)
    return engine, calls


@pytest.mark.unit
class TestSchedulerLeaderElection:
    @pytest.mark.asyncio
    async def test_first_worker_wins_the_lock(self):
        engine, calls = _fake_engine([True])
        with patch.object(scheduler_module, "engine", engine):
            conn = await try_acquire_scheduler_lock()
        assert conn is not None, "the first worker must become the scheduler leader"
        assert calls["closed"] == 0, "the winner must hold its connection open"

    @pytest.mark.asyncio
    async def test_second_worker_loses_and_releases_its_connection(self):
        engine, calls = _fake_engine([False])
        with patch.object(scheduler_module, "engine", engine):
            conn = await try_acquire_scheduler_lock()
        assert conn is None, "a worker that loses the race must not run the scheduler"
        assert calls["closed"] == 1, "the loser must not leak a pooled connection"

    @pytest.mark.asyncio
    async def test_exactly_one_of_four_workers_wins(self):
        """The shape that matters: --workers 4 must yield one scheduler."""
        engine, _ = _fake_engine([True, False, False, False])
        winners = 0
        with patch.object(scheduler_module, "engine", engine):
            for _ in range(4):
                if await try_acquire_scheduler_lock() is not None:
                    winners += 1
        assert winners == 1

    @pytest.mark.asyncio
    async def test_lock_uses_a_stable_bigint_key(self):
        """A drifting key would let two processes both think they are leader."""
        engine, calls = _fake_engine([True])
        with patch.object(scheduler_module, "engine", engine):
            await try_acquire_scheduler_lock()

        stmt, params = calls["conns"][0].statements[0]
        assert "pg_try_advisory_lock" in stmt
        assert params == {"key": SCHEDULER_ADVISORY_LOCK_KEY}
        # Postgres advisory locks are bigint-keyed.
        assert isinstance(SCHEDULER_ADVISORY_LOCK_KEY, int)
        assert -(2**63) <= SCHEDULER_ADVISORY_LOCK_KEY < 2**63

    @pytest.mark.asyncio
    async def test_a_database_failure_does_not_block_startup(self):
        """No database must mean 'no scheduler', never 'no app'."""
        engine = MagicMock()
        engine.connect = MagicMock(side_effect=OSError("db is down"))
        with patch.object(scheduler_module, "engine", engine):
            assert await try_acquire_scheduler_lock() is None

    @pytest.mark.asyncio
    async def test_release_is_safe_when_nothing_was_acquired(self):
        await release_scheduler_lock(None)  # must not raise

    @pytest.mark.asyncio
    async def test_release_unlocks_and_closes(self):
        conn = AsyncMock()
        closed = {"n": 0}

        async def _close():
            closed["n"] += 1

        conn.close = _close
        await release_scheduler_lock(conn)
        conn.execute.assert_awaited()
        assert closed["n"] == 1

    @pytest.mark.asyncio
    async def test_release_still_closes_when_unlock_errors(self):
        """A dead connection must not leak on shutdown."""
        conn = AsyncMock()
        conn.execute = AsyncMock(side_effect=OSError("connection reset"))
        closed = {"n": 0}

        async def _close():
            closed["n"] += 1

        conn.close = _close
        await release_scheduler_lock(conn)
        assert closed["n"] == 1
