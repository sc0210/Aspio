"""
The rates endpoint must not invent a rate it could not fetch.

It used to write `rates[currency] = 1.0` when a pair failed to resolve. That is
not a fallback — it is the claim that one US dollar is one New Taiwan dollar,
returned in the same shape as a real rate and indistinguishable from one. A
caller converting a USD position with it understates the holding roughly
31-fold, and nothing in the payload says anything is wrong.
"""

import pytest


class TestExchangeRatesEndpoint:
    def test_unresolvable_rates_are_omitted_not_reported_as_parity(
        self, client, monkeypatch
    ):
        """A pair that cannot be priced is named in `unavailable`, not faked."""
        # The handler does `from app.utils.exchange_rate_service import
        # get_exchange_rate_service` inside the function, so it must be patched
        # where it is defined, not on the router module.
        from app.utils import exchange_rate_service as ers

        class NoRates:
            async def get_exchange_rate(self, frm, to, force_refresh=False):
                # USD resolves; everything else fails to price.
                return None

        monkeypatch.setattr(ers, "get_exchange_rate_service", lambda session: NoRates())

        body = client.get("/api/v1/portfolio/exchange-rates?base_currency=TWD").json()
        assert body["success"] is True
        data = body["data"]

        # The base is legitimately 1.0; nothing else may claim parity.
        assert data["rates"].get("TWD") == 1.0
        for code, rate in data["rates"].items():
            if code != "TWD":
                assert rate != 1.0, f"{code} reported parity with TWD"

        # And the failures are named rather than silently missing.
        assert set(data["unavailable"]) >= {"USD", "EUR", "JPY"}

    def test_resolved_rates_are_returned_and_not_listed_unavailable(
        self, client, monkeypatch
    ):
        from decimal import Decimal
        from app.utils import exchange_rate_service as ers

        class FixedRates:
            async def get_exchange_rate(self, frm, to, force_refresh=False):
                return Decimal("31.5") if frm == "USD" else None

        monkeypatch.setattr(ers, "get_exchange_rate_service", lambda session: FixedRates())

        data = client.get(
            "/api/v1/portfolio/exchange-rates?base_currency=TWD"
        ).json()["data"]

        assert data["rates"]["USD"] == pytest.approx(31.5)
        assert "USD" not in data["unavailable"]
