"""
Integration coverage for POST /transactions/upload-import.

Before this fix the endpoint failed 100% of the time: _parse_csv_row built
transaction_type as 'EXPENSE'/'INCOME' (the Python enum member names) while
TransactionCreate validates against the enum *values* ('expense'/'income'),
so every row was rejected. Fixing that surfaced two more bugs further down
the same path: the CSV's own Category column was never read (every row then
failed "Unable to determine transaction category"), and the error-recording
path in bulk_create_transactions stored a raw model_dump() containing
Decimal/date objects into a JSON column, crashing the whole batch instead of
recording a per-row error. See test_transfer_edit.py for the auth fixture
pattern this mirrors.
"""
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from app.modules.users.models import User, UserRole, UserStatus


@pytest_asyncio.fixture(autouse=True)
async def _shopping_categories(async_session):
    """Categories are global and only admins add them, so an import resolves names
    to existing rows. The CSVs here use 'Shopping', which a real instance has."""
    from app.modules.transactions.models import TransactionCategory, TransactionType

    for t in (TransactionType.EXPENSE, TransactionType.INCOME):
        async_session.add(TransactionCategory(name="Shopping", name_en="Shopping", type=t, icon="🛍️", color="#F9CA24"))
    async_session.add(TransactionCategory(name="Salary", name_en="Salary", type=TransactionType.INCOME, icon="💰", color="#2ECC71"))
    await async_session.commit()


@pytest.fixture
def mock_current_user():
    return User(
        id=uuid4(),
        email="csv-import-test@example.com",
        name="CSV Import Test User",
        hashed_password="$2b$12$fakehash",
        is_active=True,
        is_verified=True,
        status=UserStatus.ACTIVE,
        role=UserRole.USER,
        preferences={},
    )


@pytest.fixture
def client(mock_current_user, override_get_async_session):
    from app.main import app as fastapi_app
    from app.modules.users.dependencies import (
        get_current_active_user,
        get_optional_current_user,
    )
    from app.core.database import get_async_session, get_db

    fastapi_app.dependency_overrides[get_current_active_user] = lambda: mock_current_user
    fastapi_app.dependency_overrides[get_optional_current_user] = lambda: mock_current_user
    fastapi_app.dependency_overrides[get_async_session] = override_get_async_session
    fastapi_app.dependency_overrides[get_db] = override_get_async_session
    with TestClient(fastapi_app) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


CSV_WITH_CURRENCY_AND_CATEGORY = (
    "Date,Type,Amount,Currency,Description,Category,Merchant,Payment Method,Tags,Notes\n"
    "2026-07-08,expense,88.00,USD,Roundtrip check,Shopping,,,,\n"
)


