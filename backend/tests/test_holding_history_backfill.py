"""The background history fetch queued when a holding is added actually runs.

It imported its session factory from `...core.database`, which from
app/modules/portfolio/routers resolves to app.modules.core — a module that
does not exist — so every run died with ImportError before fetching anything.
"""

from contextlib import asynccontextmanager
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.portfolio.routers._shared import fetch_historical_data_background
from app.utils.datetime_helpers import business_today

pytestmark = pytest.mark.asyncio


def fake_session_factory(session):
    @asynccontextmanager
    async def factory():
        yield session
    return factory


async def test_fetches_the_requested_window_in_its_own_session():
    session = MagicMock(rollback=AsyncMock(), close=AsyncMock())
    service = MagicMock(fetch_and_store_historical_data=AsyncMock())
    with patch("app.core.database.async_session", fake_session_factory(session)), \
         patch("app.modules.portfolio.historical_price_service.get_historical_price_service",
               return_value=service) as get_service:
        await fetch_historical_data_background("0050", "TW", days=30)

    get_service.assert_called_once_with(session)
    service.fetch_and_store_historical_data.assert_awaited_once_with(
        symbol="0050", market="TW", start_date=business_today() - timedelta(days=30),
        end_date=business_today(), force_refresh=False)
    session.close.assert_awaited_once()
    session.rollback.assert_not_awaited()


async def test_a_failed_fetch_rolls_back_and_does_not_raise():
    session = MagicMock(rollback=AsyncMock(), close=AsyncMock())
    service = MagicMock(fetch_and_store_historical_data=AsyncMock(side_effect=RuntimeError("provider down")))
    with patch("app.core.database.async_session", fake_session_factory(session)), \
         patch("app.modules.portfolio.historical_price_service.get_historical_price_service",
               return_value=service):
        await fetch_historical_data_background("0050", "TW")

    session.rollback.assert_awaited_once()
    session.close.assert_awaited_once()
