"""The rule for turning a stored amount into the currency the app displays.

Both the dashboard's aggregates and the reports service go through this, which
is the point: before it, `get_summary` summed the raw column, the reports
service summed the raw column, and `/transactions/monthly-summary` multiplied by
a hardcoded table with USD pinned at 31.5. Three answers to one question.
"""

import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

from app.modules.transactions.models import Transaction
from app.utils.fx_sql import BASE_CURRENCY, in_twd, twd_rates_for


class TestInTwd:
    def test_a_single_currency_account_gets_the_column_back_untouched(self):
        # Not merely equivalent — the same object, so the query built around it
        # is byte-for-byte what it was before this existed.
        assert in_twd(Transaction.amount, Transaction.currency, {}) is Transaction.amount

    def test_each_currency_is_multiplied_by_its_own_rate(self):
        params = (
            in_twd(
                Transaction.amount,
                Transaction.currency,
                {"USD": Decimal("31.5"), "JPY": Decimal("0.21")},
            )
            .compile()
            .params.values()
        )

        assert Decimal("31.5") in params
        assert Decimal("0.21") in params

    def test_a_currency_with_no_rate_keeps_its_face_value(self):
        # ELSE 1, not ELSE 0: an unknown currency counting as nothing would
        # silently delete money from a total.
        params = in_twd(
            Transaction.amount, Transaction.currency, {"USD": Decimal("31.5")}
        ).compile().params.values()

        assert 1 in params

    def test_a_lower_case_currency_still_finds_its_rate(self):
        # Rates are keyed upper-case; a row stored as "usd" must be compared
        # upper-cased too, or it misses the WHEN and lands on ELSE 1.
        sql = str(
            in_twd(Transaction.amount, Transaction.currency, {"USD": Decimal("31.5")})
        ).lower()

        assert "upper(transactions.currency)" in sql


class TestTwdRatesFor:
    @pytest.mark.asyncio
    async def test_a_twd_only_account_asks_for_no_rates_at_all(self):
        service = MagicMock()
        service.get_exchange_rate = AsyncMock()

        with patch("app.utils.fx_sql.get_exchange_rate_service", return_value=service):
            rates = await twd_rates_for(MagicMock(), ["TWD", "twd", None])

        assert rates == {}
        service.get_exchange_rate.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_each_foreign_currency_is_asked_for_once(self):
        service = MagicMock()
        service.get_exchange_rate = AsyncMock(return_value=Decimal("31.5"))

        with patch("app.utils.fx_sql.get_exchange_rate_service", return_value=service):
            rates = await twd_rates_for(MagicMock(), ["USD", "USD", "usd", "TWD"])

        assert rates == {"USD": Decimal("31.5")}
        service.get_exchange_rate.assert_awaited_once_with("USD", BASE_CURRENCY)

    @pytest.mark.asyncio
    async def test_an_unresolvable_rate_is_omitted_rather_than_guessed(self):
        # Omitted means `in_twd` leaves those rows at face value — the old
        # behaviour. An FX outage degrades a total to what it used to be,
        # rather than to zero or to an error on the dashboard.
        service = MagicMock()
        service.get_exchange_rate = AsyncMock(return_value=None)

        with patch("app.utils.fx_sql.get_exchange_rate_service", return_value=service):
            rates = await twd_rates_for(MagicMock(), ["XAU"])

        assert rates == {}
