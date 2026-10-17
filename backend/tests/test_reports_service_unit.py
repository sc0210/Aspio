"""
Unit tests for ReportsService.
Pure helper methods are tested directly.
DB-dependent methods are tested with a mocked AsyncSession.
"""

from types import SimpleNamespace
import pytest
from datetime import date, timedelta, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import re
from pathlib import Path

import app.modules.reports.services as reports_services
from app.modules.reports.services import ReportsService
from app.modules.transactions.models import Transaction, TransactionStatus, TransactionType
from app.modules.reports.schemas import (
    SpendingReport,
    CategoryBreakdown,
    ComparisonPeriod,
    SpendingInsight,
    GoalProgress,
)


# ─── Helpers ────────────────────────────────────────────────────────────────

def make_service(db=None):
    mock_db = db or MagicMock()
    return ReportsService(db=mock_db)


def make_spending_report(**kwargs):
    defaults = dict(
        total_income=5000.0,
        total_expenses=3000.0,
        net_savings=2000.0,
        savings_rate=40.0,
        average_daily_spending=100.0,
        category_breakdown=[],
        monthly_trends=[],
        top_merchants=[],
        insights=[],
        comparison_period=None,
    )
    defaults.update(kwargs)
    return SpendingReport(**defaults)


# ─── ReportsService._generate_spending_insights ──────────────────────────────

class TestGenerateSpendingInsights:

    def test_negative_savings_rate_returns_alert(self):
        svc = make_service()
        insights = svc._generate_spending_insights(
            total_expenses=1500.0,
            total_income=1000.0,
            savings_rate=-50.0,
            category_breakdown=[],
        )
        assert any(i.type == "alert" for i in insights)
        assert any("exceed" in i.title.lower() or "exceed" in i.description.lower() for i in insights)

    def test_low_savings_rate_returns_warning(self):
        svc = make_service()
        insights = svc._generate_spending_insights(
            total_expenses=920.0,
            total_income=1000.0,
            savings_rate=8.0,
            category_breakdown=[],
        )
        assert any(i.type == "warning" for i in insights)

    def test_excellent_savings_rate_returns_success(self):
        svc = make_service()
        insights = svc._generate_spending_insights(
            total_expenses=700.0,
            total_income=1000.0,
            savings_rate=30.0,
            category_breakdown=[],
        )
        assert any(i.type == "success" for i in insights)

    def test_no_insight_for_moderate_savings_rate(self):
        svc = make_service()
        # 15% is between 10 and 30 — no savings insight expected
        insights = svc._generate_spending_insights(
            total_expenses=850.0,
            total_income=1000.0,
            savings_rate=15.0,
            category_breakdown=[],
        )
        # Should not have alert or savings success — may be empty or only category insight
        saving_titles = [i.title for i in insights]
        assert "Spending Exceeds Income" not in saving_titles
        assert "Excellent Savings Rate" not in saving_titles

    def test_high_category_spending_adds_info_insight(self):
        svc = make_service()
        top_cat = CategoryBreakdown(
            category="Food & Dining",
            amount=600.0,
            percentage=60.0,
            transaction_count=20,
            color="#FF6B6B",
        )
        insights = svc._generate_spending_insights(
            total_expenses=1000.0,
            total_income=1200.0,
            savings_rate=16.7,
            category_breakdown=[top_cat],
        )
        assert any("Food" in i.title or "60" in i.description for i in insights)

    def test_category_below_40_percent_no_info(self):
        svc = make_service()
        cat = CategoryBreakdown(
            category="Transport",
            amount=300.0,
            percentage=30.0,
            transaction_count=5,
            color="#4ECDC4",
        )
        insights = svc._generate_spending_insights(
            total_expenses=1000.0,
            total_income=1500.0,
            savings_rate=33.3,
            category_breakdown=[cat],
        )
        # Savings success + no category info
        info_insights = [i for i in insights if i.type == "info"]
        assert len(info_insights) == 0


# ─── ReportsService._calculate_portfolio_metrics ─────────────────────────────

class TestGenerateGoalsInsights:

    def test_excellent_progress_returns_success(self):
        svc = make_service()
        insights = svc._generate_goals_insights(
            goals_on_track=3, goals_behind=0, overall_progress=80.0, goal_progress=[]
        )
        assert any(i.type == "success" for i in insights)

    def test_early_progress_returns_info(self):
        svc = make_service()
        insights = svc._generate_goals_insights(
            goals_on_track=1, goals_behind=0, overall_progress=15.0, goal_progress=[]
        )
        assert any(i.type == "info" for i in insights)

    def test_goals_behind_returns_warning(self):
        svc = make_service()
        insights = svc._generate_goals_insights(
            goals_on_track=1, goals_behind=2, overall_progress=40.0, goal_progress=[]
        )
        assert any(i.type == "warning" for i in insights)
        assert any("2" in i.title for i in insights if i.type == "warning")

    def test_all_on_track_no_behind_adds_success(self):
        svc = make_service()
        insights = svc._generate_goals_insights(
            goals_on_track=2, goals_behind=0, overall_progress=50.0, goal_progress=[]
        )
        assert any("on track" in i.title.lower() for i in insights)

    def test_zero_progress_returns_early_journey_info(self):
        svc = make_service()
        insights = svc._generate_goals_insights(
            goals_on_track=0, goals_behind=0, overall_progress=0.0, goal_progress=[]
        )
        # 0% triggers "Early in Goal Journey" info insight
        assert any(i.type == "info" for i in insights)


