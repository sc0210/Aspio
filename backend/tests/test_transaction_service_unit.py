"""
Unit tests for TransactionService, CategorizationService, and RecurringTransactionService.
All external dependencies (repositories, cache) are mocked.
"""

import pytest
from datetime import date, timedelta, datetime, timezone
from decimal import Decimal
from unittest.mock import ANY, AsyncMock, MagicMock, patch
from uuid import uuid4

from app.modules.transactions.services import (
    TransactionService,
    CategorizationService,
    RecurringTransactionService,
)
from app.modules.transactions.models import (
    TransactionType,
    PaymentMethod,
    TransactionStatus,
    RecurringFrequency,
)
from app.modules.transactions.schemas import (
    TransactionCreate,
    TransactionUpdate,
    TransactionFilter,
    BulkTransactionCreate,
    RecurringTransactionUpdate,
)
from app.core.exceptions import ValidationException
from app.utils.datetime_helpers import business_today


# ─── Helpers ────────────────────────────────────────────────────────────────

def make_mock_transaction(
    tx_id=None,
    user_id=None,
    description="Test purchase",
    amount=Decimal("100.00"),
    tx_date=None,
    category_id=None,
):
    t = MagicMock()
    t.id = str(tx_id or uuid4())
    t.user_id = user_id or str(uuid4())
    t.description = description
    t.amount = amount
    t.transaction_date = tx_date or business_today()
    t.category_id = str(category_id or uuid4())
    t.auto_categorized = False
    # Fields required by TransactionResponse Pydantic validation
    t.type = TransactionType.EXPENSE
    t.wallet_type = "life"
    t.currency = "USD"
    t.status = TransactionStatus.COMPLETED
    t.reviewed_by_user = False
    t.category_name = None
    t.subcategory = None
    t.payment_method = None
    t.payment_account = None
    t.merchant_name = None
    t.location = None
    t.latitude = None
    t.longitude = None
    t.reference_id = None
    t.tags = None
    t.notes = None
    t.tax_deductible = False
    t.business_expense = False
    t.amount_usd = None
    t.exchange_rate = None
    t.processed_at = None
    t.categorization_confidence = None
    t.import_source = None
    t.import_batch_id = None
    t.qr_payment_data = None
    t.receipt_url = None
    t.receipt_data = None
    t.category_obj = None
    t.recurring_transaction_id = None
    t.created_at = datetime.now(timezone.utc)
    t.updated_at = datetime.now(timezone.utc)
    return t


