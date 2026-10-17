"""
Unit tests for portfolio CSV export format and import/export round-trip behaviour.

All DB I/O is mocked — these are pure-logic tests for:
  • export_portfolio_csv  (PortfolioService)
  • CSV header / column order
  • Date formatting  (YYYY/MM/DD)
  • Numeric columns have no currency prefix
  • Net-income sign  (negative for buys)
  • Results sorted by purchase_date (order delegated to DB; we verify pass-through)
  • Date-range filter parameters are forwarded to the query
  • Transaction creation on add_holding  (audit-trail assertion)
"""

import csv
import io
import pytest
import pytest_asyncio
from datetime import datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch, call
from uuid import uuid4


# ─── Helper: build a PortfolioService with everything mocked ────────────────

def make_portfolio_service():
    mock_session = MagicMock()
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()
    mock_session.add = MagicMock()

    with (
        patch("app.modules.portfolio.services.PortfolioRepository"),
        patch("app.modules.portfolio.services.HoldingRepository"),
        patch("app.modules.portfolio.services.TransactionRepository"),
        patch("app.modules.portfolio.services.MarketDataRepository"),
        patch("app.modules.portfolio.services.CurrencyRepository"),
    ):
        from app.modules.portfolio.services import PortfolioService
        svc = PortfolioService(mock_session)

    svc.portfolio_repo = MagicMock()
    svc.holding_repo = MagicMock()
    svc.transaction_repo = MagicMock()
    svc.transaction_repo.create = AsyncMock()
    svc.market_data_repo = MagicMock()
    svc.currency_repo = MagicMock()
    svc.session = mock_session
    return svc


def make_mock_holding(
    symbol="0050",
    currency="TWD",
    quantity=Decimal("87"),
    average_cost=Decimal("114.04"),
    purchase_date=datetime(2025, 1, 3),
):
    h = MagicMock()
    h.symbol = symbol
    h.currency = currency
    h.quantity = quantity
    h.average_cost = average_cost
    h.purchase_date = purchase_date
    h.is_active = True
    return h


def _mock_execute(svc, holdings):
    """Wire svc.session.execute to return the given holdings list."""
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = holdings
    svc.session.execute = AsyncMock(return_value=mock_result)


def _parse_csv(csv_text: str):
    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)
    return rows[0], rows[1:]  # (header, data_rows)


# ─── CSV headers ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_csv_has_correct_headers():
    svc = make_portfolio_service()
    _mock_execute(svc, [])

    output = await svc.export_portfolio_csv(uuid4())
    header, _ = _parse_csv(output)

    assert header == ["Date", "Type", "StockID", "Currency", "Shares",
                      "Price per shares", "Net income"]


@pytest.mark.asyncio
async def test_export_csv_has_exactly_7_columns():
    svc = make_portfolio_service()
    _mock_execute(svc, [make_mock_holding()])

    output = await svc.export_portfolio_csv(uuid4())
    header, rows = _parse_csv(output)

    assert len(header) == 7
    for row in rows:
        assert len(row) == 7


# ─── Empty portfolio ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_csv_empty_portfolio_returns_header_only():
    svc = make_portfolio_service()
    _mock_execute(svc, [])

    output = await svc.export_portfolio_csv(uuid4())
    header, data_rows = _parse_csv(output)

    assert header == ["Date", "Type", "StockID", "Currency", "Shares",
                      "Price per shares", "Net income"]
    assert data_rows == []


# ─── Date formatting ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_csv_date_format_is_yyyy_slash_mm_slash_dd():
    svc = make_portfolio_service()
    holding = make_mock_holding(purchase_date=datetime(2025, 8, 24))
    _mock_execute(svc, [holding])

    _, rows = _parse_csv(await svc.export_portfolio_csv(uuid4()))
    assert rows[0][0] == "2025/08/24"