# ─── ReportsService._calculate_health_score ──────────────────────────────────

class TestGetCategoryBreakdown:

    @staticmethod
    def _twd(txs):
        """What the service hands the helper: each row's id → its TWD amount.

        Face value here — every fixture in this class is TWD. The conversion
        itself is covered by TestAmountsAreConvertedToTwd below.
        """
        return {tx.id: float(tx.amount) for tx in txs}

    def _make_tx(self, type_val, amount, cat_name=None, color="#000000"):
        from app.modules.transactions.models import TransactionType
        tx = MagicMock()
        tx.id = uuid4()
        tx.type = TransactionType.EXPENSE if type_val == "expense" else TransactionType.INCOME
        tx.amount = Decimal(str(amount))
        if cat_name:
            tx.category_obj = MagicMock()
            tx.category_obj.name = cat_name
            tx.category_obj.color = color
        else:
            tx.category_obj = None
        return tx

    @pytest.mark.asyncio
    async def test_single_expense_category(self):
        svc = make_service()
        txs = [
            self._make_tx("expense", 100, "Food", "#FF6B6B"),
            self._make_tx("expense", 200, "Food", "#FF6B6B"),
        ]
        result = await svc._get_category_breakdown(txs, self._twd(txs))
        assert len(result) == 1
        assert result[0].category == "Food"
        assert result[0].amount == 300.0

    @pytest.mark.asyncio
    async def test_income_txns_excluded(self):
        svc = make_service()
        txs = [
            self._make_tx("income", 5000),
            self._make_tx("expense", 200, "Food"),
        ]
        result = await svc._get_category_breakdown(txs, self._twd(txs))
        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_uncategorized_grouping(self):
        svc = make_service()
        txs = [
            self._make_tx("expense", 100, None),
            self._make_tx("expense", 50, None),
        ]
        result = await svc._get_category_breakdown(txs, self._twd(txs))
        assert len(result) == 1
        assert result[0].category == "Uncategorized"
        assert result[0].amount == 150.0

    @pytest.mark.asyncio
    async def test_percentage_calculation(self):
        svc = make_service()
        txs = [
            self._make_tx("expense", 600, "Food"),
            self._make_tx("expense", 400, "Transport"),
        ]
        result = await svc._get_category_breakdown(txs, self._twd(txs))
        # Sorted by amount descending
        food = next(r for r in result if r.category == "Food")
        transport = next(r for r in result if r.category == "Transport")
        assert food.percentage == 60.0
        assert transport.percentage == 40.0

    @pytest.mark.asyncio
    async def test_empty_transactions_returns_empty(self):
        svc = make_service()
        result = await svc._get_category_breakdown([], {})
        assert result == []


class TestSerializedFieldNames:
    """What the frontend actually receives, not what the model holds.

    Every report field is camelCased by an alias generator, and a `Dict[str,
    float]` field is a hole in that: the generator renames fields and never
    looks inside a dict. `comparison_period` was such a dict, so it went out as
    `comparisonPeriod` carrying `net_savings`, and the Spending tab's "net
    savings vs previous period" change read `netSavings` and got nothing —
    silently, for as long as it had existed, while the `income` and `expenses`
    figures beside it worked because those words survive the case change.

    Asserting on the model would not have caught it. This asserts on the dump
    FastAPI sends.
    """

    def test_comparison_period_is_camel_case_on_the_wire(self):
        report = make_spending_report(
            comparison_period=ComparisonPeriod(
                income=5000.0, expenses=3000.0, net_savings=2000.0
            )
        )

        payload = report.model_dump(by_alias=True)

        assert payload["comparisonPeriod"] == {
            "income": 5000.0,
            "expenses": 3000.0,
            "netSavings": 2000.0,
        }

    def test_comparison_period_stays_optional(self):
        payload = make_spending_report().model_dump(by_alias=True)
        assert payload["comparisonPeriod"] is None


class TestMonthlyTrendsIsPublic:
    """The month review reads a year of these and nothing else.

    It used to get them off `/reports/spending`, which eager-loads every
    transaction in the window and builds a category breakdown, top merchants
    and a previous-period comparison beside them — all discarded. The public
    wrapper is what lets the router ask for just the grouped query.
    """

    @pytest.mark.asyncio
    async def test_public_method_returns_what_the_private_one_computes(self):
        # autospec, not a bare AsyncMock: an unspecced mock accepts a call to a
        # method that no longer exists, which is how a repo method that had been
        # renamed went on "passing" here while every login 500d in production.
        svc = make_service()
        expected = [object()]

        with patch.object(
            ReportsService, "_get_monthly_trends", autospec=True, return_value=expected
        ) as private:
            result = await svc.get_monthly_trends(
                "user-1", date(2026, 1, 1), date(2026, 12, 31)
            )

        assert result is expected
        private.assert_awaited_once_with(
            svc, "user-1", date(2026, 1, 1), date(2026, 12, 31)
        )

