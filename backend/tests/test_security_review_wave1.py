"""
Holes closed from the 2026-11-01 security review (S1-S3, S6-S9 of
docs/reviews/2026-11-01-architecture-review.md). Each test drives the surface
an attacker would: the HTTP route, the log a reset request writes, the image a
receipt scan opens.
"""

import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.modules.admin.models import AdminUser
from app.modules.users.models import EmailVerificationToken, UserStatus
from app.modules.users.security import jwt_manager

pytestmark = pytest.mark.asyncio

LOGIN = "/api/v1/auth/login"
# conftest's test_user is stored with the bcrypt hash of "secret".
RIGHT_PASSWORD = "secret"
WRONG_PASSWORD = "not-the-password"
GENERIC_401 = (401, "Invalid email or password")


def _message(response) -> str:
    body = response.json()
    return body.get("detail") or body.get("error", {}).get("message", "")


def _login(client, email, password):
    response = client.post(LOGIN, json={"email": email, "password": password})
    return response.status_code, _message(response)


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.records: list[logging.LogRecord] = []

    def emit(self, record):
        self.records.append(record)

    @property
    def messages(self) -> list[str]:
        return [r.getMessage() for r in self.records]


@pytest.fixture
def app_log():
    """Every message the app's loggers write (the "app" logger does not propagate)."""
    capture = _Capture()
    app_logger = logging.getLogger("app")
    previous = app_logger.level
    app_logger.addHandler(capture)
    app_logger.setLevel(logging.DEBUG)
    yield capture
    app_logger.removeHandler(capture)
    app_logger.setLevel(previous)


async def _lock(async_session, user):
    user.failed_login_attempts = 5
    user.account_locked_until = datetime.now(timezone.utc) + timedelta(hours=1)
    await async_session.commit()


# ── S1: a failed-login lock does not revoke issued tokens ───────────────────


async def test_failed_logins_lock_sign_in_but_not_the_owners_live_session(client, test_user, async_session):
    token = jwt_manager.create_access_token({"sub": str(test_user.id), "email": test_user.email})
    for _ in range(5):
        assert _login(client, test_user.email, WRONG_PASSWORD)[0] == 401
    await async_session.refresh(test_user)
    assert test_user.account_locked_until is not None, "five failures should lock the account"

    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    assert client.get("/api/v1/transactions/", headers=headers).status_code == 200

    assert _login(client, test_user.email, RIGHT_PASSWORD) == GENERIC_401


async def test_failed_logins_do_not_silence_the_owners_line_bot(async_session, test_user):
    from app.modules.line_bot import service as line_service
    from app.modules.line_bot.models import LineUserLink

    async_session.add(LineUserLink(line_user_id="Ulocked", user_id=test_user.id, display_name="t"))
    await _lock(async_session, test_user)

    assert await line_service._get_link(async_session, "Ulocked") is not None


# ── S3: login answers every refusal the same way until the password is right ──


@pytest.mark.parametrize("state", ["unknown", "active", "locked", "pending", "suspended", "deactivated"])
async def test_a_wrong_password_gets_one_generic_401_in_every_account_state(client, test_user, async_session, state):
    email = test_user.email
    if state == "unknown":
        email = "nobody@example.com"
    elif state == "locked":
        await _lock(async_session, test_user)
    elif state == "pending":
        test_user.status = UserStatus.PENDING_APPROVAL
        test_user.is_active = False
    elif state == "suspended":
        test_user.status = UserStatus.SUSPENDED
    elif state == "deactivated":
        test_user.is_active = False
    await async_session.commit()

    assert _login(client, email, WRONG_PASSWORD) == GENERIC_401


@pytest.mark.parametrize(
    "status_, active",
    [(UserStatus.PENDING_APPROVAL, False), (UserStatus.SUSPENDED, True), (UserStatus.ACTIVE, False)],
)
async def test_wrong_passwords_on_an_account_that_cannot_sign_in_leave_no_lock(
    client, test_user, async_session, status_, active
):
    """Otherwise five guesses on a pending account greet its owner with a lock on approval."""
    test_user.status = status_
    test_user.is_active = active
    await async_session.commit()

    for _ in range(5):
        assert _login(client, test_user.email, WRONG_PASSWORD) == GENERIC_401
    await async_session.refresh(test_user)
    assert test_user.failed_login_attempts == 0
    assert test_user.account_locked_until is None