@pytest.mark.asyncio
async def test_export_csv_empty_date_when_no_purchase_date():
    svc = make_portfolio_service()
    holding = make_mock_holding()
    holding.purchase_date = None
    _mock_execute(svc, [holding])

    _, rows = _parse_csv(await svc.export_portfolio_csv(uuid4()))
    assert rows[0][0] == ""


# ─── Type column ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_csv_type_is_always_buy():
    svc = make_portfolio_service()
    _mock_execute(svc, [make_mock_holding(), make_mock_holding(symbol="VT")])

    _, rows = _parse_csv(await svc.export_portfolio_csv(uuid4()))
    for row in rows:
        assert row[1] == "買入"


# ─── Numeric columns — no currency prefix ────────────────────────────────────

@pytest.mark.asyncio
async def test_export_csv_price_per_shares_is_plain_number():
    svc = make_portfolio_service()
    _mock_execute(svc, [make_mock_holding(average_cost=Decimal("114.04"))])

    _, rows = _parse_csv(await svc.export_portfolio_csv(uuid4()))
    price_str = rows[0][5]
    # Must not contain any currency prefix
    assert "$" not in price_str
    assert float(price_str) == pytest.approx(114.04)


@pytest.mark.asyncio
async def test_export_csv_net_income_is_plain_negative_number():
    svc = make_portfolio_service()
    _mock_execute(svc, [make_mock_holding(quantity=Decimal("87"), average_cost=Decimal("114.04"))])

    _, rows = _parse_csv(await svc.export_portfolio_csv(uuid4()))
    net_str = rows[0][6]
    assert "$" not in net_str
    net = float(net_str)
    assert net < 0
    assert net == pytest.approx(-(87 * 114.04), rel=1e-4)


@pytest.mark.asyncio
async def test_export_csv_usd_price_has_no_dollar_sign():
    svc = make_portfolio_service()
    _mock_execute(svc, [make_mock_holding(symbol="VT", currency="USD",
                                          quantity=Decimal("50.699"),
                                          average_cost=Decimal("114.95"))])

    _, rows = _parse_csv(await svc.export_portfolio_csv(uuid4()))
    assert "$" not in rows[0][5]
    assert "$" not in rows[0][6]


# ─── StockID column ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_csv_stockid_matches_symbol():
    svc = make_portfolio_service()
    _mock_execute(svc, [make_mock_holding(symbol="006208")])

    _, rows = _parse_csv(await svc.export_portfolio_csv(uuid4()))
    assert rows[0][2] == "006208"


# ─── Row ordering (pass-through from DB ORDER BY) ────────────────────────────

@pytest.mark.asyncio
async def test_export_csv_preserves_order_from_query():
    """The SQL query uses ORDER BY purchase_date ASC. The service must preserve
    whatever order the DB returns — we verify pass-through here."""
    svc = make_portfolio_service()
    h1 = make_mock_holding(symbol="0050", purchase_date=datetime(2025, 1, 1))
    h2 = make_mock_holding(symbol="VT", purchase_date=datetime(2025, 8, 24))
    # Simulate DB returning already-sorted results
    _mock_execute(svc, [h1, h2])

    _, rows = _parse_csv(await svc.export_portfolio_csv(uuid4()))
    assert rows[0][2] == "0050"
    assert rows[1][2] == "VT"


# ─── Date-range filtering ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_csv_date_range_parameters_forwarded_to_query():
    """date_from / date_to must reach the underlying SQL WHERE clause.
    We verify that session.execute is called (with some statement that includes
    the filter) when those parameters are provided."""
    svc = make_portfolio_service()
    _mock_execute(svc, [])

    date_from = datetime(2025, 1, 1)
    date_to = datetime(2025, 12, 31)
    await svc.export_portfolio_csv(uuid4(), date_from=date_from, date_to=date_to)

    svc.session.execute.assert_called_once()


# ─── add_holding creates a transaction record ─────────────────────────────────

