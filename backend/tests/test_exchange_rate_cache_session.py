"""Saving a rate to the DB cache never touches the caller's session.

`twd_rates_for` hands the exchange-rate service whatever session the caller is
using — get_summary's, the spending-alerts job's — and the cache write used to
`commit()` that session (or `rollback()` it when the insert failed). A rate
lookup in the middle of a job then committed the job's pending writes early, or
threw them away.
"""

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.utils.exchange_rate_service import ExchangeRateService


def _caller_session() -> MagicMock:
    session = MagicMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.flush = AsyncMock()
    return session


def _cache_session_factory(commit_side_effect=None):
    cache_session = MagicMock()
    cache_session.add = MagicMock()
    cache_session.commit = AsyncMock(side_effect=commit_side_effect)

    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=cache_session)
    context.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=context), cache_session


@pytest.mark.asyncio
async def test_a_saved_rate_commits_its_own_session_not_the_callers():
    caller = _caller_session()
    factory, cache_session = _cache_session_factory()

    with patch("app.core.database.async_session", factory):
        await ExchangeRateService(caller)._save_to_db_cache("USD", "TWD", Decimal("31.5"))

    cache_session.add.assert_called_once()
    cache_session.commit.assert_awaited_once()
    caller.commit.assert_not_awaited()
    caller.rollback.assert_not_awaited()
    caller.add.assert_not_called()


@pytest.mark.asyncio
async def test_a_failed_cache_write_does_not_roll_back_the_caller():
    caller = _caller_session()
    factory, _ = _cache_session_factory(commit_side_effect=RuntimeError("insert failed"))

    with patch("app.core.database.async_session", factory):
        # Swallowed: a missing cache row is not the caller's problem.
        await ExchangeRateService(caller)._save_to_db_cache("USD", "TWD", Decimal("31.5"))

    caller.rollback.assert_not_awaited()
    caller.commit.assert_not_awaited()
