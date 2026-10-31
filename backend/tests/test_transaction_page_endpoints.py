"""Transactions endpoints the app calls, through HTTP with a signed-in user:
/stats (with its filters), /analytics/summary, /categories and /scan-receipt.

The service-level tests cover the aggregates; these cover the request
parsing and the authenticated branches in front of them. FX is stubbed.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.transactions.attachment_service import AttachmentService
from app.modules.transactions.services import TransactionService
from app.modules.transactions.models import (
    CategoryType,
    Transaction,
    TransactionCategory,
    TransactionStatus,
    TransactionType,
    TransactionWalletType,
)
from app.utils.exchange_rate_service import ExchangeRateService
from app.utils.datetime_helpers import business_today

pytestmark = [pytest.mark.asyncio, pytest.mark.api]
BASE = "/api/v1/transactions"


@pytest.fixture(autouse=True)
def _fixed_fx(monkeypatch):
    async def rate(self, from_currency, to_currency):
        return {"USD": Decimal("30")}.get(from_currency, Decimal("1"))

    monkeypatch.setattr(ExchangeRateService, "get_exchange_rate", rate)


def _cat(name, kind=CategoryType.EXPENSE):
    return TransactionCategory(id=uuid.uuid4(), name=name, type=kind, is_active=True)


@pytest_asyncio.fixture
async def ledger(async_session, test_user):
    """Salary 50,000; Dining 300 + US$10 (= 300); 1,000 Life→Emergency transfer.

    Two active categories are both named "Dining", as in prod, and each has
    one expense on it. (Filtering /stats by that name is not exercised here:
    resolved ids come back as strings, which asyncpg binds to a UUID column
    and SQLite cannot.)
    """
    when = datetime.combine(business_today() - timedelta(days=2), datetime.min.time(), tzinfo=timezone.utc)
    salary, dining, dining_dup, transfer = (
        _cat("Salary", CategoryType.INCOME), _cat("Dining"), _cat("Dining"), _cat("Transfer"),
    )
    async_session.add_all([salary, dining, dining_dup, transfer])
    await async_session.flush()
    group = uuid.uuid4()

    def txn(amount, cat, kind, currency="TWD", wallet=TransactionWalletType.LIFE, grp=None, desc="x"):
        return Transaction(
            id=uuid.uuid4(), user_id=test_user.id, category_id=cat.id, type=kind,
            status=TransactionStatus.COMPLETED, amount=Decimal(str(amount)), currency=currency,
            description=desc, transaction_date=when, wallet_type=wallet,
            transfer_group_id=grp, is_deleted=False,
        )

    async_session.add_all(
        [
            txn(50000, salary, TransactionType.INCOME, desc="salary"),
            txn(300, dining, TransactionType.EXPENSE, desc="ramen"),
            txn(10, dining_dup, TransactionType.EXPENSE, currency="USD", desc="burger"),
            txn(1000, transfer, TransactionType.EXPENSE, grp=group, desc="top-up"),
            txn(1000, transfer, TransactionType.INCOME, wallet=TransactionWalletType.EMERGENCY, grp=group, desc="top-up"),
        ]
    )
    await async_session.commit()
    return {"dining": dining}


def stats(client, **params):
    r = client.get(f"{BASE}/stats", params=params)
    assert r.status_code == 200, r.text
    return r.json()


class TestStats:
    async def test_totals_are_in_twd_and_include_transfer_legs_by_default(self, authenticated_client, ledger):
        body = stats(authenticated_client)
        assert body["currency"] == "TWD"
        assert body["stats"]["total_income"] == pytest.approx(51000)
        assert body["stats"]["total_expenses"] == pytest.approx(1600)
        assert body["stats"]["transaction_count"] == 5

    async def test_exclude_transfers_drops_both_legs(self, authenticated_client, ledger):
        s = stats(authenticated_client, exclude_transfers=True)["stats"]
        assert s["total_income"] == pytest.approx(50000)
        assert s["total_expenses"] == pytest.approx(600)
        assert s["net_income"] == pytest.approx(49400)

    async def test_unknown_category_name_does_not_filter(self, authenticated_client, ledger):
        assert stats(authenticated_client, category="Nope")["stats"]["transaction_count"] == 5

    async def test_type_wallet_and_search_filters(self, authenticated_client, ledger):
        assert stats(authenticated_client, type="income")["stats"]["transaction_count"] == 2
        assert stats(authenticated_client, wallet_type="emergency")["stats"]["transaction_count"] == 1
        assert stats(authenticated_client, search="ramen")["stats"]["transaction_count"] == 1

    async def test_type_transfer_matches_both_legs(self, authenticated_client, ledger):
        # The legs are stored as income + expense, never type 'transfer'.
        s = stats(authenticated_client, type="transfer")["stats"]
        assert s["transaction_count"] == 2
        assert s["total_income"] == pytest.approx(1000)
        assert s["total_expenses"] == pytest.approx(1000)
        r = authenticated_client.get(f"{BASE}/", params={"type": "transfer"})
        assert r.status_code == 200, r.text
        rows = r.json()["transactions"]
        assert sorted((t["type"], t["description"]) for t in rows) == [
            ("expense", "top-up"), ("income", "top-up"),
        ]

    async def test_type_transfer_with_exclude_transfers_counts_nothing(self, authenticated_client, ledger):
        # Asking for only transfers and also leaving them out is empty, by design.
        assert stats(authenticated_client, type="transfer", exclude_transfers=True)["stats"]["transaction_count"] == 0

    async def test_top_expenses_rank_by_twd_value(self, authenticated_client, ledger):
        top = stats(authenticated_client, exclude_transfers=True)["top_expenses"]
        # US$10 at 30 ties NT$300; both are listed, nothing else is.
        assert {t["description"] for t in top} == {"ramen", "burger"}

    async def test_date_window_excludes_older_rows(self, authenticated_client, ledger):
        today = business_today()
        body = stats(authenticated_client, date_from=str(today - timedelta(days=1)), date_to=str(today))
        assert body["stats"]["transaction_count"] == 0

    async def test_signed_out_gets_demo_shape(self, client):
        body = stats(client)
        assert set(body["stats"]) >= {"total_income", "total_expenses", "transaction_count"}
        assert body["top_expenses"] == []


class TestAnalyticsSummary:
    # get_analytics itself runs date_trunc, which SQLite lacks, so the service
    # is stubbed: what the router owns is turning a period into a date window.
    @pytest.mark.parametrize("period,days", [("30d", 30), ("90d", 90), ("1y", 365)])
    async def test_period_becomes_a_window_ending_today(self, authenticated_client, monkeypatch, period, days):
        seen = {}

        async def fake(self, user_id, date_from, date_to):
            seen.update(date_from=date_from, date_to=date_to)
            raise RuntimeError("stop here")

        monkeypatch.setattr(TransactionService, "get_analytics", fake)
        r = authenticated_client.get(f"{BASE}/analytics/summary", params={"period": period})

        assert r.status_code == 500
        today = business_today()
        assert seen == {"date_from": today - timedelta(days=days), "date_to": today}

    async def test_explicit_dates_override_the_period(self, authenticated_client, monkeypatch):
        seen = {}

        async def fake(self, user_id, date_from, date_to):
            seen.update(date_from=str(date_from), date_to=str(date_to))
            raise RuntimeError("stop here")

        monkeypatch.setattr(TransactionService, "get_analytics", fake)
        authenticated_client.get(
            f"{BASE}/analytics/summary",
            params={"period": "1y", "date_from": "2026-01-01", "date_to": "2026-01-31"},
        )
        assert seen == {"date_from": "2026-01-01", "date_to": "2026-01-31"}

    async def test_bad_period_is_rejected(self, authenticated_client):
        assert authenticated_client.get(f"{BASE}/analytics/summary", params={"period": "7d"}).status_code == 422

    async def test_signed_out_gets_demo_summary(self, client):
        body = client.get(f"{BASE}/analytics/summary").json()
        assert body["net_income"] == pytest.approx(body["total_income"] - body["total_expenses"])


class TestCategories:
    async def test_list_filters_by_type(self, authenticated_client, ledger):
        names = {c["name"] for c in authenticated_client.get(f"{BASE}/categories", params={"type": "income"}).json()}
        assert "Salary" in names
        assert "Dining" not in names

    async def test_signed_out_list_comes_from_demo(self, client):
        cats = client.get(f"{BASE}/categories", params={"type": "expense"}).json()
        assert cats
        assert {c["type"] for c in cats} == {"expense"}

    async def test_popular_ranks_by_use(self, authenticated_client, ledger):
        cats = authenticated_client.get(f"{BASE}/categories/popular", params={"type": "expense"}).json()
        # Transfer has two rows; the Dining categories one each.
        assert cats[0]["name"] == "Transfer"
        assert {c["name"] for c in cats} == {"Transfer", "Dining"}

    async def test_get_one_and_missing(self, authenticated_client, ledger):
        cat_id = str(ledger["dining"].id)
        assert authenticated_client.get(f"{BASE}/categories/{cat_id}").json()["name"] == "Dining"
        assert authenticated_client.get(f"{BASE}/categories/{uuid.uuid4()}").status_code == 404

    async def test_writes_are_admin_only(self, authenticated_client, ledger):
        cat_id = str(ledger["dining"].id)
        assert authenticated_client.post(f"{BASE}/categories", json={"name": "X", "type": "expense"}).status_code == 403
        assert authenticated_client.put(f"{BASE}/categories/{cat_id}", json={"name": "Y"}).status_code == 403
        assert authenticated_client.delete(f"{BASE}/categories/{cat_id}").status_code == 403


class TestScanReceipt:
    def _post(self, client, name="r.jpg"):
        return client.post(f"{BASE}/scan-receipt", files={"file": (name, b"\xff\xd8fake", "image/jpeg")})

    async def test_rejects_unsupported_file_types(self, authenticated_client):
        assert self._post(authenticated_client, "r.gif").status_code == 400

    async def test_returns_extracted_fields(self, authenticated_client, monkeypatch):
        async def scan(self, file, user_id):
            return {"amount": 120.0, "merchant_name": "7-11", "confidence": 0.8, "extra": "dropped"}

        monkeypatch.setattr(AttachmentService, "scan_receipt", scan)
        body = self._post(authenticated_client).json()
        assert body == {
            "amount": 120.0, "merchant_name": "7-11", "date": None,
            "description": None, "category": None, "confidence": 0.8,
        }

    @pytest.mark.parametrize(
        "error,status",
        [(TimeoutError(), 504), (NotImplementedError(), 501), (RuntimeError("ocr"), 500)],
    )
    async def test_maps_scanner_failures(self, authenticated_client, monkeypatch, error, status):
        async def scan(self, file, user_id):
            raise error

        monkeypatch.setattr(AttachmentService, "scan_receipt", scan)
        assert self._post(authenticated_client).status_code == status
