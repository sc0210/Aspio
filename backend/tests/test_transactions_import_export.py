"""Transaction CSV/Excel export, CSV row parsing, and the import-batch endpoints."""

import csv
import io
from datetime import date
from decimal import Decimal
from uuid import uuid4

import openpyxl
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from app.modules.transactions.attachment_service import ImportExportService
from app.modules.users.models import User, UserRole, UserStatus

BASE = "/api/v1/transactions"

SEED = (
    "Date,Type,Amount,Currency,Description,Category,Merchant\n"
    "2026-07-08,expense,88.00,USD,Lunch,Shopping,Cafe\n"
    "2026-07-09,income,1000,TWD,Salary,Shopping,\n"
    "2026-08-01,expense,5,TWD,Late,Shopping,\n"
)


@pytest_asyncio.fixture(autouse=True)
async def _shopping_categories(async_session):
    """Categories are global and only admins add them, so an import resolves names
    to existing rows. The CSVs here use 'Shopping', which a real instance has."""
    from app.modules.transactions.models import TransactionCategory, TransactionType

    for t in (TransactionType.EXPENSE, TransactionType.INCOME):
        async_session.add(TransactionCategory(name="Shopping", name_en="Shopping", type=t, icon="🛍️", color="#F9CA24"))
    await async_session.commit()


@pytest.fixture
def user():
    return User(id=uuid4(), email="io@example.com", name="IO", hashed_password="x", is_active=True,
                is_verified=True, status=UserStatus.ACTIVE, role=UserRole.USER, preferences={})


@pytest.fixture
def client(user, override_get_async_session):
    from app.core.database import get_async_session, get_db
    from app.main import app as fastapi_app
    from app.modules.users.dependencies import get_current_active_user, get_optional_current_user

    fastapi_app.dependency_overrides[get_current_active_user] = lambda: user
    fastapi_app.dependency_overrides[get_optional_current_user] = lambda: user
    fastapi_app.dependency_overrides[get_async_session] = override_get_async_session
    fastapi_app.dependency_overrides[get_db] = override_get_async_session
    with TestClient(fastapi_app) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def seeded(client):
    r = client.post(f"{BASE}/upload-import", files={"file": ("seed.csv", SEED, "text/csv")})
    assert r.status_code == 200 and r.json()["imported"] == 3, r.text
    return client


def rows_of(csv_text):
    return list(csv.DictReader(io.StringIO(csv_text)))


class TestExport:
    @pytest.mark.parametrize("path", [f"{BASE}/export?format=csv", f"{BASE}/export/csv"])
    def test_csv_has_every_row_in_its_currency(self, seeded: TestClient, path):
        r = seeded.get(path)
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
        assert r.headers["content-disposition"] == 'attachment; filename="transactions.csv"'
        rows = sorted(rows_of(r.text), key=lambda x: x["Date"])
        assert [(x["Date"], x["Type"], Decimal(x["Amount"]), x["Currency"]) for x in rows] == [
            ("2026-07-08", "expense", Decimal("88"), "USD"),
            ("2026-07-09", "income", Decimal("1000"), "TWD"),
            ("2026-08-01", "expense", Decimal("5"), "TWD"),
        ]
        assert rows[0]["Category"] == "Shopping" and rows[0]["Merchant"] == "Cafe"

    def test_date_range_filters_and_names_the_file(self, seeded: TestClient):
        r = seeded.get(f"{BASE}/export", params={"format": "csv", "date_from": "2026-07-09", "date_to": "2026-07-31"})
        assert [x["Description"] for x in rows_of(r.text)] == ["Salary"]
        assert 'filename="transactions_20260709_to_20260731.csv"' in r.headers["content-disposition"]
        r = seeded.get(f"{BASE}/export/csv", params={"date_from": "2026-08-01"})
        assert [x["Description"] for x in rows_of(r.text)] == ["Late"]
        assert 'transactions_20260801_to_end.csv' in r.headers["content-disposition"]

    @pytest.mark.parametrize("fmt", ["xlsx", "excel"])
    def test_excel_matches_the_csv(self, seeded: TestClient, fmt):
        r = seeded.get(f"{BASE}/export", params={"format": fmt})
        assert r.status_code == 200 and "spreadsheetml" in r.headers["content-type"]
        ws = openpyxl.load_workbook(io.BytesIO(r.content)).active
        header, *body = [list(row) for row in ws.iter_rows(values_only=True)]
        assert header[:4] == ["Date", "Type", "Amount", "Currency"]
        assert sorted((b[0], b[2], b[3]) for b in body) == [
            ("2026-07-08", 88.0, "USD"), ("2026-07-09", 1000.0, "TWD"), ("2026-08-01", 5.0, "TWD")]

    def test_an_export_imports_back_unchanged(self, seeded: TestClient, user, override_get_async_session):
        exported = seeded.get(f"{BASE}/export/csv").text
        # Re-importing our own file is all duplicates: nothing new is created.
        r = seeded.post(f"{BASE}/upload-import", files={"file": ("again.csv", exported, "text/csv")})
        assert r.status_code == 200 and r.json()["imported"] == 0
        assert len(rows_of(seeded.get(f"{BASE}/export/csv").text)) == 3

    def test_empty_ledger_exports_only_the_header(self, client: TestClient):
        assert client.get(f"{BASE}/export/csv").text.strip().startswith("Date,Type,Amount")
        assert rows_of(client.get(f"{BASE}/export/csv").text) == []

    def test_pdf_is_not_implemented(self, client: TestClient):
        assert client.get(f"{BASE}/export", params={"format": "pdf"}).status_code == 501
        assert client.get(f"{BASE}/export", params={"format": "doc"}).status_code == 422