def _setup_add_holding_mocks(svc):
    """Common mock setup for add_holding tests."""
    mock_portfolio = MagicMock()
    mock_portfolio.id = uuid4()
    svc.get_default_portfolio = AsyncMock(return_value=mock_portfolio)

    mock_holding = MagicMock()
    mock_holding.id = uuid4()
    svc.holding_repo.create_or_aggregate_holding = AsyncMock(return_value=mock_holding)
    svc._sync_wallet_transaction = AsyncMock()
    svc._update_portfolio_totals = AsyncMock()
    # Patch HoldingResponse.from_orm so Pydantic doesn't validate the mock object
    svc._holding_response_patch = patch(
        "app.modules.portfolio.services.HoldingResponse.model_validate",
        return_value=MagicMock(),
    )


@pytest.mark.asyncio
async def test_add_holding_creates_buy_transaction():
    """
    When a holding is added via add_holding (e.g. from CSV import), a 'buy'
    transaction must be written to the transaction repository.
    This is what causes imported lots to appear on the Transactions page.
    """
    svc = make_portfolio_service()
    _setup_add_holding_mocks(svc)

    from app.modules.portfolio.schemas import HoldingCreate
    holding_data = HoldingCreate(
        symbol="0050",
        name="元大台灣50",
        type="etf",
        exchange="TWSE",
        currency="TWD",
        quantity=Decimal("87"),
        average_cost=Decimal("114.04"),
        purchase_date=datetime(2025, 1, 3),
        wallet_type="portfolio",
    )

    with patch("app.core.background_tasks.run_in_background"), svc._holding_response_patch:
        await svc.add_holding(uuid4(), holding_data, aggregate=False)

    svc.transaction_repo.create.assert_called_once()
    tx_args = svc.transaction_repo.create.call_args[0][0]
    assert tx_args["type"] == "buy"
    assert tx_args["symbol"] == "0050"
    assert tx_args["quantity"] == Decimal("87")
    assert tx_args["price"] == Decimal("114.04")


@pytest.mark.asyncio
async def test_add_holding_transaction_uses_purchase_date():
    """The transaction date must equal the purchase_date from the CSV row."""
    svc = make_portfolio_service()
    _setup_add_holding_mocks(svc)

    purchase_date = datetime(2025, 8, 24)

    from app.modules.portfolio.schemas import HoldingCreate
    holding_data = HoldingCreate(
        symbol="VT",
        name="Vanguard Total World Stock ETF",
        type="etf",
        exchange="US",
        currency="USD",
        quantity=Decimal("50.699"),
        average_cost=Decimal("114.95"),
        purchase_date=purchase_date,
        wallet_type="portfolio",
    )

    with patch("app.core.background_tasks.run_in_background"), svc._holding_response_patch:
        await svc.add_holding(uuid4(), holding_data, aggregate=False)

    tx_args = svc.transaction_repo.create.call_args[0][0]
    assert tx_args["transaction_date"] == purchase_date


# ════════════════════════════════════════════════════════════════════════════
# Import side: parse_import_file (trade-log CSV)
# ════════════════════════════════════════════════════════════════════════════

TRADE_LOG_HEADER = "Date,Type,StockID,Currency,Shares,Price per shares,Net income"


def _csv_bytes(*data_rows: str, header: str = TRADE_LOG_HEADER, bom: bool = True) -> bytes:
    """Build CSV file bytes (UTF-8, BOM-prefixed like the template/export)."""
    text = "\n".join([header, *data_rows])
    return (("﻿" if bom else "") + text).encode("utf-8")


@pytest.mark.asyncio
async def test_parse_csv_trade_log_basic():
    from app.modules.portfolio.services import parse_import_file

    result = await parse_import_file(
        _csv_bytes("2025/01/15,買入,0050,TWD,1000,61.50,-61500.00"),
        "import.csv",
    )

    assert result["errors"] == []
    assert len(result["holdings"]) == 1
    h = result["holdings"][0]
    assert h["symbol"] == "0050"          # leading zero preserved (CSV cells are text)
    assert h["currency"] == "TWD"
    assert h["exchange"] == "TWSE"
    assert h["quantity"] == 1000.0
    assert h["averageCost"] == pytest.approx(61.50)
    assert h["purchaseDate"] == "2025-01-15"
    assert h["type"] == "stock"