class TestCsvImportRoundtrip:
    def test_row_with_currency_and_category_columns_imports_cleanly(self, client: TestClient):
        response = client.post(
            "/api/v1/transactions/upload-import",
            files={"file": ("export.csv", CSV_WITH_CURRENCY_AND_CATEGORY, "text/csv")},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["imported"] == 1
        assert body["failed"] == 0
        assert body["errors"] == []

        list_resp = client.get("/api/v1/transactions/")
        rows = list_resp.json()["transactions"]
        assert len(rows) == 1
        assert rows[0]["currency"] == "USD"
        assert float(rows[0]["amount"]) == 88.0
        assert rows[0]["type"] == "expense"
        assert rows[0]["category_obj"]["name"] == "Shopping"

    def test_the_subcategory_column_survives_export_then_import(self, client: TestClient):
        """The app's own export carries the detail (Beauty under Shopping), and reads it back."""
        csv_text = (
            "Date,Type,Amount,Currency,Description,Category,Subcategory,Merchant,Payment Method,Tags,Notes\n"
            "2026-07-09,expense,1200.00,TWD,Nails,Shopping,Beauty,,,,\n"
        )
        response = client.post(
            "/api/v1/transactions/upload-import",
            files={"file": ("export.csv", csv_text, "text/csv")},
        )
        assert response.status_code == 200, response.text
        assert response.json()["imported"] == 1
        row = client.get("/api/v1/transactions/").json()["transactions"][0]
        assert (row["category_obj"]["name"], row["subcategory"]) == ("Shopping", "Beauty")

        exported = client.get("/api/v1/transactions/export?format=csv")
        assert exported.status_code == 200, exported.text[:200]
        import csv as _csv, io as _io
        out = list(_csv.DictReader(_io.StringIO(exported.text)))
        assert (out[0]["Category"], out[0]["Subcategory"]) == ("Shopping", "Beauty")

    def test_a_subcategory_that_is_not_the_categorys_detail_is_dropped_not_saved(self, client: TestClient):
        """A hand-edited file: another category's detail, one on a category that
        resolves to Others, a made-up one, one too long for the column. Each row
        imports under its category, without the detail."""
        csv_text = (
            "Date,Type,Amount,Currency,Description,Category,Subcategory\n"
            "2026-07-09,expense,100.00,TWD,Bus,Shopping,Parking\n"
            "2026-07-10,expense,150.00,TWD,Lunch,Dining,Beauty\n"
            "2026-07-11,expense,200.00,TWD,Thing,Shopping,Gadgets\n"
            f"2026-07-12,expense,300.00,TWD,Long,Shopping,{'x' * 150}\n"
            "2026-07-13,expense,400.00,TWD,Lipstick,shopping,beauty\n"
        )
        response = client.post(
            "/api/v1/transactions/upload-import",
            files={"file": ("edited.csv", csv_text, "text/csv")},
        )
        assert response.status_code == 200, response.text
        assert response.json()["imported"] == 5
        rows = {r["description"]: r for r in client.get("/api/v1/transactions/").json()["transactions"]}
        assert [rows[d]["subcategory"] for d in ("Bus", "Lunch", "Thing", "Long")] == [None] * 4
        assert rows["Lunch"]["category_obj"]["name"] == "Others"  # no Dining here: the fallback
        assert rows["Lipstick"]["subcategory"] == "Beauty"  # case-insensitive, stored as spelled

    def test_the_api_drops_another_categorys_detail_and_keeps_free_text(self, client: TestClient):
        for sub in ("Parking", "Gadgets"):
            r = client.post("/api/v1/transactions/", json={
                "type": "expense", "amount": 10, "currency": "TWD", "description": f"api {sub}",
                "transaction_date": "2026-07-09", "category_name": "Shopping", "subcategory": sub,
            })
            assert r.status_code in (200, 201), r.text
        rows = {r["description"]: r for r in client.get("/api/v1/transactions/").json()["transactions"]}
        assert rows["api Parking"]["subcategory"] is None
        assert rows["api Gadgets"]["subcategory"] == "Gadgets"

    def test_reimporting_the_same_file_skips_the_duplicate(self, client: TestClient):
        client.post(
            "/api/v1/transactions/upload-import",
            files={"file": ("export.csv", CSV_WITH_CURRENCY_AND_CATEGORY, "text/csv")},
        )
        response = client.post(
            "/api/v1/transactions/upload-import",
            files={"file": ("export.csv", CSV_WITH_CURRENCY_AND_CATEGORY, "text/csv")},
        )
        assert response.status_code == 200, response.text
        assert response.json()["imported"] == 0

        list_resp = client.get("/api/v1/transactions/")
        assert len(list_resp.json()["transactions"]) == 1

    def test_row_without_currency_column_falls_back_to_twd(self, client: TestClient):
        csv_no_currency = (
            "Date,Type,Amount,Description,Category\n"
            "2026-07-08,income,500,No currency column,Salary\n"
        )
        response = client.post(
            "/api/v1/transactions/upload-import",
            files={"file": ("no_currency.csv", csv_no_currency, "text/csv")},
        )
        assert response.status_code == 200, response.text
        assert response.json()["imported"] == 1

        rows = client.get("/api/v1/transactions/").json()["transactions"]
        assert rows[0]["currency"] == "TWD"

    def test_row_with_no_resolvable_category_reports_a_soft_error_not_a_500(self, client: TestClient):
        csv_no_category = "Date,Type,Amount,Description\n2026-07-08,expense,10,No category at all\n"
        response = client.post(
            "/api/v1/transactions/upload-import",
            files={"file": ("no_category.csv", csv_no_category, "text/csv")},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["imported"] == 0
        assert body["failed"] == 1
        assert "category" in body["errors"][0]["error"].lower()