async def test_a_locked_account_answers_the_right_password_like_a_wrong_one(client, test_user, async_session):
    """Otherwise guessing through the lock still works: a 423 marks the right password."""
    await _lock(async_session, test_user)
    assert _login(client, test_user.email, RIGHT_PASSWORD) == _login(client, test_user.email, WRONG_PASSWORD)


@pytest.mark.parametrize(
    "status_, active, needle",
    [(UserStatus.PENDING_APPROVAL, False, "pending"), (UserStatus.SUSPENDED, True, "suspended")],
)
async def test_the_right_password_still_learns_why_the_account_is_blocked(
    client, test_user, async_session, status_, active, needle
):
    test_user.status = status_
    test_user.is_active = active
    await async_session.commit()

    code, message = _login(client, test_user.email, RIGHT_PASSWORD)
    assert code == 403 and needle in message.lower()


async def test_an_unknown_email_costs_a_password_check(client, test_user):
    """Skipping bcrypt for a missing account makes response time an account oracle."""

    def fastest(email):
        best = float("inf")
        for _ in range(3):
            started = time.perf_counter()
            client.post(LOGIN, json={"email": email, "password": WRONG_PASSWORD})
            best = min(best, time.perf_counter() - started)
        return best

    known = fastest(test_user.email)
    unknown = fastest("nobody@example.com")
    assert unknown > known * 0.5, f"unknown email {unknown*1000:.0f}ms vs known {known*1000:.0f}ms"


# ── S2: no reset token or mail body in the log ───────────────────────────────


async def test_a_password_reset_request_logs_no_token_or_mailbox(client, test_user, async_session, app_log, monkeypatch):
    from app.modules.users.security import security_utils

    token = "reset-token-0123456789abcdef"
    monkeypatch.setattr(security_utils, "generate_secure_token", lambda length=32: token)

    response = client.post("/api/v1/auth/password/reset-request", json={"email": test_user.email})
    assert response.status_code == 200

    stored = (
        await async_session.execute(select(EmailVerificationToken).where(EmailVerificationToken.user_id == test_user.id))
    ).scalar_one_or_none()
    assert stored is not None, "the reset should have been issued"
    mail_lines = [m for m in app_log.messages if "Subject" in m or "subject" in m]
    assert mail_lines, "the email service should still record that a mail went out"
    assert not [m for m in app_log.messages if token in m or "token=" in m]
    assert all(test_user.email not in m and "example.com" in m for m in mail_lines)


# ── S6: exchange-rate routes ─────────────────────────────────────────────────


class _NoRates:
    async def get_exchange_rate(self, *args, **kwargs):
        return None

    async def _fetch_rates(self, base):
        return {"TWD": 31.5}


@pytest.fixture
def fake_fx(monkeypatch):
    from app.utils import exchange_rate_service as ers

    monkeypatch.setattr(ers, "get_exchange_rate_service", lambda *a, **kw: _NoRates())


async def _grant_admin(async_session, user):
    async_session.add(AdminUser(id=uuid.uuid4(), user_id=user.id, role="admin", is_active=True, is_suspended=False))
    await async_session.commit()


async def test_rates_refuse_a_base_currency_the_app_does_not_support(authenticated_client, test_user, async_session, fake_fx):
    assert authenticated_client.get("/api/v1/portfolio/exchange-rates?base_currency=ZZZ").status_code == 422
    assert authenticated_client.get("/api/v1/portfolio/exchange-rates?base_currency=TWD").status_code == 200

    await _grant_admin(async_session, test_user)
    assert authenticated_client.post("/api/v1/portfolio/exchange-rates/refresh?base_currency=ZZZ").status_code == 422


async def test_only_an_admin_can_rewrite_the_shared_rates(authenticated_client, test_user, async_session, fake_fx, monkeypatch):
    from app.modules.portfolio.repositories import CurrencyRepository

    async def fake_upsert(self, rate_data):
        return SimpleNamespace(rate=rate_data["rate"])

    monkeypatch.setattr(CurrencyRepository, "create_or_update_rate", fake_upsert)

    assert authenticated_client.post("/api/v1/portfolio/exchange-rates/refresh").status_code == 403
    await _grant_admin(async_session, test_user)
    assert authenticated_client.post("/api/v1/portfolio/exchange-rates/refresh").status_code == 200