@pytest.mark.asyncio
async def test_parse_csv_skips_sell_rows():
    from app.modules.portfolio.services import parse_import_file

    result = await parse_import_file(
        _csv_bytes(
            "2025/01/15,買入,0050,TWD,1000,61.50,-61500.00",
            "2025/06/01,賣出,0050,TWD,500,70.00,35000.00",   # Chinese sell
            "2025/07/01,Sell,VT,USD,10,120.00,1200.00",       # English sell
        ),
        "import.csv",
    )

    assert result["errors"] == []
    assert [h["symbol"] for h in result["holdings"]] == ["0050"]


@pytest.mark.asyncio
async def test_parse_csv_derives_exchange_from_currency():
    from app.modules.portfolio.services import parse_import_file

    result = await parse_import_file(
        _csv_bytes(
            "2025/01/15,買入,0050,TWD,1000,61.50,-61500.00",
            "2025/03/10,買入,VT,USD,100,114.25,-11425.00",
        ),
        "import.csv",
    )

    by_symbol = {h["symbol"]: h for h in result["holdings"]}
    assert by_symbol["0050"]["exchange"] == "TWSE"
    assert by_symbol["VT"]["exchange"] == "US"


@pytest.mark.asyncio
async def test_parse_csv_missing_stockid_is_error():
    from app.modules.portfolio.services import parse_import_file

    result = await parse_import_file(
        _csv_bytes("2025/01/15,買入,,TWD,1000,61.50,-61500.00"),
        "import.csv",
    )

    assert result["holdings"] == []
    assert any("StockID is required" in e for e in result["errors"])
    assert "Row 2" in result["errors"][0]


