"""
Bounds on work and state that a caller could previously grow without limit.

Each test sets the relevant limit small (or reads the real one) and checks the
request is refused or the state stays bounded, using ordinary inputs.
"""

import io
from unittest.mock import patch

import openpyxl
import pytest
from fastapi.routing import APIRoute

pytestmark = pytest.mark.asyncio


# ── request bodies ──────────────────────────────────────────────────────────

async def test_oversized_auth_body_is_refused_before_it_is_read(client):
    from app.middleware.pure_asgi import BodySizeLimitMiddleware

    big = b'{"email":"a@b.c","password":"' + b"x" * (BodySizeLimitMiddleware.SMALL_LIMIT + 1) + b'"}'
    r = client.post("/api/v1/auth/login", content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413


async def test_streamed_body_without_length_is_cut_off_at_the_limit():
    from app.middleware.pure_asgi import BodySizeLimitMiddleware

    consumed = []

    async def app(scope, receive, send):
        while True:
            message = await receive()
            consumed.append(len(message.get("body", b"")))
            if not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    chunk = b"x" * 16 * 1024
    chunks = iter([{"type": "http.request", "body": chunk, "more_body": True}] * 10)

    async def receive():
        return next(chunks)

    sent = []

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "path": "/api/v1/auth/login", "headers": []}
    await BodySizeLimitMiddleware(app)(scope, receive, send)
    assert sent[0]["status"] == 413
    assert sum(consumed) <= BodySizeLimitMiddleware.SMALL_LIMIT


async def test_streamed_body_through_fastapi_gets_413_not_400():
    # FastAPI turns a failed body read into its own 400; the middleware must
    # still report the real reason.
    import httpx
    from fastapi import FastAPI
    from pydantic import BaseModel

    from app.middleware.pure_asgi import BodySizeLimitMiddleware

    class Body(BaseModel):
        password: str

    inner = FastAPI()

    @inner.post("/api/v1/auth/login")
    async def login(body: Body):
        return {"ok": True}

    async def stream():
        for _ in range(10):
            yield b"x" * 16 * 1024

    transport = httpx.ASGITransport(app=BodySizeLimitMiddleware(inner))
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        r = await c.post("/api/v1/auth/login", content=stream(), headers={"Content-Type": "application/json"})
    assert r.status_code == 413


async def test_validation_errors_do_not_echo_the_input(client):
    r = client.post("/api/v1/auth/login", json={"unexpected": "secret-value"})
    assert r.status_code == 422
    assert "secret-value" not in r.text


# ── upload parsers ──────────────────────────────────────────────────────────

async def test_pdf_page_is_rendered_within_the_pixel_budget(tmp_path):
    pytest.importorskip("pdf2image")  # in requirements.txt; absent from some host venvs
    from app.modules.transactions import attachment_service as svc

    pdf = tmp_path / "r.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    big_page = {"Page size": "1440 x 1440 pts"}
    with patch("pdf2image.pdfinfo_from_path", return_value=big_page), \
         patch("pdf2image.convert_from_path", return_value=[]) as convert:
        svc.AttachmentService.__new__(svc.AttachmentService)._ocr_pdf(pdf)
    dpi = convert.call_args.kwargs["dpi"]
    assert (1440 / 72 * dpi) ** 2 <= svc.MAX_PDF_PIXELS
    assert convert.call_args.kwargs["timeout"]

    with patch("pdf2image.pdfinfo_from_path", return_value={"Page size": "40000 x 40000 pts"}), \
         patch("pdf2image.convert_from_path") as convert:
        assert svc.AttachmentService.__new__(svc.AttachmentService)._ocr_pdf(pdf) == ""
    convert.assert_not_called()


async def test_xlsx_preview_refuses_sheets_wider_than_the_limit():
    from app.modules.portfolio import services

    wb = openpyxl.Workbook()
    wb.active.append(["StockID", "Name", "Qty", "Cost"])
    buf = io.BytesIO()
    wb.save(buf)
    with patch.object(services, "MAX_IMPORT_COLS", 3):
        result = await services.parse_import_file(buf.getvalue(), "p.xlsx")
    assert result["holdings"] == [] and "too large" in result["errors"][0]