class _Savepoint:
    """Stands in for AsyncSession.begin_nested(): lets the body's error through."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


def make_mock_category(name="Food & Dining", cat_type=TransactionType.EXPENSE):
    c = MagicMock()
    c.id = uuid4()
    c.name = name
    c.type = cat_type
    c.keywords = [name.lower().split()[0]]
    return c


def make_service(
    transaction_repo=None,
    category_repo=None,
    recurring_repo=None,
):
    """Build a TransactionService with all deps mocked."""
    t_repo = transaction_repo or MagicMock()
    c_repo = category_repo or MagicMock()
    r_repo = recurring_repo or MagicMock()
    # create/update/delete_transaction commit once on the transaction repo's session
    # (and roll back on error), so that session must be awaitable like AsyncSession.
    for method in ("commit", "rollback", "flush"):
        if not isinstance(getattr(t_repo.db, method), AsyncMock):
            setattr(t_repo.db, method, AsyncMock())
    return TransactionService(
        transaction_repo=t_repo,
        category_repo=c_repo,
        recurring_repo=r_repo,
    )


# ─── TransactionService._ensure_category_id ─────────────────────────────────

class TestEnsureCategoryId:
    """Tests for TransactionService._ensure_category_id"""

    @pytest.mark.asyncio
    async def test_valid_category_id_returns_it(self):
        cat_id = str(uuid4())
        mock_cat = make_mock_category()
        c_repo = MagicMock()
        c_repo.get_by_id = AsyncMock(return_value=mock_cat)

        svc = make_service(category_repo=c_repo)
        result = await svc._ensure_category_id({"category_id": cat_id, "type": "expense"})
        assert result == cat_id

    @pytest.mark.asyncio
    async def test_invalid_category_id_falls_back_to_name(self):
        cat_id = str(uuid4())
        mock_cat = make_mock_category("Groceries")
        c_repo = MagicMock()
        c_repo.get_by_id = AsyncMock(return_value=None)  # invalid id
        c_repo.get_by_name = AsyncMock(return_value=mock_cat)

        svc = make_service(category_repo=c_repo)
        result = await svc._ensure_category_id({
            "category_id": cat_id,
            "category_name": "Groceries",
            "type": "expense",
        })
        assert result == str(mock_cat.id)

    @pytest.mark.asyncio
    async def test_category_name_found_returns_id(self):
        mock_cat = make_mock_category("Transportation")
        c_repo = MagicMock()
        c_repo.get_by_name = AsyncMock(return_value=mock_cat)

        svc = make_service(category_repo=c_repo)
        result = await svc._ensure_category_id({
            "category_name": "Transportation",
            "type": "expense",
        })
        assert result == str(mock_cat.id)

    @pytest.mark.asyncio
    async def test_unknown_category_name_falls_back_without_creating(self):
        # Categories are global; an ordinary request must not add one.
        others = make_mock_category("Others")
        c_repo = MagicMock()
        c_repo.get_by_name = AsyncMock(side_effect=lambda name, t: others if name == "Others" else None)
        c_repo.create = AsyncMock()

        svc = make_service(category_repo=c_repo)
        result = await svc._ensure_category_id({
            "category_name": "Custom Category",
            "type": "expense",
        })
        assert result == str(others.id)
        c_repo.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_fresh_install_creates_only_the_fixed_fallback(self):
        # No "Others" yet: create that one fixed name, never the requested one.
        others = make_mock_category("Others")
        c_repo = MagicMock()
        c_repo.get_by_name = AsyncMock(return_value=None)
        c_repo.create_flush = AsyncMock(return_value=others)
        c_repo.db.begin_nested = MagicMock(return_value=_Savepoint())

        svc = make_service(category_repo=c_repo)
        result = await svc._ensure_category_id({"category_name": "Custom Category", "type": "expense"})
        assert result == str(others.id)
        c_repo.create_flush.assert_awaited_once()
        assert c_repo.create_flush.await_args.args[0]["name"] == "Others"

    @pytest.mark.asyncio
    async def test_unknown_income_name_uses_the_income_catch_all(self):
        other_income = make_mock_category("Other Income")
        c_repo = MagicMock()
        c_repo.get_by_name = AsyncMock(
            side_effect=lambda name, t: other_income if name == "Other Income" else None
        )
        c_repo.create = AsyncMock()

        svc = make_service(category_repo=c_repo)
        result = await svc._ensure_category_id(
            {"category_name": "Side Gig", "type": TransactionType.INCOME}
        )
        assert result == str(other_income.id)
        c_repo.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_concurrent_first_use_reads_the_winner(self):
        from sqlalchemy.exc import IntegrityError

        others = make_mock_category("Others")
        c_repo = MagicMock()
        c_repo.get_by_name = AsyncMock(side_effect=[None, None, others])
        c_repo.create_flush = AsyncMock(side_effect=IntegrityError("insert", {}, Exception("dup")))
        c_repo.db.begin_nested = MagicMock(return_value=_Savepoint())
        c_repo.db.rollback = AsyncMock()

        svc = make_service(category_repo=c_repo)
        result = await svc._ensure_category_id({"category_name": "Custom", "type": "expense"})
        assert result == str(others.id)
        # Only the savepoint is undone; the request's session is left alone.
        c_repo.db.rollback.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_no_category_info_returns_none(self):
        svc = make_service()
        result = await svc._ensure_category_id({"type": "expense", "description": "test"})
        assert result is None


# ─── TransactionService.create_transaction ───────────────────────────────────

class TestCreateTransaction:
    """Tests for TransactionService.create_transaction"""

    def _make_create_data(self, cat_name=None, cat_id=None):
        return TransactionCreate(
            type=TransactionType.EXPENSE,
            amount=Decimal("50.00"),
            currency="USD",
            description="Coffee shop",
            transaction_date=business_today(),
            category_name=cat_name,
            category_id=cat_id,
        )

    @pytest.mark.asyncio
    async def test_create_with_category_name_success(self):
        mock_cat = make_mock_category("Food & Dining")
        mock_tx = make_mock_transaction(description="Coffee shop")

        c_repo = MagicMock()
        c_repo.get_by_name = AsyncMock(return_value=mock_cat)
        c_repo.increment_usage = AsyncMock()

        t_repo = MagicMock()
        t_repo.create = AsyncMock(return_value=mock_tx)

        svc = make_service(transaction_repo=t_repo, category_repo=c_repo)

        result = await svc.create_transaction(
            self._make_create_data(cat_name="Food & Dining"), user_id="user-123"
        )

        assert result["transaction"] == mock_tx
        assert result["auto_categorized"] is False
        t_repo.create.assert_awaited_once()
        c_repo.increment_usage.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_create_without_category_raises_validation_error(self):
        c_repo = MagicMock()
        c_repo.get_by_name = AsyncMock(return_value=None)
        c_repo.create = AsyncMock(return_value=None)
        c_repo.get_all = AsyncMock(return_value=[])

        t_repo = MagicMock()
        svc = make_service(transaction_repo=t_repo, category_repo=c_repo)

        with pytest.raises(ValidationException):
            await svc.create_transaction(
                self._make_create_data(),  # no category info at all
                user_id="user-123",
            )

    @pytest.mark.asyncio
    async def test_create_auto_categorizes_when_no_category(self):
        mock_cat = make_mock_category("Food & Dining")
        mock_tx = make_mock_transaction()

        # Setup category_repo to return None for category_id/name lookups
        c_repo = MagicMock()
        c_repo.get_by_id = AsyncMock(return_value=None)
        c_repo.get_by_name = AsyncMock(return_value=None)
        c_repo.create = AsyncMock(return_value=None)  # can't create either
        c_repo.get_all = AsyncMock(return_value=[mock_cat])
        c_repo.increment_usage = AsyncMock()

        t_repo = MagicMock()
        t_repo.create = AsyncMock(return_value=mock_tx)
        t_repo.search_similar_transactions = AsyncMock(return_value=[])

        # Mock the auto_categorize to return a high-confidence suggestion
        mock_suggestion = MagicMock()
        mock_suggestion.category_id = str(mock_cat.id)
        mock_suggestion.confidence = Decimal("0.9")

        mock_response = MagicMock()
        mock_response.primary_suggestion = mock_suggestion

        svc = make_service(transaction_repo=t_repo, category_repo=c_repo)
        svc.categorization_service.auto_categorize = AsyncMock(return_value=mock_response)

        result = await svc.create_transaction(
            TransactionCreate(
                type=TransactionType.EXPENSE,
                amount=Decimal("15.00"),
                currency="USD",
                description="Starbucks coffee",
                transaction_date=business_today(),
            ),
            user_id="user-123",
        )

        assert result["auto_categorized"] is True


# ─── TransactionService.get_transaction / get_transactions ───────────────────

class TestGetTransactions:

    @pytest.mark.asyncio
    async def test_get_transaction_by_id(self):
        mock_tx = make_mock_transaction()
        t_repo = MagicMock()
        t_repo.get_by_id = AsyncMock(return_value=mock_tx)

        svc = make_service(transaction_repo=t_repo)
        result = await svc.get_transaction("tx-id", "user-id")

        assert result == mock_tx
        t_repo.get_by_id.assert_awaited_once_with("tx-id", "user-id")

    @pytest.mark.asyncio
    async def test_get_transaction_not_found(self):
        t_repo = MagicMock()
        t_repo.get_by_id = AsyncMock(return_value=None)

        svc = make_service(transaction_repo=t_repo)
        result = await svc.get_transaction("nonexistent", "user-id")

        assert result is None

    @pytest.mark.asyncio
    async def test_get_transactions_returns_paginated(self):
        txs = [make_mock_transaction() for _ in range(5)]
        t_repo = MagicMock()
        t_repo.get_all = AsyncMock(return_value=(txs, 5))

        svc = make_service(transaction_repo=t_repo)
        result = await svc.get_transactions("user-id", page=1, limit=10)

        assert result["transactions"] == txs
        assert result["total"] == 5
        assert result["page"] == 1
        assert result["limit"] == 10
        assert result["total_pages"] == 1
        assert result["has_next"] is False
        assert result["has_previous"] is False

    @pytest.mark.asyncio
    async def test_get_transactions_pagination_metadata(self):
        txs = [make_mock_transaction() for _ in range(10)]
        t_repo = MagicMock()
        t_repo.get_all = AsyncMock(return_value=(txs, 25))

        svc = make_service(transaction_repo=t_repo)
        result = await svc.get_transactions("user-id", page=2, limit=10)

        assert result["total_pages"] == 3
        assert result["has_next"] is True
        assert result["has_previous"] is True

    @pytest.mark.asyncio
    async def test_get_transactions_last_page(self):
        txs = [make_mock_transaction() for _ in range(5)]
        t_repo = MagicMock()
        t_repo.get_all = AsyncMock(return_value=(txs, 25))

        svc = make_service(transaction_repo=t_repo)
        result = await svc.get_transactions("user-id", page=3, limit=10)

        assert result["has_next"] is False
        assert result["has_previous"] is True


# ─── TransactionService.update_transaction ───────────────────────────────────

class TestUpdateTransaction:

    @pytest.mark.asyncio
    async def test_update_transaction_success(self):
        mock_tx = make_mock_transaction()
        t_repo = MagicMock()
        t_repo.update = AsyncMock(return_value=mock_tx)

        c_repo = MagicMock()
        c_repo.increment_usage = AsyncMock()

        svc = make_service(transaction_repo=t_repo, category_repo=c_repo)

        update_data = TransactionUpdate(description="Updated description")
        result = await svc.update_transaction("tx-id", "user-id", update_data)

        assert result == mock_tx
        t_repo.update.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_update_transaction_with_category_name(self):
        mock_cat = make_mock_category("Shopping")
        mock_tx = make_mock_transaction(category_id=mock_cat.id)

        c_repo = MagicMock()
        c_repo.get_by_name = AsyncMock(return_value=mock_cat)
        c_repo.increment_usage = AsyncMock()

        t_repo = MagicMock()
        t_repo.update = AsyncMock(return_value=mock_tx)
        stored = make_mock_transaction()
        stored.type = TransactionType.INCOME
        t_repo.get_by_id = AsyncMock(return_value=stored)

        svc = make_service(transaction_repo=t_repo, category_repo=c_repo)

        result = await svc.update_transaction(
            "tx-id", "user-id", TransactionUpdate(category_name="Shopping")
        )

        assert result == mock_tx
        c_repo.increment_usage.assert_awaited_once()
        # The edit sent no type, so the name resolves against the stored row's.
        c_repo.get_by_name.assert_awaited_once_with("Shopping", TransactionType.INCOME)
        assert "type" not in t_repo.update.await_args.args[2]

    @pytest.mark.asyncio
    async def test_update_transaction_not_found_returns_none(self):
        t_repo = MagicMock()
        t_repo.update = AsyncMock(return_value=None)

        svc = make_service(transaction_repo=t_repo)
        result = await svc.update_transaction(
            "nonexistent", "user-id", TransactionUpdate(description="x")
        )
        assert result is None

# ─── TransactionService.delete_transaction ───────────────────────────────────

class TestDeleteTransaction:

    @pytest.mark.asyncio
    async def test_delete_transaction_success(self):
        t_repo = MagicMock()
        t_repo.get_by_id = AsyncMock(return_value=None)
        t_repo.soft_delete = AsyncMock(return_value=True)

        svc = make_service(transaction_repo=t_repo)

        result = await svc.delete_transaction("tx-id", "user-id")

        assert result is True

    @pytest.mark.asyncio
    async def test_delete_transaction_not_found_returns_false(self):
        t_repo = MagicMock()
        t_repo.get_by_id = AsyncMock(return_value=None)
        t_repo.soft_delete = AsyncMock(return_value=False)

        svc = make_service(transaction_repo=t_repo)
        result = await svc.delete_transaction("nonexistent", "user-id")

        assert result is False

# ─── TransactionService.get_analytics ────────────────────────────────────────

class TestGetAnalytics:

    @pytest.mark.asyncio
    async def test_get_analytics_no_cache(self):
        summary = {
            "total_income": Decimal("1000"),
            "total_expenses": Decimal("500"),
            "net_amount": Decimal("500"),
            "transaction_count": 10,
            "currency": "USD",
        }

        t_repo = MagicMock()
        t_repo.get_summary = AsyncMock(return_value=summary.copy())
        t_repo.get_category_breakdown = AsyncMock(return_value=[])
        t_repo.get_monthly_trends = AsyncMock(return_value=[])
        t_repo.get_payment_method_breakdown = AsyncMock(return_value=[])
        t_repo.get_top_merchants = AsyncMock(return_value=[])
        t_repo.get_currency_breakdown = AsyncMock(return_value=[])

        svc = make_service(transaction_repo=t_repo)
        result = await svc.get_analytics("user-id")

        assert result.summary.total_income == Decimal("1000")
        assert result.summary.total_expenses == Decimal("500")

    @pytest.mark.asyncio
    async def test_get_analytics_uses_default_date_range(self):
        summary = {
            "total_income": Decimal("0"),
            "total_expenses": Decimal("0"),
            "net_amount": Decimal("0"),
            "transaction_count": 0,
            "currency": "USD",
        }
        t_repo = MagicMock()
        t_repo.get_summary = AsyncMock(return_value=summary.copy())
        t_repo.get_category_breakdown = AsyncMock(return_value=[])
        t_repo.get_monthly_trends = AsyncMock(return_value=[])
        t_repo.get_payment_method_breakdown = AsyncMock(return_value=[])
        t_repo.get_top_merchants = AsyncMock(return_value=[])
        t_repo.get_currency_breakdown = AsyncMock(return_value=[])

        svc = make_service(transaction_repo=t_repo)
        result = await svc.get_analytics("user-id")

        # Default is last 365 days
        expected_to = business_today()
        expected_from = expected_to - timedelta(days=365)
        assert result.summary.period_end == expected_to
        assert result.summary.period_start == expected_from


# ─── TransactionService._check_duplicate_transaction ─────────────────────────

class TestCheckDuplicateTransaction:

    @pytest.mark.asyncio
    async def test_no_duplicate(self):
        t_repo = MagicMock()
        t_repo.get_all = AsyncMock(return_value=([], 0))

        svc = make_service(transaction_repo=t_repo)
        create_data = TransactionCreate(
            type=TransactionType.EXPENSE,
            amount=Decimal("100"),
            currency="USD",
            description="Coffee",
            transaction_date=business_today(),
            category_name="Food",
        )
        result = await svc._check_duplicate_transaction("user-id", create_data)
        assert result is False

    @pytest.mark.asyncio
    async def test_exact_duplicate_detected(self):
        tx_date = business_today()
        mock_tx = make_mock_transaction(
            description="Coffee", amount=Decimal("100"), tx_date=tx_date
        )

        t_repo = MagicMock()
        t_repo.get_all = AsyncMock(return_value=([mock_tx], 1))

        svc = make_service(transaction_repo=t_repo)
        create_data = TransactionCreate(
            type=TransactionType.EXPENSE,
            amount=Decimal("100"),
            currency="USD",
            description="Coffee",
            transaction_date=tx_date,
            category_name="Food",
        )
        result = await svc._check_duplicate_transaction("user-id", create_data)
        assert result is True

    @pytest.mark.asyncio
    async def test_different_amount_not_duplicate(self):
        mock_tx = make_mock_transaction(description="Coffee", amount=Decimal("200"))
        t_repo = MagicMock()
        t_repo.get_all = AsyncMock(return_value=([mock_tx], 1))

        svc = make_service(transaction_repo=t_repo)
        create_data = TransactionCreate(
            type=TransactionType.EXPENSE,
            amount=Decimal("100"),  # different amount
            currency="USD",
            description="Coffee",
            transaction_date=business_today(),
            category_name="Food",
        )
        result = await svc._check_duplicate_transaction("user-id", create_data)
        assert result is False


# ─── TransactionService.bulk_create_transactions ─────────────────────────────

class TestBulkCreateTransactions:

    @pytest.mark.asyncio
    async def test_bulk_create_all_success(self):
        mock_cat = make_mock_category("Food & Dining")
        mock_txs = [make_mock_transaction() for _ in range(3)]

        c_repo = MagicMock()
        c_repo.get_by_name = AsyncMock(return_value=mock_cat)
        c_repo.increment_usage = AsyncMock()

        t_repo = MagicMock()
        t_repo.create = AsyncMock(side_effect=mock_txs)
        t_repo.get_all = AsyncMock(return_value=([], 0))

        svc = make_service(transaction_repo=t_repo, category_repo=c_repo)

        transactions = [
            TransactionCreate(
                type=TransactionType.EXPENSE,
                amount=Decimal("10"),
                currency="USD",
                description=f"Item {i}",
                transaction_date=business_today(),
                category_name="Food & Dining",
            )
            for i in range(3)
        ]
        bulk_data = BulkTransactionCreate(
            transactions=transactions, skip_duplicates=False
        )

        result = await svc.bulk_create_transactions(bulk_data, "user-id")

        assert result.total_requested == 3
        assert result.successful == 3
        assert result.failed == 0

    @pytest.mark.asyncio
    async def test_bulk_create_skips_duplicates(self):
        mock_tx = make_mock_transaction(description="Coffee", amount=Decimal("10"))
        t_repo = MagicMock()
        t_repo.get_all = AsyncMock(return_value=([mock_tx], 1))

        svc = make_service(transaction_repo=t_repo)

        tx = TransactionCreate(
            type=TransactionType.EXPENSE,
            amount=Decimal("10"),
            currency="USD",
            description="Coffee",
            transaction_date=business_today(),
            category_name="Food",
        )
        bulk_data = BulkTransactionCreate(transactions=[tx], skip_duplicates=True)
        result = await svc.bulk_create_transactions(bulk_data, "user-id")

        assert result.skipped == 1
        assert result.successful == 0

    @pytest.mark.asyncio
    async def test_bulk_create_handles_errors(self):
        c_repo = MagicMock()
        c_repo.get_by_name = AsyncMock(return_value=None)
        c_repo.create = AsyncMock(return_value=None)
        c_repo.get_all = AsyncMock(return_value=[])

        t_repo = MagicMock()

        svc = make_service(transaction_repo=t_repo, category_repo=c_repo)

        tx = TransactionCreate(
            type=TransactionType.EXPENSE,
            amount=Decimal("10"),
            currency="USD",
            description="Test",
            transaction_date=business_today(),
        )
        bulk_data = BulkTransactionCreate(transactions=[tx], skip_duplicates=False)
        result = await svc.bulk_create_transactions(bulk_data, "user-id")

        assert result.failed == 1
        assert result.successful == 0


# ─── CategorizationService ────────────────────────────────────────────────────

class TestCategorizationService:
    """Tests for CategorizationService._categorize_by_rules and auto_categorize"""

    def make_service(self):
        t_repo = MagicMock()
        c_repo = MagicMock()
        return CategorizationService(t_repo, c_repo)

    def test_categorize_by_rules_matches_food(self):
        svc = self.make_service()
        food_cat = make_mock_category("Food & Dining", TransactionType.EXPENSE)
        food_cat.name = "Food & Dining"
        food_cat.type = TransactionType.EXPENSE

        suggestions = svc._categorize_by_rules("starbucks coffee", None, [food_cat])

        assert len(suggestions) >= 1
        assert any("Food & Dining" in s.category_name for s in suggestions)

    def test_categorize_by_rules_matches_transportation(self):
        svc = self.make_service()
        transport_cat = make_mock_category("Transportation", TransactionType.EXPENSE)
        transport_cat.name = "Transportation"
        transport_cat.type = TransactionType.EXPENSE

        suggestions = svc._categorize_by_rules("grab taxi ride", None, [transport_cat])

        assert len(suggestions) >= 1
        assert suggestions[0].category_name == "Transportation"

    def test_categorize_by_rules_no_match_returns_empty(self):
        svc = self.make_service()
        categories = [make_mock_category("Food & Dining")]

        suggestions = svc._categorize_by_rules("completely random text xyz", None, categories)
        assert len(suggestions) == 0

    def test_categorize_by_rules_high_confidence(self):
        svc = self.make_service()
        food_cat = make_mock_category("Food & Dining", TransactionType.EXPENSE)
        food_cat.name = "Food & Dining"
        food_cat.type = TransactionType.EXPENSE

        suggestions = svc._categorize_by_rules("mcdonald burger", None, [food_cat])
        assert len(suggestions) > 0
        assert suggestions[0].confidence >= Decimal("0.7")

    def test_categorize_by_keywords_matches(self):
        svc = self.make_service()
        food_cat = MagicMock()
        food_cat.id = uuid4()
        food_cat.name = "Food & Dining"
        food_cat.type = TransactionType.EXPENSE
        food_cat.keywords = ["restaurant", "food", "dining"]

        suggestions = svc._categorize_by_keywords("restaurant bill", None, [food_cat])
        assert len(suggestions) > 0

    def test_categorize_by_amount_small_suggests_food(self):
        svc = self.make_service()
        food_cat = MagicMock()
        food_cat.id = uuid4()
        food_cat.name = "Food & Dining"
        food_cat.type = TransactionType.EXPENSE

        suggestions = svc._categorize_by_amount(Decimal("5.00"), None, [food_cat])
        assert len(suggestions) > 0

    def test_categorize_by_amount_no_amount_returns_empty(self):
        svc = self.make_service()
        suggestions = svc._categorize_by_amount(None, None, [])
        assert len(suggestions) == 0

    @pytest.mark.asyncio
    async def test_auto_categorize_returns_response(self):
        food_cat = make_mock_category("Food & Dining", TransactionType.EXPENSE)
        food_cat.name = "Food & Dining"
        food_cat.type = TransactionType.EXPENSE
        food_cat.keywords = ["food", "dining"]

        c_repo = MagicMock()
        c_repo.get_all = AsyncMock(return_value=[food_cat])

        t_repo = MagicMock()
        t_repo.search_similar_transactions = AsyncMock(return_value=[])

        svc = CategorizationService(t_repo, c_repo)
        response = await svc.auto_categorize(
            description="pizza delivery", amount=Decimal("25")
        )

        assert response is not None
        assert hasattr(response, "suggestions")
        assert hasattr(response, "primary_suggestion")

# ─── RecurringTransactionService._calculate_next_occurrence ──────────────────

class TestCalculateNextOccurrence:
    """Tests for RecurringTransactionService._calculate_next_occurrence"""

    def make_service(self):
        return RecurringTransactionService(
            recurring_repo=MagicMock(),
            transaction_service=MagicMock(),
        )

    def test_daily_frequency(self):
        svc = self.make_service()
        start = date(2026, 1, 15)
        result = svc._calculate_next_occurrence(start, RecurringFrequency.DAILY, 1)
        assert result == date(2026, 1, 16)

    def test_daily_interval_3(self):
        svc = self.make_service()
        start = date(2026, 1, 15)
        result = svc._calculate_next_occurrence(start, RecurringFrequency.DAILY, 3)
        assert result == date(2026, 1, 18)

    def test_weekly_frequency(self):
        svc = self.make_service()
        start = date(2026, 1, 7)
        result = svc._calculate_next_occurrence(start, RecurringFrequency.WEEKLY, 1)
        assert result == date(2026, 1, 14)

    def test_weekly_interval_2(self):
        svc = self.make_service()
        start = date(2026, 1, 7)
        result = svc._calculate_next_occurrence(start, RecurringFrequency.WEEKLY, 2)
        assert result == date(2026, 1, 21)

    def test_monthly_same_day(self):
        svc = self.make_service()
        start = date(2026, 1, 15)
        result = svc._calculate_next_occurrence(start, RecurringFrequency.MONTHLY, 1)
        assert result == date(2026, 2, 15)

    def test_monthly_year_rollover(self):
        svc = self.make_service()
        start = date(2026, 12, 15)
        result = svc._calculate_next_occurrence(start, RecurringFrequency.MONTHLY, 1)
        assert result == date(2027, 1, 15)

    def test_monthly_jan31_to_feb(self):
        """Jan 31 → Feb 28 (day clamped to valid range)"""
        svc = self.make_service()
        start = date(2026, 1, 31)
        result = svc._calculate_next_occurrence(start, RecurringFrequency.MONTHLY, 1)
        assert result == date(2026, 2, 28)

    def test_monthly_jan31_to_feb_leap_year(self):
        """Jan 31 on a leap year → Feb 29"""
        svc = self.make_service()
        start = date(2024, 1, 31)
        result = svc._calculate_next_occurrence(start, RecurringFrequency.MONTHLY, 1)
        assert result == date(2024, 2, 29)

    def test_quarterly_frequency(self):
        svc = self.make_service()
        start = date(2026, 1, 15)
        result = svc._calculate_next_occurrence(start, RecurringFrequency.QUARTERLY, 1)
        assert result == date(2026, 4, 15)

    def test_yearly_frequency(self):
        svc = self.make_service()
        start = date(2026, 3, 15)
        result = svc._calculate_next_occurrence(start, RecurringFrequency.YEARLY, 1)
        assert result == date(2027, 3, 15)


class TestGetDaysInMonth:

    def make_service(self):
        return RecurringTransactionService(
            recurring_repo=MagicMock(),
            transaction_service=MagicMock(),
        )

    def test_january_has_31_days(self):
        svc = self.make_service()
        assert svc._get_days_in_month(2026, 1) == 31

    def test_april_has_30_days(self):
        svc = self.make_service()
        assert svc._get_days_in_month(2026, 4) == 30

    def test_feb_non_leap_has_28_days(self):
        svc = self.make_service()
        assert svc._get_days_in_month(2026, 2) == 28

    def test_feb_leap_year_has_29_days(self):
        svc = self.make_service()
        assert svc._get_days_in_month(2024, 2) == 29

    def test_feb_century_non_leap_has_28_days(self):
        svc = self.make_service()
        assert svc._get_days_in_month(1900, 2) == 28

    def test_feb_400_year_cycle_leap(self):
        svc = self.make_service()
        assert svc._get_days_in_month(2000, 2) == 29

    def test_december_has_31_days(self):
        svc = self.make_service()
        assert svc._get_days_in_month(2026, 12) == 31


# ─── RecurringTransactionService CRUD ────────────────────────────────────────

class TestRecurringTransactionService:

    def make_service(self):
        r_repo = MagicMock()
        t_svc = MagicMock()
        return RecurringTransactionService(r_repo, t_svc)

    @pytest.mark.asyncio
    async def test_create_recurring_transaction(self):
        mock_recurring = MagicMock()
        mock_recurring.id = uuid4()

        svc = self.make_service()
        svc.recurring_repo.create = AsyncMock(return_value=mock_recurring)

        data = {
            "start_date": business_today(),
            "frequency": RecurringFrequency.MONTHLY,
            "interval": 1,
        }
        result = await svc.create_recurring_transaction(data, "user-id")

        assert result == mock_recurring
        assert data["next_occurrence"] == data["start_date"]

    @pytest.mark.asyncio
    async def test_delete_recurring_transaction(self):
        svc = self.make_service()
        svc.recurring_repo.delete = AsyncMock(return_value=True)

        result = await svc.delete_recurring_transaction("rec-id", "user-id")
        assert result is True

    @pytest.mark.asyncio
    async def test_update_recurring_transaction(self):
        mock_recurring = MagicMock()
        mock_recurring.id = uuid4()
        mock_recurring.frequency = RecurringFrequency.MONTHLY
        mock_recurring.interval = 1
        mock_recurring.start_date = business_today()
        mock_recurring.occurrence_count = 0

        svc = self.make_service()
        svc.recurring_repo.get_by_id = AsyncMock(return_value=mock_recurring)
        svc.recurring_repo.update = AsyncMock(return_value=mock_recurring)

        update_data = RecurringTransactionUpdate(interval=2)
        result = await svc.update_recurring_transaction("rec-id", "user-id", update_data)

        assert result == mock_recurring

    @pytest.mark.asyncio
    async def test_process_due_transactions(self):
        mock_recurring = MagicMock()
        mock_recurring.id = str(uuid4())
        mock_recurring.user_id = str(uuid4())
        mock_recurring.next_occurrence = business_today()
        mock_recurring.type = TransactionType.EXPENSE
        mock_recurring.amount = Decimal("100")
        mock_recurring.currency = "USD"
        mock_recurring.description = "Monthly subscription"
        mock_recurring.category_id = str(uuid4())
        mock_recurring.payment_method = None
        mock_recurring.tags = None
        mock_recurring.notes = None
        mock_recurring.recurring_transaction_id = None
        mock_recurring.auto_create = True
        mock_recurring.end_date = None
        mock_recurring.max_occurrences = None
        mock_recurring.occurrence_count = 0
        mock_recurring.frequency = RecurringFrequency.MONTHLY
        mock_recurring.interval = 1

        svc = self.make_service()
        svc.recurring_repo.get_due_transactions = AsyncMock(return_value=[mock_recurring])
        svc.recurring_repo.update_next_occurrence = AsyncMock()
        svc.transaction_service.create_transaction = AsyncMock(return_value={"transaction": MagicMock()})

        result = await svc.process_due_transactions(business_today())

        assert result["processed"] == 1
        assert result["created"] == 1
        assert result["failed"] == 0


# ─── update_transaction: loan balance re-sync ─────────────────────────────────

def _make_loan_expense(loan_id=None, amount="100.00", principal=None):
    """A minimal expense transaction mock for loan-sync assertions."""
    t = MagicMock()
    t.loan_id = loan_id
    t.type = TransactionType.EXPENSE
    t.amount = Decimal(amount)
    t.principal_portion = Decimal(principal) if principal is not None else None
    t.category_id = str(uuid4())
    # A loan expense, not a transfer leg: a bare MagicMock attribute is truthy and
    # would send delete_transaction looking for the transfer's other leg.
    t.transfer_group_id = None
    return t


def _loan(balance):
    loan = MagicMock()
    loan.name = "Car loan"
    loan.current_balance = Decimal(balance)
    return loan


class TestLoanPaymentBiggerThanBalance:
    """An overpayment used to be clamped to 0 without recording what came off, so
    deleting it later restored too much: 3,000 left, pay 3,200, delete it, and the
    loan showed 3,200. The part that actually came off is now stored as principal."""

    @staticmethod
    def _create_data(amount):
        return TransactionCreate(
            type=TransactionType.EXPENSE,
            amount=Decimal(amount),
            currency="TWD",
            description="Final payment",
            transaction_date=business_today(),
            category_name="Debt",
            loan_id=str(uuid4()),
        )

    @staticmethod
    def _service(balance):
        c_repo = MagicMock()
        c_repo.get_by_name = AsyncMock(return_value=make_mock_category("Debt"))
        c_repo.increment_usage = AsyncMock()
        t_repo = MagicMock()
        t_repo.create = AsyncMock(return_value=make_mock_transaction())
        svc = make_service(transaction_repo=t_repo, category_repo=c_repo)
        svc._get_loan = AsyncMock(return_value=_loan(balance))
        svc._apply_loan_payment = AsyncMock()
        return svc, t_repo

    @pytest.mark.asyncio
    async def test_final_payment_records_only_what_was_left(self):
        svc, t_repo = self._service("3000.00")

        await svc.create_transaction(self._create_data("3200.00"), "user")

        saved = t_repo.create.await_args.args[0]
        assert saved["amount"] == Decimal("3200.00")
        assert saved["principal_portion"] == Decimal("3000.00")
        svc._apply_loan_payment.assert_awaited_once_with(ANY, Decimal("3000.00"), "user")

    @pytest.mark.asyncio
    async def test_payment_that_fits_is_left_alone(self):
        svc, t_repo = self._service("3000.00")

        await svc.create_transaction(self._create_data("1000.00"), "user")

        assert t_repo.create.await_args.args[0].get("principal_portion") is None

    @pytest.mark.asyncio
    async def test_paid_off_loan_is_refused_before_saving(self):
        svc, t_repo = self._service("0.00")

        with pytest.raises(ValueError, match="already paid off"):
            await svc.create_transaction(self._create_data("1000.00"), "user")
        t_repo.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_edit_counts_this_rows_own_payment_as_room(self):
        """100 already paid by this row + 20 left = 120: raising it to 150 records 120."""
        existing = _make_loan_expense(loan_id="loan-123", amount="100.00")
        t_repo = MagicMock()
        t_repo.get_by_id = AsyncMock(return_value=existing)
        t_repo.update = AsyncMock(return_value=_make_loan_expense("loan-123", "150.00", "120.00"))
        svc = make_service(transaction_repo=t_repo)
        svc._apply_loan_payment = AsyncMock()
        svc._get_loan = AsyncMock(return_value=_loan("20.00"))

        await svc.update_transaction("tx", "user", TransactionUpdate(amount=Decimal("150.00")))

        assert t_repo.update.await_args.args[2]["principal_portion"] == Decimal("120.00")
        svc._apply_loan_payment.assert_any_await("loan-123", Decimal("120.00"), "user")

    @pytest.mark.asyncio
    async def test_lowering_a_capped_payment_lowers_its_principal(self):
        """3,200 recorded 3,000 of principal; cut to 2,000, only 2,000 came off."""
        existing = _make_loan_expense("loan-123", "3200.00", "3000.00")
        t_repo = MagicMock()
        t_repo.get_by_id = AsyncMock(return_value=existing)
        t_repo.update = AsyncMock(return_value=_make_loan_expense("loan-123", "2000.00", "2000.00"))
        svc = make_service(transaction_repo=t_repo)
        svc._apply_loan_payment = AsyncMock()
        svc._get_loan = AsyncMock(return_value=_loan("0.00"))

        await svc.update_transaction("tx", "user", TransactionUpdate(amount=Decimal("2000.00")))

        assert t_repo.update.await_args.args[2]["principal_portion"] == Decimal("2000.00")
        svc._apply_loan_payment.assert_any_await("loan-123", Decimal("-3000.00"), "user")
        svc._apply_loan_payment.assert_any_await("loan-123", Decimal("2000.00"), "user")


class TestUpdateTransactionLoanSync:
    """update_transaction must re-sync a loan's balance when the link/amount changes."""

    @pytest.mark.asyncio
    async def test_linking_a_loan_reduces_balance(self):
        existing = _make_loan_expense(loan_id=None, amount="100.00")
        updated = _make_loan_expense(loan_id="loan-123", amount="100.00")
        t_repo = MagicMock()
        t_repo.get_by_id = AsyncMock(return_value=existing)
        t_repo.update = AsyncMock(return_value=updated)
        svc = make_service(transaction_repo=t_repo)
        svc._apply_loan_payment = AsyncMock()
        svc._get_loan = AsyncMock(return_value=_loan("1000.00"))

        await svc.update_transaction("tx", "user", TransactionUpdate(loan_id="loan-123"))

        # Only the new link is applied (no old loan to reverse).
        svc._apply_loan_payment.assert_awaited_once_with("loan-123", Decimal("100.00"), "user")

    @pytest.mark.asyncio
    async def test_unlinking_a_loan_restores_balance(self):
        existing = _make_loan_expense(loan_id="loan-123", amount="100.00")
        updated = _make_loan_expense(loan_id=None, amount="100.00")
        t_repo = MagicMock()
        t_repo.get_by_id = AsyncMock(return_value=existing)
        t_repo.update = AsyncMock(return_value=updated)
        svc = make_service(transaction_repo=t_repo)
        svc._apply_loan_payment = AsyncMock()
        svc._get_loan = AsyncMock(return_value=_loan("1000.00"))

        # Empty string unlinks.
        await svc.update_transaction("tx", "user", TransactionUpdate(loan_id=""))

        # Old link reversed (negative), no new link applied.
        svc._apply_loan_payment.assert_awaited_once_with("loan-123", Decimal("-100.00"), "user")

    @pytest.mark.asyncio
    async def test_amount_change_on_linked_loan_resyncs(self):
        existing = _make_loan_expense(loan_id="loan-123", amount="100.00")
        updated = _make_loan_expense(loan_id="loan-123", amount="150.00")
        t_repo = MagicMock()
        t_repo.get_by_id = AsyncMock(return_value=existing)
        t_repo.update = AsyncMock(return_value=updated)
        svc = make_service(transaction_repo=t_repo)
        svc._apply_loan_payment = AsyncMock()
        svc._get_loan = AsyncMock(return_value=_loan("1000.00"))

        await svc.update_transaction("tx", "user", TransactionUpdate(amount=Decimal("150.00")))

        # Reverse the old 100, apply the new 150.
        assert svc._apply_loan_payment.await_count == 2
        svc._apply_loan_payment.assert_any_await("loan-123", Decimal("-100.00"), "user")
        svc._apply_loan_payment.assert_any_await("loan-123", Decimal("150.00"), "user")

    @pytest.mark.asyncio
    async def test_unrelated_edit_does_not_touch_loans(self):
        existing = _make_loan_expense(loan_id=None, amount="100.00")
        updated = _make_loan_expense(loan_id=None, amount="100.00")
        t_repo = MagicMock()
        t_repo.get_by_id = AsyncMock(return_value=existing)
        t_repo.update = AsyncMock(return_value=updated)
        svc = make_service(transaction_repo=t_repo)
        svc._apply_loan_payment = AsyncMock()
        svc._get_loan = AsyncMock(return_value=_loan("1000.00"))

        await svc.update_transaction("tx", "user", TransactionUpdate(description="new note"))

        svc._apply_loan_payment.assert_not_awaited()