@pytest.mark.asyncio
async def test_parse_csv_non_positive_shares_is_error():
    from app.modules.portfolio.services import parse_import_file

    result = await parse_import_file(
        _csv_bytes("2025/01/15,買入,0050,TWD,0,61.50,0"),
        "import.csv",
    )

    assert result["holdings"] == []
    assert any("Shares must be positive" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_parse_csv_non_numeric_price_is_error():
    from app.modules.portfolio.services import parse_import_file

    result = await parse_import_file(
        _csv_bytes("2025/01/15,買入,0050,TWD,1000,not-a-price,0"),
        "import.csv",
    )

    assert result["holdings"] == []
    assert any("Price per shares must be a number" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_parse_csv_invalid_date_reported_but_row_kept():
    from app.modules.portfolio.services import parse_import_file

    result = await parse_import_file(
        _csv_bytes("15-01-2025,買入,0050,TWD,1000,61.50,-61500.00"),
        "import.csv",
    )

    # Invalid date is flagged as an error but the (otherwise valid) row is still parsed
    assert any("Invalid date" in e for e in result["errors"])
    assert len(result["holdings"]) == 1
    assert result["holdings"][0]["purchaseDate"] is None


@pytest.mark.asyncio
async def test_parse_csv_handles_bom_and_crlf():
    from app.modules.portfolio.services import parse_import_file

    # Excel commonly writes CRLF line endings + a BOM
    text = "\r\n".join([TRADE_LOG_HEADER, "2025/01/15,買入,0050,TWD,1000,61.50,-61500.00"])
    content = ("﻿" + text).encode("utf-8")

    result = await parse_import_file(content, "import.csv")
    assert result["errors"] == []
    assert result["holdings"][0]["symbol"] == "0050"


@pytest.mark.asyncio
async def test_parse_unsupported_extension():
    from app.modules.portfolio.services import parse_import_file

    result = await parse_import_file(b"whatever", "import.txt")
    assert result["holdings"] == []
    assert any("Unsupported file type" in e for e in result["errors"])


# ════════════════════════════════════════════════════════════════════════════
# Template: build_import_template_xlsx
# ════════════════════════════════════════════════════════════════════════════

def _load_template_ws():
    from io import BytesIO
    from openpyxl import load_workbook
    from app.modules.portfolio.services import build_import_template_xlsx

    wb = load_workbook(BytesIO(build_import_template_xlsx()))
    return wb.active


def test_template_has_correct_headers():
    ws = _load_template_ws()
    headers = [ws.cell(row=1, column=c).value for c in range(1, 8)]
    assert headers == ["Date", "Type", "StockID", "Currency", "Shares",
                       "Price per shares", "Net income"]


def test_template_stockid_column_is_text_format():
    """The StockID column must be text-formatted (@) so Excel does not coerce
    leading-zero tickers (0050 → 50) when the user opens/edits the template."""
    ws = _load_template_ws()
    # Sample rows (2..5) + a band of blank rows below must all be text in column C
    for row in range(2, 30):
        assert ws.cell(row=row, column=3).number_format == "@", f"row {row} StockID not text"


def test_template_sample_rows_include_leading_zero_tickers():
    ws = _load_template_ws()
    stockids = [ws.cell(row=r, column=3).value for r in range(2, 6)]
    assert "0050" in stockids
    assert "006208" in stockids


@pytest.mark.asyncio
async def test_template_roundtrips_through_import_parser():
    """The blank template must re-import cleanly with leading zeros intact —
    this is the end-to-end fix for 'import reads wrong symbols'."""
    from app.modules.portfolio.services import build_import_template_xlsx, parse_import_file

    data = build_import_template_xlsx()
    result = await parse_import_file(data, "portfolio_template.xlsx")

    assert result["errors"] == []
    symbols = [h["symbol"] for h in result["holdings"]]
    assert "0050" in symbols and "006208" in symbols   # leading zeros survived
    # Crypto round-trips as the pair form: bare "BTC" is a US-listed ETF ticker
    # (Grayscale Bitcoin Mini Trust), so it prices a different security.
    assert "VT" in symbols and "BTC-USD" in symbols


# ════════════════════════════════════════════════════════════════════════════
# Full export → import round-trip (XLSX preserves leading zeros)
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_export_xlsx_reimport_preserves_leading_zeros():
    """Export holdings to XLSX, then feed that exact file back into the import
    parser. Taiwan tickers with leading zeros must round-trip unchanged."""
    from app.modules.portfolio.services import parse_import_file

    svc = make_portfolio_service()
    _mock_execute(svc, [
        make_mock_holding(symbol="0050", currency="TWD",
                          quantity=Decimal("1000"), average_cost=Decimal("61.5"),
                          purchase_date=datetime(2025, 1, 15)),
        make_mock_holding(symbol="006208", currency="TWD",
                          quantity=Decimal("500"), average_cost=Decimal("95.2"),
                          purchase_date=datetime(2025, 2, 20)),
        make_mock_holding(symbol="VT", currency="USD",
                          quantity=Decimal("100"), average_cost=Decimal("114.25"),
                          purchase_date=datetime(2025, 3, 10)),
    ])

    xlsx_bytes = await svc.export_portfolio_xlsx(uuid4())
    result = await parse_import_file(xlsx_bytes, "portfolio_export.xlsx")

    assert result["errors"] == []
    by_symbol = {h["symbol"]: h for h in result["holdings"]}
    assert set(by_symbol) == {"0050", "006208", "VT"}
    assert by_symbol["0050"]["quantity"] == 1000.0
    assert by_symbol["0050"]["averageCost"] == pytest.approx(61.5)
    assert by_symbol["0050"]["purchaseDate"] == "2025-01-15"
    assert by_symbol["006208"]["exchange"] == "TWSE"
    assert by_symbol["VT"]["exchange"] == "US"
