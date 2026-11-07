"""
Shared bills on the Transactions page: the "shared bills only" filter, and the
export columns that let a split row (your share) be read against the bank,
which saw the whole bill.
"""

import csv
import io
import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.modules.transactions.attachment_service import ImportExportService
from app.modules.transactions.models import TransactionType, TransactionWalletType
from app.modules.transactions.repositories import (
    RecurringTransactionRepository, TransactionCategoryRepository, TransactionRepository,
)
from app.modules.transactions.schemas import TransactionFilter
from app.modules.transactions.services import TransactionService
from test_peer_splits import _bill, couple  # noqa: F401  (fixture)

pytestmark = [pytest.mark.asyncio, pytest.mark.database]


async def _setup(session, c):
    """Alice: an ordinary 300 expense, and a 1000 dinner split 50/50 that Bob accepted."""
    await TransactionRepository(session).create({
        "type": TransactionType.EXPENSE, "wallet_type": TransactionWalletType.LIFE,
        "amount": Decimal("300"), "currency": "TWD", "description": "Groceries",
        "transaction_date": date(2026, 11, 4), "category_id": c["food"].id,
    }, str(c["alice"].id))
    sid = uuid.UUID((await c["svc"].create_split(c["alice"].id, _bill(c))).id)
    await c["svc"].respond(c["bob"].id, sid, "accept", None, "life")


async def test_shared_only_lists_just_the_split_rows(async_session, couple):
    c = couple
    await _setup(async_session, c)
    repo = TransactionRepository(async_session)
    rows, total = await repo.get_all(user_id=str(c["alice"].id), filter_params=TransactionFilter(shared_only=True))
    assert (total, [r.description for r in rows], [r.amount for r in rows]) == (1, ["Dinner"], [Decimal("500")])
    everything, total_all = await repo.get_all(user_id=str(c["alice"].id), filter_params=TransactionFilter())
    assert total_all == 2


async def test_export_marks_split_rows_with_the_bill_and_partner(async_session, couple):
    c = couple
    await _setup(async_session, c)
    txs = TransactionService(TransactionRepository(async_session), TransactionCategoryRepository(async_session),
                             RecurringTransactionRepository(async_session))
    content = await ImportExportService(async_session, txs).export_csv(str(c["alice"].id))
    rows = {r["Description"]: r for r in csv.DictReader(io.StringIO(content))}
    assert (rows["Dinner"]["Amount"], rows["Dinner"]["Shared Bill Total"], rows["Dinner"]["Shared With"]) == (
        "500.00", "1000.00", "bob")
    assert (rows["Groceries"]["Shared Bill Total"], rows["Groceries"]["Shared With"]) == ("", "")


async def test_excel_export_has_the_same_columns(async_session, couple):
    import openpyxl

    c = couple
    await _setup(async_session, c)
    txs = TransactionService(TransactionRepository(async_session), TransactionCategoryRepository(async_session),
                             RecurringTransactionRepository(async_session))
    data = await ImportExportService(async_session, txs).export_excel(str(c["alice"].id))
    ws = openpyxl.load_workbook(io.BytesIO(data)).active
    header = [cell.value for cell in ws[1]]
    assert header[-2:] == ["Shared Bill Total", "Shared With"]
    by_desc = {row[4]: row for row in ws.iter_rows(min_row=2, values_only=True)}
    assert by_desc["Dinner"][-2:] == (1000.0, "bob")


async def test_list_route_takes_the_filter(authenticated_client):
    r = authenticated_client.get("/api/v1/transactions/?shared_only=true")
    assert r.status_code == 200, r.text[:200]
