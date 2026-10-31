"""
Global test configuration and fixtures for Aspiro backend tests.

This module provides shared fixtures and configuration for all test modules,
including database setup, test client configuration, and common test data.
"""

import os

# Disable rate limiting for the whole test session. The limiter keeps
# process-global in-memory buckets, and every TestClient request shares one
# client id ("ip:testclient"), so low-burst auth endpoints (e.g. register,
# burst=1) would return 429 once the suite makes more than a couple of calls.
# Must be set before app.main is imported so the middleware is never added.
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

# Tests never reach a real database: the in-memory SQLite CI uses, whatever the
# environment says. Inside the dev container DATABASE_URL is the developer's own
# Postgres, and a bare TestClient(app) registered test accounts in it.
# ASPIRO_TEST_DATABASE_URL opts a run into another database on purpose.
os.environ["DATABASE_URL"] = os.environ.get("ASPIRO_TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")

import asyncio
import pytest
import pytest_asyncio
from typing import AsyncGenerator
from unittest.mock import AsyncMock

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import get_async_session, Base
from app.modules.users.models import User, UserRole, UserStatus
from app.modules.transactions.models import TransactionCategory, TransactionType

# Test database URL - SQLite in memory for fast tests
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# ── SQLite JSONB compatibility ──────────────────────────────────────────────
# Models use PostgreSQL's JSONB type. SQLite's type compiler doesn't know how
# to render it, causing collection errors. Teach it to treat JSONB as TEXT.
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler  # noqa: E402

if not hasattr(SQLiteTypeCompiler, "visit_JSONB"):
    def _visit_JSONB(self, type_, **kw):
        return "TEXT"
    SQLiteTypeCompiler.visit_JSONB = _visit_JSONB  # type: ignore[attr-defined]
# ────────────────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _disable_auth_rate_limit():
    """Disable the in-route auth throttle (``rate_limit_check``) for every test.

    Auth endpoints (login/register/password-reset/resend) declare a second-line
    guard that keeps a process-global bucket keyed by client IP. Every
    TestClient request shares one IP ("testserver"), so across a full suite run
    the suite trips 429 after ~10 auth calls per endpoint. Overriding the
    dependency with a no-op disables it regardless of call volume. The global
    RateLimitMiddleware is already off via RATE_LIMIT_ENABLED above.
    """
    from app.modules.users.dependencies import rate_limit_check

    app.dependency_overrides[rate_limit_check] = lambda: None
    yield
    app.dependency_overrides.pop(rate_limit_check, None)


@pytest_asyncio.fixture
def event_loop():
    """Provide a fresh event loop per test to avoid cross-test leakage."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        yield loop
    finally:
        if not loop.is_closed():
            loop.close()


@pytest_asyncio.fixture(scope="function")
async def async_engine():
    """Create async engine for testing."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        poolclass=StaticPool,
        connect_args={
            "check_same_thread": False,
        },
        echo=False,
    )

    # Create all tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    # Clean up
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()
    # Yield to event loop so aiosqlite can finish internal cleanup
    await asyncio.sleep(0)


@pytest_asyncio.fixture(scope="function")
async def async_session(async_engine) -> AsyncSession:
    """Create async database session for testing."""
    async_session_maker = sessionmaker(
        async_engine, class_=AsyncSession, expire_on_commit=False
    )

    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.rollback()
            await session.close()


@pytest.fixture(scope="function")
def override_get_async_session(async_session: AsyncSession):
    """Override the get_async_session dependency."""

    async def _override_get_async_session():
        return async_session

    return _override_get_async_session


