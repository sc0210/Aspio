"""
CSV import previously ignored any Currency column entirely — every row
silently became whatever `default_currency` defaulted to (USD), even for a
file this app itself exported (which does write a Currency column). Covers
the fix: a per-row Currency column wins, and the fallback default is TWD to
match the rest of the app.
"""
from app.modules.transactions.attachment_service import ImportExportService


def _service() -> ImportExportService:
    return ImportExportService(db=None, transaction_service=None)


class TestParseCsvRowCurrency:
    def test_row_currency_column_wins_over_default(self):
        row = {"Date": "2026-07-01", "Amount": "100", "Currency": "USD", "Description": "Coffee"}
        result = _service()._parse_csv_row(row, {"default_currency": "TWD"})
        assert result["currency"] == "USD"

    def test_falls_back_to_default_currency_when_row_has_none(self):
        row = {"Date": "2026-07-01", "Amount": "100", "Description": "Coffee"}
        result = _service()._parse_csv_row(row, {"default_currency": "JPY"})
        assert result["currency"] == "JPY"

    def test_falls_back_to_twd_when_neither_is_set(self):
        row = {"Date": "2026-07-01", "Amount": "100", "Description": "Coffee"}
        result = _service()._parse_csv_row(row, {})
        assert result["currency"] == "TWD"

    def test_row_currency_is_normalized_to_uppercase(self):
        row = {"Date": "2026-07-01", "Amount": "100", "currency": "usd", "Description": "Coffee"}
        result = _service()._parse_csv_row(row, {"default_currency": "TWD"})
        assert result["currency"] == "USD"
