"""Attachment upload, listing and deletion under /transactions, against a temp upload dir."""

from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.modules.users.models import User, UserRole, UserStatus

BASE = "/api/v1/transactions"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def make_user():
    return User(id=uuid4(), email=f"{uuid4().hex[:8]}@example.com", name="A", hashed_password="x",
                is_active=True, is_verified=True, status=UserStatus.ACTIVE, role=UserRole.USER, preferences={})


@pytest.fixture(autouse=True)
def upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "UPLOAD_PATH", str(tmp_path))
    return tmp_path


@pytest.fixture
def users():
    return {"me": make_user(), "other": make_user()}


@pytest.fixture
def as_user(users, override_get_async_session):
    """`as_user("me")` / `as_user("other")` switches who the client is."""
    from app.core.database import get_async_session, get_db
    from app.main import app as fastapi_app
    from app.modules.users.dependencies import get_current_active_user, get_optional_current_user

    fastapi_app.dependency_overrides[get_async_session] = override_get_async_session
    fastapi_app.dependency_overrides[get_db] = override_get_async_session
    client = TestClient(fastapi_app)

    def switch(name):
        u = users[name]
        fastapi_app.dependency_overrides[get_current_active_user] = lambda: u
        fastapi_app.dependency_overrides[get_optional_current_user] = lambda: u
        return client

    with client:
        yield switch
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture(autouse=True)
async def _shopping_category(async_session):
    """The seed CSV files its row under Shopping; categories are global and only
    admins add them, so the import resolves to an existing row."""
    from app.modules.transactions.models import TransactionCategory, TransactionType

    async_session.add(TransactionCategory(name="Shopping", name_en="Shopping", type=TransactionType.EXPENSE, icon="🛍️", color="#F9CA24"))
    await async_session.commit()


@pytest.fixture
def txn_id(as_user):
    c = as_user("me")
    csv = "Date,Type,Amount,Currency,Description,Category\n2026-07-08,expense,10,TWD,Receipt me,Shopping\n"
    assert c.post(f"{BASE}/upload-import", files={"file": ("s.csv", csv, "text/csv")}).json()["imported"] == 1
    return c.get(f"{BASE}/").json()["transactions"][0]["id"]


def upload(client, txn_id, name="r.png", body=PNG, mime="image/png"):
    return client.post(f"{BASE}/{txn_id}/attachments", files={"file": (name, body, mime)})


def test_upload_stores_the_file_and_lists_it(as_user, txn_id, upload_dir, users):
    c = as_user("me")
    r = upload(c, txn_id)
    assert r.status_code in (200, 201), r.text[:300]
    att = r.json()
    assert att["original_filename"] == "r.png" and att["mime_type"] == "image/png"
    stored = list((upload_dir / str(users["me"].id)).iterdir())
    assert len(stored) == 1 and stored[0].read_bytes() == PNG and stored[0].suffix == ".png"

    listed = c.get(f"{BASE}/{txn_id}/attachments")
    assert listed.status_code == 200 and [a["id"] for a in listed.json()] == [att["id"]]


def test_delete_removes_record_and_file(as_user, txn_id, upload_dir, users):
    c = as_user("me")
    att = upload(c, txn_id).json()
    assert c.delete(f"{BASE}/attachments/{att['id']}").status_code == 204
    assert list((upload_dir / str(users["me"].id)).iterdir()) == []
    assert c.get(f"{BASE}/{txn_id}/attachments").json() == []
    assert c.delete(f"{BASE}/attachments/{att['id']}").status_code == 404


def test_another_user_can_neither_see_nor_delete(as_user, txn_id):
    att = upload(as_user("me"), txn_id).json()
    other = as_user("other")
    assert upload(other, txn_id).status_code == 404
    assert other.get(f"{BASE}/{txn_id}/attachments").status_code == 404
    assert other.delete(f"{BASE}/attachments/{att['id']}").status_code == 404
    assert len(as_user("me").get(f"{BASE}/{txn_id}/attachments").json()) == 1


def test_unknown_transaction_is_404(as_user):
    assert upload(as_user("me"), str(uuid4())).status_code == 404


def test_disallowed_type_is_400(as_user, txn_id):
    assert upload(as_user("me"), txn_id, name="x.exe", mime="application/x-msdownload").status_code == 400


def test_oversized_file_is_413(as_user, txn_id, monkeypatch):
    monkeypatch.setattr(type(get_settings()), "max_file_size_bytes", property(lambda self: 10))
    assert upload(as_user("me"), txn_id).status_code == 413


def test_stored_name_ignores_the_uploaded_path(as_user, txn_id, upload_dir, users):
    r = upload(as_user("me"), txn_id, name="../../escape.png")
    assert r.status_code in (200, 201), r.text[:200]
    files = [p for p in Path(upload_dir).rglob("*") if p.is_file()]
    assert len(files) == 1 and files[0].parent == upload_dir / str(users["me"].id)