class TestReportsCountOnlyRealTransactions:
    """Deleted and unsettled rows are not spending.

    The dashboard has always excluded both — `TransactionRepository.get_summary`
    filters `is_deleted == False` and `status == COMPLETED` — while the reports
    service filtered on user and date alone. So a deleted transaction did not
    merely inflate a report; it made the report disagree with the landing page
    for the same window, with nothing to say which was right.

    Every statement the spending report issues is checked, rather than one: the
    totals, the monthly series and the previous-period comparison are three
    separate queries, and fixing one is what leaves a page disagreeing with
    itself instead.
    """

    @staticmethod
    def _capturing_service():
        svc = make_service()
        statements = []

        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        result.all.return_value = []
        # One empty aggregate row, readable both as the previous period's
        # (income, expenses) and as get_summary's totals.
        result.first.return_value = SimpleNamespace(
            income=None, expenses=None, total_income=None, total_expenses=None,
            living_expenses=None, transaction_count=0,
        )

        async def execute(stmt, *args, **kwargs):
            statements.append(stmt)
            return result

        svc.db.execute = execute
        return svc, statements

    @pytest.mark.asyncio
    async def test_every_query_the_spending_report_issues_filters_both(self):
        svc, statements = self._capturing_service()

        await svc.get_spending_report(
            str(uuid4()), date(2026, 8, 1), date(2026, 8, 31)
        )

        # Totals, monthly trends, comparison period, and a currency lookup for
        # each window. Counted loosely on purpose: the rule is that every query
        # carries the filter, not that the report issues a particular number of
        # them.
        assert len(statements) >= 3
        for stmt in statements:
            sql = str(stmt)
            assert "is_deleted" in sql
            assert "status" in sql

    @pytest.mark.asyncio
    async def test_no_transaction_query_in_this_module_is_left_unfiltered(self):
        """The audit, rather than a list of the queries known when this was written.

        The comprehensive report's net-worth balance (a report since retired)
        was missed the first time precisely because it had no date filter, so it
        did not look like the other three. A test naming them individually would
        have missed it too.
        """
        source = Path(reports_services.__file__).read_text()
        queries = [m.start() for m in re.finditer(r"Transaction\.user_id == user_uuid", source)]

        assert len(queries) >= 4, "the audit found no queries — has the module moved?"
        unfiltered = [
            source[:pos].count("\n") + 1
            for pos in queries
            if "_real_transactions()" not in source[pos:pos + 320]
        ]
        assert not unfiltered, f"transaction queries without the row filter, at lines {unfiltered}"

    @pytest.mark.asyncio
    async def test_the_filter_names_completed_rather_than_any_status(self):
        # `status IS NOT NULL` would satisfy the test above while counting
        # cancelled transactions as money spent.
        svc, statements = self._capturing_service()

        await svc.get_spending_report(
            str(uuid4()), date(2026, 8, 1), date(2026, 8, 31)
        )

        for stmt in statements:
            compiled = stmt.compile()
            params = {str(k): v for k, v in compiled.params.items()}
            assert TransactionStatus.COMPLETED in params.values(), params


class TestAmountsAreConvertedToTwd:
    """A USD row is not worth its face value in New Taiwan dollars.

    Every total this app shows is TWD, and each row is stored in the currency it
    was entered in, so summing `amount` added NT$ to US$ as if they were the same
    unit. On the local account one USDT purchase of US$9,062 was counted as
    NT$9,062 — about NT$276,000 short — and the same arithmetic ran on the
    category breakdown, the monthly series and the previous-period comparison.
    """

    @pytest.mark.asyncio
    async def test_the_report_values_a_usd_row_at_its_rate(self):
        svc = make_service()
        usd_row = MagicMock()
        usd_row.id = uuid4()
        usd_row.type = TransactionType.EXPENSE
        usd_row.amount = Decimal("100")
        usd_row.currency = "USD"
        usd_row.category_obj = None
        usd_row.merchant_name = None

        rows = MagicMock()
        rows.scalars.return_value.all.return_value = [usd_row]
        rows.all.return_value = []
        rows.first.return_value = None

        currencies = MagicMock()
        currencies.all.return_value = [("USD",)]

        async def execute(stmt, *args, **kwargs):
            # The currency lookup is the only DISTINCT query the report issues;
            # everything else wants the row result.
            return currencies if "DISTINCT" in str(stmt) else rows

        svc.db.execute = execute

        rate = AsyncMock(return_value={"USD": Decimal("31.5")})
        with patch("app.modules.reports.services.twd_rates_for", rate), patch(
            "app.modules.transactions.repositories.twd_rates_for", rate
        ):
            report = await svc.get_spending_report(
                str(uuid4()), date(2026, 1, 1), date(2026, 1, 31)
            )

        assert report.total_expenses == 3150.0, report.total_expenses
