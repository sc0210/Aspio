"""The LINE /balance and /summary cards state the unit their numbers are in.

Both now total in TWD, whatever currency each row was entered in. /balance used
to take its label from the user's preferred currency, so a USD-preferring user
saw "USD 31,500" for a month of US$1,000. /summary summed the raw column, so it
disagreed with /balance about the same month.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

import app.modules.line_bot.service as svc

LINK = SimpleNamespace(user_id=uuid4())


@pytest.mark.asyncio
async def test_balance_card_is_labelled_twd_even_for_a_usd_preferring_user():
    repo = MagicMock()
    repo.get_summary = AsyncMock(return_value={
        "total_income": 0, "total_expenses": 31500, "net_amount": -31500,
        "transaction_count": 1, "currency": "TWD",
    })
    flex = MagicMock(return_value={})

    with patch.object(svc, "_get_link", AsyncMock(return_value=LINK)), \
         patch.object(svc, "_get_user_currency", AsyncMock(return_value="USD")), \
         patch.object(svc, "TransactionRepository", MagicMock(return_value=repo)), \
         patch.object(svc, "_log_activity", AsyncMock()), \
         patch.object(svc, "_reply_flex", AsyncMock()), \
         patch.object(svc, "_flex_dm_balance", flex):
        await svc.handle_dm_balance_command(MagicMock(), "U1", "reply-token")

    assert flex.call_args.args[2] == "TWD"


@pytest.mark.asyncio
async def test_summary_card_converts_in_sql_and_is_labelled_twd():
    from decimal import Decimal

    repo = MagicMock()
    repo.twd_rates_for_conditions = AsyncMock(return_value={"USD": Decimal("31.5")})
    repo_cls = MagicMock(return_value=repo)
    # The row filter is the real one; only the rate lookup is stubbed.
    from app.modules.transactions.repositories import TransactionRepository
    repo_cls.counted_conditions = TransactionRepository.counted_conditions

    rows = MagicMock()
    rows.all.return_value = [SimpleNamespace(category_name="Food", total_amount=Decimal("3150"))]
    db = MagicMock()
    db.execute = AsyncMock(return_value=rows)
    flex = MagicMock(return_value={})

    with patch.object(svc, "_get_link", AsyncMock(return_value=LINK)), \
         patch.object(svc, "_get_user_currency", AsyncMock(return_value="USD")), \
         patch.object(svc, "TransactionRepository", repo_cls), \
         patch.object(svc, "_log_activity", AsyncMock()), \
         patch.object(svc, "_category_pie_url", MagicMock(return_value="https://chart")), \
         patch.object(svc, "_send", AsyncMock()), \
         patch.object(svc, "_flex_dm_summary", flex):
        await svc.handle_dm_summary_command(db, "U1", "reply-token")

    assert flex.call_args.args[2] == "TWD"

    sql = str(db.execute.call_args.args[0]).lower()
    assert "upper(transactions.currency)" in sql  # the conversion is in the query
    assert "transactions.status" in sql            # and only completed rows count