async def test_csv_import_caps_rows_and_keeps_errors_small(authenticated_client):
    from app.modules.transactions import attachment_service as svc

    base = "/api/v1/transactions/upload-import"
    rows = "Date,Amount\n" + "not-a-date,1\n" * 6
    with patch.object(svc, "MAX_IMPORT_ROWS", 5):
        assert authenticated_client.post(base, files={"file": ("a.csv", rows, "text/csv")}).status_code == 413

    with patch.object(svc, "MAX_IMPORT_ERRORS", 2):
        body = authenticated_client.post(base, files={"file": ("a.csv", rows, "text/csv")}).json()
    batch = authenticated_client.get("/api/v1/transactions/import/batches").json()["data"]["batches"][0]
    assert batch["total_records"] == 6
    assert len(body["errors"]) <= 2
    assert all("data" not in e for e in body["errors"])


async def test_anonymous_demo_store_is_bounded():
    from app.modules.transactions import demo_service

    service = demo_service.DemoTransactionService()
    seeds = len(service.demo_transactions)
    from app.modules.transactions.schemas import TransactionCreate
    with patch.object(demo_service, "MAX_DEMO_WRITES", 3):
        for i in range(10):
            await service.create_transaction(TransactionCreate(
                type="expense", amount="1", currency="TWD", description=f"d{i}", transaction_date="2026-10-01"))
    assert len(service.demo_transactions) == seeds + 3
    assert service.demo_transactions[0]["description"] == "d9"


# ── rate limiting ───────────────────────────────────────────────────────────

async def test_auth_rate_limit_cannot_be_tuned_from_the_query_string():
    # Read the routers themselves: FastAPI 0.143 lists an included router in
    # app.routes as one lazy entry, which would make this loop check nothing.
    from app.modules.auth.router import router as auth_router
    from app.modules.users.router_simple import router as users_router
    from app.modules.users.dependencies import rate_limit_check

    guarded = [
        route for router in (auth_router, users_router) for route in router.routes
        if isinstance(route, APIRoute) and any(d.call is rate_limit_check for d in route.dependant.dependencies)
    ]
    assert len(guarded) >= 5
    for route in guarded:
        names = {p.name for d in route.dependant.dependencies for p in d.query_params}
        assert not names & {"limit", "window"}, route.path


async def test_registration_has_its_own_strict_middleware_rule():
    from app.middleware.rate_limit import RateLimitMiddleware

    rules = RateLimitMiddleware(app=None).rate_limits
    assert rules["/api/v1/users/register"]["requests"] <= 10
    assert "/api/v1/auth/register" not in rules


async def test_idle_rate_limit_buckets_are_swept():
    from app.middleware import rate_limit as rl

    rl._window_buckets.clear()
    rl._burst_buckets.clear()
    for i in range(50):
        rl._window_buckets[f"ip:x:/nope/{i}:GET:window"].append(0.0)
    rl._sweep(now=10_000.0)
    assert len(rl._window_buckets) == 0


async def test_forwarded_headers_are_ignored_by_default():
    from app.core.config import Settings

    assert Settings.model_fields["TRUSTED_PROXY_COUNT"].default == 0


# ── exchange rates ──────────────────────────────────────────────────────────

async def test_exchange_rate_route_only_accepts_currency_codes(client):
    assert client.get("/api/v1/portfolio/exchange-rates/NOTACODE/TWD").status_code == 422


async def test_fx_lock_registry_does_not_keep_finished_pairs():
    from app.utils import exchange_rate_service as ers

    ers._inflight_locks.clear()
    async with ers._inflight("AAA_BBB"):
        assert "AAA_BBB" in ers._inflight_locks
    assert "AAA_BBB" not in ers._inflight_locks


# ── usernames and holdings ──────────────────────────────────────────────────

async def test_username_case_variant_of_an_existing_handle_is_taken(authenticated_client, async_session):
    from app.modules.users.models import User, UserStatus
    import uuid

    async_session.add(User(id=uuid.uuid4(), email="alice@example.com", name="A", username="Alice",
                           hashed_password="x", is_active=True, status=UserStatus.ACTIVE))
    await async_session.commit()
    assert authenticated_client.put("/api/v1/users/me", json={"username": "alice"}).status_code == 409


async def test_holding_count_per_user_is_capped(authenticated_client):
    from app.modules.portfolio.routers import holdings

    body = {"symbol": "0050", "name": "0050", "type": "etf", "exchange": "TWSE", "market": "TW",
            "currency": "TWD", "quantity": "1", "average_cost": "1"}
    with patch.object(holdings, "MAX_ACTIVE_HOLDINGS_PER_USER", 1), \
         patch.object(holdings, "fetch_historical_data_background"):
        assert authenticated_client.post("/api/v1/portfolio/holdings", json=body).status_code == 201
        assert authenticated_client.post("/api/v1/portfolio/holdings", json=body).status_code == 400