class TestOneCommitPerRequest:
    """A transaction and the loan balance it moves are committed together, or not
    at all. Each repository write used to commit on its own, so a failed balance write
    left a saved payment that never moved its loan (test_loan_balance_invariant.py)."""

    @pytest.mark.asyncio
    async def test_create_writes_without_committing_then_commits_once(self):
        svc, t_repo = TestLoanPaymentBiggerThanBalance._service("3000.00")

        await svc.create_transaction(TestLoanPaymentBiggerThanBalance._create_data("1000.00"), "user")

        assert t_repo.create.await_args.kwargs == {"commit": False}
        svc.category_repo.increment_usage.assert_awaited_once_with(ANY, commit=False)
        t_repo.db.commit.assert_awaited_once()
        t_repo.db.rollback.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_create_rolls_back_when_the_balance_write_fails(self):
        svc, t_repo = TestLoanPaymentBiggerThanBalance._service("3000.00")
        svc._apply_loan_payment = AsyncMock(side_effect=ConnectionError("database lost"))

        with pytest.raises(ConnectionError):
            await svc.create_transaction(TestLoanPaymentBiggerThanBalance._create_data("1000.00"), "user")

        t_repo.db.commit.assert_not_awaited()
        t_repo.db.rollback.assert_awaited_once()

    @staticmethod
    def _linked(amount_after="150.00"):
        t_repo = MagicMock()
        t_repo.get_by_id = AsyncMock(return_value=_make_loan_expense(loan_id="loan-123", amount="100.00"))
        t_repo.update = AsyncMock(return_value=_make_loan_expense(loan_id="loan-123", amount=amount_after))
        t_repo.soft_delete = AsyncMock(return_value=True)
        svc = make_service(transaction_repo=t_repo)
        svc._get_loan = AsyncMock(return_value=_loan("1000.00"))
        svc._apply_loan_payment = AsyncMock()
        return svc, t_repo

    @pytest.mark.asyncio
    async def test_update_commits_once(self):
        svc, t_repo = self._linked()

        await svc.update_transaction("tx", "user", TransactionUpdate(amount=Decimal("150.00")))

        assert t_repo.update.await_args.kwargs == {"commit": False}
        t_repo.db.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_update_rolls_back_when_the_balance_write_fails(self):
        svc, t_repo = self._linked()
        svc._apply_loan_payment = AsyncMock(side_effect=ConnectionError("database lost"))

        with pytest.raises(ConnectionError):
            await svc.update_transaction("tx", "user", TransactionUpdate(amount=Decimal("150.00")))

        t_repo.db.commit.assert_not_awaited()
        t_repo.db.rollback.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_delete_commits_once(self):
        svc, t_repo = self._linked()

        await svc.delete_transaction("tx", "user")

        assert t_repo.soft_delete.await_args.kwargs == {"commit": False}
        t_repo.db.commit.assert_awaited_once()
        t_repo.db.rollback.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_delete_rolls_back_when_the_balance_restore_fails(self):
        svc, t_repo = self._linked()
        svc._apply_loan_payment = AsyncMock(side_effect=ConnectionError("database lost"))

        with pytest.raises(ConnectionError):
            await svc.delete_transaction("tx", "user")

        assert t_repo.soft_delete.await_args.kwargs == {"commit": False}
        t_repo.db.commit.assert_not_awaited()
        t_repo.db.rollback.assert_awaited_once()
