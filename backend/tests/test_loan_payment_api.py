"""
The /loans/{id}/payment path keeps balance == principal - Σ principal_portion.

test_loan_balance_invariant.py covers the expense-link path (a transaction
whose loan_id is set from the transactions page). This is the other door: the
loan page records, edits and deletes payments directly, and flips the loan
between active and paid_off as the balance crosses zero.
"""

from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio

pytestmark = pytest.mark.database
BASE = "/api/v1/loans"


def _create_loan(client, principal="1000"):
    r = client.post(f"{BASE}/", json={
        "name": "Car loan", "account_type": "personal_loan", "principal_amount": principal,
        "interest_rate": "2.5", "minimum_payment": "100", "payment_due_day": 15,
        "start_date": "2026-01-01",
    })
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _pay(client, loan_id, principal, interest="10", date="2026-02-15"):
    total = str(Decimal(principal) + Decimal(interest))
    return client.post(f"{BASE}/{loan_id}/payment", json={
        "payment_date": date, "total_amount": total,
        "principal_portion": principal, "interest_portion": interest,
    })


def _loan(client, loan_id):
    r = client.get(f"{BASE}/{loan_id}")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _payments(client, loan_id):
    r = client.get(f"{BASE}/{loan_id}/payments")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _assert_invariant(client, loan_id):
    loan = _loan(client, loan_id)
    paid = sum(Decimal(str(p["principal_portion"])) for p in _payments(client, loan_id))
    assert Decimal(str(loan["current_balance"])) == Decimal(str(loan["principal_amount"])) - paid
    return loan


def test_payment_lifecycle_keeps_the_balance_invariant(authenticated_client):
    client = authenticated_client
    loan_id = _create_loan(client)

    assert _pay(client, loan_id, "400").status_code == 201
    loan = _assert_invariant(client, loan_id)
    assert Decimal(str(loan["current_balance"])) == Decimal("600")
    assert loan["status"] == "active"

    # More principal than is owed is refused and changes nothing.
    r = _pay(client, loan_id, "700")
    assert r.status_code == 400
    assert Decimal(str(_assert_invariant(client, loan_id)["current_balance"])) == Decimal("600")

    # Paying exactly the balance closes the loan.
    assert _pay(client, loan_id, "600", date="2026-03-15").status_code == 201
    loan = _assert_invariant(client, loan_id)
    assert Decimal(str(loan["current_balance"])) == Decimal("0")
    assert loan["status"] == "paid_off"

    # A paid-off loan takes no more payments.
    assert _pay(client, loan_id, "1", date="2026-04-15").status_code == 400
    assert len(_payments(client, loan_id)) == 2

    # Editing the closing payment down reopens the loan.
    closing = next(p for p in _payments(client, loan_id) if Decimal(str(p["principal_portion"])) == 600)
    r = client.put(f"{BASE}/{loan_id}/payments/{closing['transaction_id']}", json={
        "total_amount": "510", "principal_portion": "500", "interest_portion": "10",
    })
    assert r.status_code == 200, r.text
    loan = _assert_invariant(client, loan_id)
    assert Decimal(str(loan["current_balance"])) == Decimal("100")
    assert loan["status"] == "active"

    # Deleting a payment restores its principal.
    first = next(p for p in _payments(client, loan_id) if Decimal(str(p["principal_portion"])) == 400)
    assert client.delete(f"{BASE}/{loan_id}/payments/{first['transaction_id']}").status_code == 204
    loan = _assert_invariant(client, loan_id)
    assert Decimal(str(loan["current_balance"])) == Decimal("500")


def test_editing_a_payment_above_the_principal_is_refused(authenticated_client):
    client = authenticated_client
    loan_id = _create_loan(client, principal="1000")
    _pay(client, loan_id, "300")
    payment = _payments(client, loan_id)[0]

    r = client.put(f"{BASE}/{loan_id}/payments/{payment['transaction_id']}", json={
        "total_amount": "1510", "principal_portion": "1500", "interest_portion": "10",
    })
    assert r.status_code == 400
    loan = _assert_invariant(client, loan_id)
    assert Decimal(str(loan["current_balance"])) == Decimal("700")


def test_unknown_payment_is_404(authenticated_client):
    client = authenticated_client
    loan_id = _create_loan(client)
    assert client.delete(f"{BASE}/{loan_id}/payments/{uuid4()}").status_code == 404


def test_list_and_summary(authenticated_client):
    client = authenticated_client

    empty = client.get(f"{BASE}/summary")
    assert empty.status_code == 200, empty.text
    assert empty.json()["data"]["loan_count"] == 0
    assert Decimal(str(empty.json()["data"]["total_debt"])) == 0
    assert client.get(f"{BASE}/").json()["data"] == []

    a = _create_loan(client, principal="1000")
    _create_loan(client, principal="2500")
    _pay(client, a, "200")

    loans = client.get(f"{BASE}/").json()["data"]
    assert len(loans) == 2
    summary = client.get(f"{BASE}/summary").json()["data"]
    assert summary["loan_count"] == 2
    assert Decimal(str(summary["total_debt"])) == Decimal("3300")


@pytest_asyncio.fixture
async def other_user(async_session):
    from app.modules.users.models import User, UserRole, UserStatus

    user = User(id=uuid4(), email="other@example.com", name="Other", hashed_password="x",
                is_active=True, is_verified=True, role=UserRole.USER, status=UserStatus.ACTIVE)
    async_session.add(user)
    await async_session.commit()
    return user


def test_another_users_loan_is_not_found(authenticated_client, other_user):
    """Loans are scoped to their owner: another user's loan reads as missing and
    can't be paid against."""
    from app.modules.users.security import jwt_manager

    client = authenticated_client
    loan_id = _create_loan(client)
    own = client.headers["Authorization"]
    client.headers["Authorization"] = "Bearer " + jwt_manager.create_access_token(
        {"sub": str(other_user.id), "email": other_user.email})
    try:
        assert client.get(f"{BASE}/{loan_id}").status_code == 404
        # record_payment reports a loan it can't find as a 400 ("Loan not found").
        assert _pay(client, loan_id, "100").status_code == 400
        assert client.get(f"{BASE}/").json()["data"] == []
    finally:
        client.headers["Authorization"] = own
    assert _payments(client, loan_id) == []
    assert Decimal(str(_loan(client, loan_id)["current_balance"])) == Decimal("1000")