@pytest.fixture(scope="function")
def client(override_get_async_session):
    """Create test client with database session override."""
    from app.core.database import get_db
    app.dependency_overrides[get_async_session] = override_get_async_session
    app.dependency_overrides[get_db] = override_get_async_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def seed_categories(async_session: AsyncSession):
    """Seed test categories for transaction testing."""
    from uuid import uuid4

    default_categories = [
        # Expense categories
        {
            "name": "Food & Dining",
            "type": TransactionType.EXPENSE,
            "icon": "🍽️",
            "color": "#FF6B6B",
        },
        {
            "name": "Groceries",
            "type": TransactionType.EXPENSE,
            "icon": "🛒",
            "color": "#4ECDC4",
        },
        {
            "name": "Transportation",
            "type": TransactionType.EXPENSE,
            "icon": "🚗",
            "color": "#45B7D1",
        },
        {
            "name": "Shopping",
            "type": TransactionType.EXPENSE,
            "icon": "🛍️",
            "color": "#F9CA24",
        },
        {
            "name": "Entertainment",
            "type": TransactionType.EXPENSE,
            "icon": "🎬",
            "color": "#A29BFE",
        },
        {
            "name": "Healthcare",
            "type": TransactionType.EXPENSE,
            "icon": "🏥",
            "color": "#FD79A8",
        },
        {
            "name": "Housing",
            "type": TransactionType.EXPENSE,
            "icon": "🏠",
            "color": "#6C5CE7",
        },
        {
            "name": "Utilities",
            "type": TransactionType.EXPENSE,
            "icon": "💡",
            "color": "#FDCB6E",
        },
        # Income categories
        {
            "name": "Salary",
            "type": TransactionType.INCOME,
            "icon": "💼",
            "color": "#00B894",
        },
        {
            "name": "Freelance",
            "type": TransactionType.INCOME,
            "icon": "💻",
            "color": "#00CEC9",
        },
        {
            "name": "Investment Returns",
            "type": TransactionType.INCOME,
            "icon": "📈",
            "color": "#74B9FF",
        },
    ]

    for cat_data in default_categories:
        category = TransactionCategory(
            id=uuid4(),
            name=cat_data["name"],
            name_en=cat_data["name"],
            type=cat_data["type"],
            color=cat_data["color"],
            icon=cat_data["icon"],
            description=f"{cat_data['name']} category",
            keywords=[cat_data["name"].lower()],
            is_default=True,
            is_active=True,
            is_system=True,
        )
        async_session.add(category)

    await async_session.commit()
    return True


@pytest_asyncio.fixture
async def test_user(async_session: AsyncSession) -> User:
    """Create a test user."""
    from uuid import uuid4

    user = User(
        id=uuid4(),
        email="testuser@example.com",
        name="Test User",
        hashed_password="$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW",  # secret
        is_active=True,
        is_verified=True,
        role=UserRole.USER,
        status=UserStatus.ACTIVE,
        preferred_currency="USD",
        timezone="UTC",
        experience_points=0,
        level=1,
    )
    async_session.add(user)
    await async_session.commit()
    await async_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_category(async_session: AsyncSession) -> TransactionCategory:
    """Create a test transaction category."""
    from uuid import uuid4

    category = TransactionCategory(
        id=uuid4(),
        name="Test Category",
        name_en="Test Category",
        type=TransactionType.EXPENSE,
        color="#FF0000",
        icon="test-icon",
        description="Test category for testing",
        keywords=["test"],
        is_default=False,
        is_active=True,
        is_system=False,
    )
    async_session.add(category)
    await async_session.commit()
    await async_session.refresh(category)
    return category


@pytest.fixture
def test_user_data():
    """Test user data for registration and authentication."""
    return {
        "email": "testuser@example.com",
        "password": "TestPassword123!",
        "confirm_password": "TestPassword123!",
        "name": "Test User",
        "terms_accepted": True,
    }


@pytest_asyncio.fixture
async def authenticated_client(client, test_user, async_session):
    """Create an authenticated test client with a valid JWT token."""
    from app.modules.users.security import jwt_manager

    # Create access token for test user
    access_token = jwt_manager.create_access_token(
        {"sub": str(test_user.id), "email": test_user.email}
    )

    # Set authorization header
    client.headers = {**client.headers, "Authorization": f"Bearer {access_token}"}

    return client
