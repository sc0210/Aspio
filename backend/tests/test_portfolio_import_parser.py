"""parse_import_file: both CSV layouts, XLSX, and every row-level rejection."""

import io

import pytest
from openpyxl import Workbook

from app.modules.portfolio.services import build_import_template_xlsx, parse_import_file

pytestmark = pytest.mark.unit

TRADE_HEADER = "Date,Type,StockID,Currency,Shares,Price per shares,Net income\n"
LEGACY_HEADER = "Symbol,Name,Type,Quantity,Average Cost,Currency,Exchange,Purchase Date\n"


async def parse(text, name="f.csv"):
    return await parse_import_file(text.encode("utf-8"), name)


@pytest.mark.asyncio
class TestTradeLog:
    async def test_buy_row(self):
        r = await parse(TRADE_HEADER + "2026/03/05,買進,0050,TWD,100,150.5,\n")
        assert r["errors"] == []
        (h,) = r["holdings"]
        assert h["symbol"] == "0050" and h["exchange"] == "TWSE" and h["currency"] == "TWD"
        assert (h["quantity"], h["averageCost"], h["purchaseDate"]) == (100.0, 150.5, "2026-03-05")

    async def test_us_row_uses_us_exchange_and_iso_dates(self):
        r = await parse(TRADE_HEADER + "2026-03-05,buy,VT,usd,2,100,\n")
        assert r["holdings"][0]["exchange"] == "US" and r["holdings"][0]["currency"] == "USD"
        assert r["holdings"][0]["purchaseDate"] == "2026-03-05"

    @pytest.mark.parametrize("sell", ["賣出", "SELL", "Sell"])
    async def test_sells_are_skipped(self, sell):
        r = await parse(TRADE_HEADER + f"2026/03/05,{sell},0050,TWD,1,1,\n")
        assert r == {"holdings": [], "errors": []}

    @pytest.mark.parametrize("row,msg", [
        ("2026/03/05,buy,,TWD,1,1,", "Row 2: StockID is required"),
        ("2026/03/05,buy,0050,,1,1,", "Row 2: Currency is required"),
        ("2026/03/05,buy,0050,TWD,abc,1,", "Row 2: Shares must be a number"),
        ("2026/03/05,buy,0050,TWD,0,1,", "Row 2: Shares must be positive"),
        ("2026/03/05,buy,0050,TWD,1,abc,", "Row 2: Price per shares must be a number"),
        ("2026/03/05,buy,0050,TWD,1,-1,", "Row 2: Price per shares must be positive"),
    ])
    async def test_row_rejections(self, row, msg):
        r = await parse(TRADE_HEADER + row + "\n")
        assert r["holdings"] == [] and r["errors"] == [msg]

    async def test_excel_stripped_code_is_explained(self):
        r = await parse(TRADE_HEADER + "2026/03/05,buy,50,TWD,1,1,\n")
        assert r["holdings"] == [] and "leading zeros" in r["errors"][0]

    async def test_bad_date_is_reported_but_row_is_kept(self):
        r = await parse(TRADE_HEADER + "03/05/2026,buy,0050,TWD,1,1,\n")
        assert r["holdings"][0]["purchaseDate"] is None
        assert "Invalid date '03/05/2026'" in r["errors"][0]

    async def test_row_numbers_follow_the_sheet(self):
        r = await parse(TRADE_HEADER + "2026/03/05,buy,0050,TWD,1,1,\n2026/03/05,buy,,TWD,1,1,\n")
        assert len(r["holdings"]) == 1 and r["errors"] == ["Row 3: StockID is required"]


@pytest.mark.asyncio
class TestLegacy:
    async def test_full_row(self):
        r = await parse(LEGACY_HEADER + "VT,Vanguard,ETF,3,100,USD,NYSE,2026-01-02\n")
        assert r["holdings"][0] == {
            "symbol": "VT", "name": "Vanguard", "type": "etf", "currency": "USD",
            "exchange": "NYSE", "quantity": 3.0, "averageCost": 100.0, "purchaseDate": "2026-01-02"}

    async def test_defaults_for_name_exchange_and_type(self):
        r = await parse(LEGACY_HEADER + "0050,,,1,10,TWD,,\n")
        h = r["holdings"][0]
        assert (h["name"], h["exchange"], h["type"], h["purchaseDate"]) == ("0050", "TWSE", "stock", None)

    @pytest.mark.parametrize("row,msg", [
        (",n,stock,1,1,TWD,,", "Row 2: Symbol is required"),
        ("A,n,stock,1,1,,,", "Row 2: Currency is required"),
        ("A,n,stock,x,1,TWD,,", "Row 2: Quantity must be a number"),
        ("A,n,stock,-1,1,TWD,,", "Row 2: Quantity must be positive"),
        ("A,n,stock,1,x,TWD,,", "Row 2: Average Cost must be a number"),
        ("A,n,stock,1,0,TWD,,", "Row 2: Average Cost must be positive"),
    ])
    async def test_row_rejections(self, row, msg):
        r = await parse(LEGACY_HEADER + row + "\n")
        assert r["holdings"] == [] and r["errors"] == [msg]

    async def test_sell_skipped_stripped_code_and_bad_date(self):
        r = await parse(LEGACY_HEADER + "A,n,sell,1,1,TWD,,\n50,n,stock,1,1,TWD,,\nB,n,stock,1,1,TWD,,nope\n")
        assert [h["symbol"] for h in r["holdings"]] == ["B"]
        assert len(r["errors"]) == 2


@pytest.mark.asyncio
class TestFileHandling:
    async def test_empty_csv(self):
        assert await parse("") == {"holdings": [], "errors": []}

    async def test_bom_is_tolerated(self):
        r = await parse_import_file(("﻿" + TRADE_HEADER + "2026/03/05,buy,0050,TWD,1,1,\n").encode(), "a.csv")
        assert len(r["holdings"]) == 1

    async def test_unsupported_extension(self):
        assert (await parse("x", "a.pdf"))["errors"] == ["Unsupported file type: .pdf"]
        assert (await parse("x", "noext"))["errors"] == ["Unsupported file type: ."]

    async def test_corrupt_xlsx_is_reported_not_raised(self):
        r = await parse_import_file(b"not a zip", "a.xlsx")
        assert r["holdings"] == [] and r["errors"][0].startswith("Failed to parse file:")

    async def test_xlsx_numeric_cells_and_blank_rows(self):
        wb = Workbook()
        ws = wb.active
        ws.append(["Date", "Type", "StockID", "Currency", "Shares", "Price per shares"])
        ws.append(["2026/03/05", "buy", "0050", "TWD", 10.0, 150.5])
        ws.append([None] * 6)
        ws.append(["2026/03/06", "buy", 50.0, "TWD", 1, 1])  # Excel turned "0050" into 50
        buf = io.BytesIO()
        wb.save(buf)
        r = await parse_import_file(buf.getvalue(), "a.xlsx")
        assert r["holdings"][0]["quantity"] == 10.0
        assert len(r["holdings"]) == 1 and "leading zeros" in r["errors"][0]

    async def test_empty_xlsx(self):
        buf = io.BytesIO()
        Workbook().save(buf)
        assert await parse_import_file(buf.getvalue(), "a.xlsx") == {"holdings": [], "errors": []}

    async def test_template_round_trips_through_the_parser(self):
        r = await parse_import_file(build_import_template_xlsx(), "template.xlsx")
        assert r["errors"] == []
        assert [h["symbol"] for h in r["holdings"]] == ["0050", "006208", "VT", "BTC-USD"]
