"""A portfolio's currency is TWD unless someone chose otherwise.

The default was "USD", while every page shows TWD, so anything converting into
portfolio.currency was quietly in dollars: the dashboard P&L calendar read
"+519" for a ~NT$16k day on every account but the owner's.
"""

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.modules.portfolio.models import Portfolio
from app.modules.portfolio.schemas import HoldingCreate, PortfolioCreate
from app.modules.portfolio.services import PortfolioService


@pytest.mark.unit
def test_a_portfolio_is_always_twd():
    assert PortfolioCreate(name="P").currency == "TWD"
    # Not a choice: stored totals are read as TWD everywhere.
    assert PortfolioCreate(name="P", currency="usd").currency == "TWD"


@pytest.mark.asyncio
async def test_the_first_holding_creates_a_twd_portfolio(async_session, test_user):
    await PortfolioService(async_session).add_holding(
        test_user.id,
        HoldingCreate(
            symbol="VT", name="VT", type="etf", quantity=Decimal("1"), average_cost=Decimal("150"),
            currency="USD", exchange="NYSE", market="US",
        ),
    )
    portfolio = (
        await async_session.execute(select(Portfolio).where(Portfolio.user_id == test_user.id))
    ).scalar_one()
    assert portfolio.currency == "TWD"