async def test_a_failed_rate_fetch_does_not_log_the_api_key(monkeypatch, app_log):
    from app.utils import exchange_rate_service as ers

    real_client = httpx.AsyncClient

    def refusing_client(*args, **kwargs):
        return real_client(transport=httpx.MockTransport(lambda request: httpx.Response(403, request=request)), **kwargs)

    monkeypatch.setattr(ers.httpx, "AsyncClient", refusing_client)
    service = ers.ExchangeRateService()
    service.api_key = "KEY-0123456789abcdef"

    assert await service._fetch_rates("USD") is None
    assert app_log.messages, "the failure should still be logged"
    assert not [m for m in app_log.messages if service.api_key in m]


async def test_a_rate_fetch_timeout_is_a_warning_without_the_api_key(monkeypatch, app_log):
    """A slow upstream is routine: an ERROR here pages someone for nothing."""
    from app.utils import exchange_rate_service as ers

    real_client = httpx.AsyncClient

    def timing_out(request):
        raise httpx.ConnectTimeout("timed out", request=request)

    monkeypatch.setattr(
        ers.httpx, "AsyncClient", lambda *a, **kw: real_client(transport=httpx.MockTransport(timing_out), **kw)
    )
    service = ers.ExchangeRateService()
    service.api_key = "KEY-0123456789abcdef"

    assert await service._fetch_rates("USD") is None
    fx_records = [r for r in app_log.records if r.name == ers.logger.name]
    assert fx_records, "the timeout should still be logged"
    assert max(r.levelno for r in fx_records) == logging.WARNING
    assert not [r for r in fx_records if service.api_key in r.getMessage()]


async def test_a_currency_pair_outside_the_supported_set_is_refused(client, fake_fx):
    """The pair route is public: an arbitrary code is a paid API call and a cache key."""
    assert client.get("/api/v1/portfolio/exchange-rates/ZZZ/TWD").status_code == 422
    assert client.get("/api/v1/portfolio/exchange-rates/USD/ZZZ").status_code == 422
    assert client.get("/api/v1/portfolio/exchange-rates/USD/TWD").status_code == 404


# ── S7: the 429 does not hand out CORS credentials ───────────────────────────


@pytest.fixture
def limited_client(monkeypatch):
    """The app as production builds it: rate limiting on (the suite turns it off)."""
    import app.middleware.rate_limit as rl
    from app.main import create_app

    monkeypatch.setattr(rl.settings, "RATE_LIMIT_ENABLED", True)
    rl._window_buckets.clear()
    rl._burst_buckets.clear()
    yield TestClient(create_app())
    rl._window_buckets.clear()
    rl._burst_buckets.clear()


def _first_429(client, origin):
    for _ in range(30):
        response = client.post(LOGIN, json={}, headers={"Origin": origin})
        if response.status_code == 429:
            return response
    raise AssertionError("login was never rate limited")


async def test_a_429_gives_a_foreign_origin_no_cors_grant(limited_client):
    response = _first_429(limited_client, "https://attacker.example")
    # Allow-Origin is the grant. Starlette adds Allow-Credentials to every
    # response; without Allow-Origin the browser still withholds the body.
    assert "access-control-allow-origin" not in response.headers


async def test_a_429_stays_readable_by_the_apps_own_origin(limited_client):
    response = _first_429(limited_client, "http://localhost:3000")
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


async def test_a_preflight_carries_the_request_id_and_security_headers(limited_client):
    response = limited_client.options(
        LOGIN,
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert response.headers.get("x-request-id")
    assert response.headers.get("x-content-type-options") == "nosniff"


# ── S8: receipt OCR refuses decompression bombs ──────────────────────────────


async def test_a_receipt_too_large_to_decode_is_refused_before_ocr(authenticated_client, tmp_path, monkeypatch):
    import io

    from PIL import Image
    import pytesseract

    from app.core.config import get_settings

    ocr = MagicMock(return_value="")
    monkeypatch.setattr(pytesseract, "image_to_string", ocr)
    monkeypatch.setattr(get_settings(), "UPLOAD_PATH", str(tmp_path))
    # 8000 x 6000 = 48M pixels: a ~60 KB PNG, under Pillow's own 89M warning line.
    bomb = io.BytesIO()
    Image.new("1", (8000, 6000)).save(bomb, format="PNG")

    response = authenticated_client.post(
        "/api/v1/transactions/scan-receipt", files={"file": ("bomb.png", bomb.getvalue(), "image/png")}
    )

    assert response.status_code == 413
    assert "too large" in _message(response).lower()
    ocr.assert_not_called()


# ── S9: /auth/health reveals no configuration ────────────────────────────────


async def test_auth_health_reports_status_only(client):
    data = client.get("/api/v1/auth/health").json()["data"]
    assert set(data) == {"service", "status"}
