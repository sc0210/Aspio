"""SQL-compilation tests for the transaction search filter.

These compile the real statements (no DB) because the bug they guard against
lives in statement construction, not in any repository return value: mocked
repositories cannot see it.

Regression: the category-name `exists()` clause in `_apply_filters` had no
explicit `.correlate()`, so a caller whose own FROM already joined
`transaction_categories` — the page-stats category breakdown — auto-correlated
BOTH tables away and left the subquery with no FROM clause. SQLAlchemy raised
`InvalidRequestError` at compile time, so `GET /transactions/stats` returned 500
for every search, and the transactions page silently rendered NT$0 stat cards
and an empty category quick-filter list while the list below still showed the
matching rows.
"""

import uuid

import pytest
from sqlalchemy import and_, func, join as sql_join, select

from app.modules.transactions.models import Transaction, TransactionCategory
from app.modules.transactions.repositories import TransactionRepository
from app.modules.transactions.schemas import TransactionFilter

pytestmark = pytest.mark.unit

USER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")


@pytest.fixture
def repo():
    """A repository with no session — only `_apply_filters` is exercised."""
    return TransactionRepository.__new__(TransactionRepository)


def _base_where():
    return and_(Transaction.user_id == USER_ID, Transaction.is_deleted == False)  # noqa: E712


def _compile(stmt):
    return str(stmt.compile())


def test_search_on_joined_category_query_compiles(repo):
    """The page-stats breakdown shape: outer FROM already joins categories."""
    stmt = (
        select(
            TransactionCategory.name,
            Transaction.type,
            Transaction.currency,
            func.coalesce(func.sum(Transaction.amount), 0).label("amount"),
        )
        .select_from(
            sql_join(
                Transaction,
                TransactionCategory,
                Transaction.category_id == TransactionCategory.id,
            )
        )
        .where(_base_where())
        .group_by(TransactionCategory.name, Transaction.type, Transaction.currency)
    )

    sql = _compile(repo._apply_filters(stmt, TransactionFilter(search="AI")))

    # The EXISTS subquery must keep its own FROM clause instead of being
    # auto-correlated into nothing.
    assert "EXISTS (SELECT" in sql
    assert sql.count("FROM transaction_categories") >= 1


def test_search_on_plain_transaction_query_compiles(repo):
    """The list shape: outer FROM is transactions only."""
    stmt = select(Transaction).where(_base_where())

    sql = _compile(repo._apply_filters(stmt, TransactionFilter(search="AI")))

    assert "EXISTS (SELECT" in sql
    assert "FROM transaction_categories" in sql


def test_search_on_aggregate_summary_compiles(repo):
    """The stat-card summary shape: grouped aggregate over transactions."""
    stmt = (
        select(Transaction.currency, func.count(Transaction.id))
        .where(_base_where())
        .group_by(Transaction.currency)
    )

    sql = _compile(repo._apply_filters(stmt, TransactionFilter(search="AI")))

    assert "EXISTS (SELECT" in sql
    assert "FROM transaction_categories" in sql
