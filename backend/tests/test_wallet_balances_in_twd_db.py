"""Wallet balances are TWD, over completed rows — run against the test database.

The flows (get_summary, the reports) converted every row to TWD while the
balances still summed the raw column with no status filter. On the account this
was found on, one US$9,062 purchase put the dashboard's Life wallet about
NT$276k above the report's net-worth cash. These pin the balance side to the
same rule: convert each row, and count only completed, undeleted transactions.
"""

import uuid as uuid_module
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select

from app.modules.dashboard.services import DashboardService
from app.modules.transactions.models import (
    Transaction,
    TransactionStatus,
    TransactionType,
    TransactionWalletType,
)
from app.modules.transactions.repositories import TransactionRepository

RATES = {"USD": Decimal("31.5")}


def _txn(user_id, amount, currency, *, kind=TransactionType.EXPENSE,
         wallet=TransactionWalletType.LIFE, status=TransactionStatus.COMPLETED, deleted=False):
    return Transaction(
        id=uuid_module.uuid4(),
        user_id=user_id,
        category_id=uuid_module.uuid4(),
        type=kind,
        status=status,
        amount=Decimal(str(amount)),
        currency=currency,
        description="test",
        transaction_date=datetime(2026, 8, 10, tzinfo=timezone.utc),
        wallet_type=wallet,
        is_deleted=deleted,
    )


@pytest.mark.asyncio
@pytest.mark.database
async def test_signed_amount_twd_nets_income_against_converted_debits(async_session):
    user_id = uuid_module.uuid4()
    async_session.add_all([
        _txn(user_id, 10_000, "TWD", kind=TransactionType.INCOME),
        _txn(user_id, 100, "USD"),                                      # −3,150
        _txn(user_id, 999, "USD", status=TransactionStatus.CANCELLED),  # not counted
        _txn(user_id, 999, "TWD", deleted=True),                        # not counted
    ])
    await async_session.commit()

    repo = TransactionRepository(async_session)
    conditions = repo.counted_conditions(user_id)
    with patch("app.modules.transactions.repositories.twd_rates_for", AsyncMock(return_value=RATES)):
        signed = await repo.signed_amount_twd(conditions)
        balance = (await async_session.execute(
            select(func.coalesce(func.sum(signed), 0)).where(*conditions)
        )).scalar_one()

    assert float(balance) == pytest.approx(6850)


@pytest.mark.asyncio
@pytest.mark.database
async def test_dashboard_life_and_emergency_wallets_are_twd(async_session):
    user_id = uuid_module.uuid4()
    async_session.add_all([
        _txn(user_id, 50_000, "TWD", kind=TransactionType.INCOME),
        _txn(user_id, 1_000, "USD"),                                    # Life −31,500
        _txn(user_id, 20_000, "TWD", kind=TransactionType.INCOME,
             wallet=TransactionWalletType.EMERGENCY),
        _txn(user_id, 100, "USD", wallet=TransactionWalletType.EMERGENCY),  # −3,150
        _txn(user_id, 5_000, "USD", status=TransactionStatus.PENDING),  # not counted
    ])
    await async_session.commit()

    with patch("app.modules.transactions.repositories.twd_rates_for", AsyncMock(return_value=RATES)):
        life, portfolio, emergency = await DashboardService(async_session)._calculate_all_wallets(
            str(user_id), holdings=[]
        )
        cash = await TransactionRepository(async_session).cash_balances_twd(user_id)

    assert float(life) == pytest.approx(18_500)
    assert float(emergency) == pytest.approx(16_850)
    # No holdings were passed, so the dashboard's wallets are the cash balances
    # the repository reports per wallet.
    assert float(cash[TransactionWalletType.LIFE]) == pytest.approx(18_500)
    assert float(cash[TransactionWalletType.EMERGENCY]) == pytest.approx(16_850)


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_twd_only_account_keeps_the_balance_it_had(async_session):
    user_id = uuid_module.uuid4()
    async_session.add_all([
        _txn(user_id, 3_000, "TWD", kind=TransactionType.INCOME),
        _txn(user_id, 1_200, "TWD"),
    ])
    await async_session.commit()

    life, _, _ = await DashboardService(async_session)._calculate_all_wallets(str(user_id), holdings=[])

    assert float(life) == pytest.approx(1_800)


@pytest.mark.asyncio
@pytest.mark.database
async def test_cash_balances_narrow_by_condition_and_reuse_the_rates_given(async_session):
    # Wallet trends asks for the balances before its window, with rates it has
    # already fetched for the window itself.
    user_id = uuid_module.uuid4()
    july = _txn(user_id, 100, "USD", kind=TransactionType.INCOME)
    july.transaction_date = datetime(2026, 7, 1, tzinfo=timezone.utc)
    async_session.add_all([
        july,                                                               # Life +3,150, before August
        _txn(user_id, 1_000, "TWD", kind=TransactionType.INCOME),           # Life, in August
        _txn(user_id, 500, "TWD", wallet=TransactionWalletType.EMERGENCY),  # Emergency, in August
    ])
    await async_session.commit()

    lookup = AsyncMock(return_value={})
    with patch("app.modules.transactions.repositories.twd_rates_for", lookup):
        before_august = await TransactionRepository(async_session).cash_balances_twd(
            user_id, Transaction.transaction_date < date(2026, 8, 1), rates=RATES
        )

    assert set(before_august) == {TransactionWalletType.LIFE}
    assert float(before_august[TransactionWalletType.LIFE]) == pytest.approx(3_150)
    lookup.assert_not_awaited()