class TestImportEndpoints:
    @pytest.mark.parametrize("path", [f"{BASE}/upload-import", f"{BASE}/import/csv"])
    def test_only_csv_files_are_accepted(self, client: TestClient, path):
        r = client.post(path, files={"file": ("x.xlsx", b"PK", "application/octet-stream")})
        assert r.status_code == 400

    def test_legacy_endpoint_reports_the_batch(self, client: TestClient):
        r = client.post(f"{BASE}/import/csv", files={"file": ("seed.csv", SEED, "text/csv")})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total_records"] == 3 and body["successful"] == 3 and body["failed"] == 0

    def test_batches_list_and_status(self, client: TestClient):
        bad = "Date,Amount\nnot-a-date,5\n2026-07-01,12\n"
        client.post(f"{BASE}/upload-import", files={"file": ("bad.csv", bad, "text/csv")})

        batches = client.get(f"{BASE}/import/batches").json()["data"]["batches"]
        assert len(batches) == 1
        b = batches[0]
        assert (b["filename"], b["status"], b["total_records"], b["processed_records"]) == ("bad.csv", "completed", 2, 1)

        status_resp = client.get(f"{BASE}/import/batches/{b['id']}")
        assert status_resp.status_code == 200, status_resp.text
        assert client.get(f"{BASE}/import/batches/{uuid4()}").status_code == 404


class TestParseRow:
    svc = ImportExportService(db=None, transaction_service=None)

    def parse(self, row, **settings):
        return self.svc._parse_csv_row(row, settings)

    @pytest.mark.parametrize("raw", ["2026-03-04", "03/04/2026", "2026-03-04 10:11:12"])
    def test_date_formats(self, raw):
        assert self.parse({"Date": raw, "Amount": "1"})["transaction_date"] == date(2026, 3, 4)

    def test_day_first_dates_parse_when_month_first_cannot(self):
        assert self.parse({"date": "31/01/2026", "amount": "1"})["transaction_date"] == date(2026, 1, 31)

    def test_sign_decides_the_type_when_there_is_no_type_column(self):
        out = self.parse({"Date": "2026-01-01", "Amount": "-$1,234.50"})
        assert out["type"] == "expense" and out["amount"] == Decimal("1234.50")
        assert self.parse({"Date": "2026-01-01", "Amount": "20"})["type"] == "income"

    @pytest.mark.parametrize("raw,expected", [("Credit", "income"), ("deposit", "income"), ("debit", "expense")])
    def test_type_words(self, raw, expected):
        assert self.parse({"Date": "2026-01-01", "Amount": "5", "Type": raw})["type"] == expected

    def test_defaults_and_alternate_headers(self):
        out = self.parse({"transaction_date": "2026-01-01", "Amount": "5", "Memo": "m", "Payee": "p"},
                         default_currency="usd", default_category_id="cat-1")
        assert (out["description"], out["merchant_name"]) == ("m", "p")
        assert out["category_id"] == "cat-1" and out["category_name"] is None
        assert out["currency"] == "usd"
        assert self.parse({"Date": "2026-01-01", "Amount": "5"})["description"] == "Imported transaction"

    def test_custom_column_mappings_win(self):
        out = self.parse({"When": "2026-02-02", "Value": "7", "Date": "1999-01-01"},
                         column_mappings={"date": "When", "amount": "Value"})
        assert out["transaction_date"] == date(2026, 2, 2) and out["amount"] == Decimal("7")

    @pytest.mark.parametrize("row,message", [
        ({"Amount": "1"}, "Date field is required"),
        ({"Date": "yesterday", "Amount": "1"}, "Could not parse date"),
        ({"Date": "2026-01-01"}, "Amount field is required"),
        ({"Date": "2026-01-01", "Amount": "ten"}, "Could not parse amount"),
    ])
    def test_bad_rows_name_the_problem(self, row, message):
        with pytest.raises(ValueError, match=message):
            self.parse(row)
