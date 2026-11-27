"""One row per badge per user, on real Postgres.

award_achievement checks for the badge and then inserts it. Two requests at once
both passed the check, so a badge (and its XP) could be awarded twice. The unique
index uq_user_gamification_achievement now refuses the second insert, and the prod
SQL that adds it first removes existing duplicates and takes their XP back.

SQLite runs requests one at a time, so only Postgres shows the race. The test makes
its own database on the server and drops it afterwards:

    ASPIRO_PG_LOCK_TEST_URL=postgresql+asyncpg://user:pass@host:5432/postgres \\
        python -m pytest tests/test_achievement_unique_postgres.py -m integration -o "addopts="
"""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

URL = os.environ.get("ASPIRO_PG_LOCK_TEST_URL", "")
PROD_SQL = Path(__file__).parent.parent / "scripts/prod_sql/2026_11_27_unique_user_achievement.sql"

pytestmark = [
    pytest.mark.integration,
    pytest.mark.asyncio,
    pytest.mark.skipif(not URL.startswith("postgresql"), reason="needs ASPIRO_PG_LOCK_TEST_URL"),
]


@pytest_asyncio.fixture
async def world():
    import asyncpg

    import app.main  # noqa: F401  registers every model
    from app.core.database import Base
    from app.modules.users.models import User, UserRole, UserStatus

    name = f"aspiro_badge_{uuid4().hex[:8]}"
    server = make_url(URL)
    admin = server.set(drivername="postgresql").render_as_string(hide_password=False)

    async def admin_exec(sql):
        conn = await asyncpg.connect(admin)
        try:
            await conn.execute(sql)
        finally:
            await conn.close()

    await admin_exec(f"CREATE DATABASE {name}")
    engine = create_async_engine(server.set(database=name), connect_args={"statement_cache_size": 0})
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with maker() as s:
            user = User(id=uuid4(), email="badge@example.com", name="Badge", hashed_password="x",
                        is_active=True, is_verified=True, role=UserRole.USER, status=UserStatus.ACTIVE,
                        preferred_currency="TWD", timezone="Asia/Taipei", experience_points=0, level=1)
            s.add(user)
            await s.commit()
        yield maker, engine, user.id
    finally:
        await engine.dispose()
        await admin_exec(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


async def test_two_requests_award_a_badge_once(world):
    from app.modules.users.gamification_repository import GamificationRepository
    from app.modules.users.models import (
        AchievementType,
        User,
        UserGamificationAchievement,
    )

    maker, _, user_id = world

    racers = 2
    both_checked = asyncio.Barrier(racers)

    async def award():
        async with maker() as s:
            real_execute = s.execute
            reads = 0

            async def execute(statement, *args, **kwargs):
                nonlocal reads
                result = await real_execute(statement, *args, **kwargs)
                reads += 1
                if reads == 1:
                    # The "already has it?" read: neither request inserts until both
                    # have seen no badge, which is the race two tabs can hit.
                    await both_checked.wait()
                return result

            s.execute = execute
            return await GamificationRepository(s).award_achievement(
                user_id, AchievementType.FIRST_GOAL, points=50
            )

    results = await asyncio.wait_for(asyncio.gather(*(award() for _ in range(racers))), timeout=30)

    assert sum(r is not None for r in results) == 1
    async with maker() as s:
        rows = (await s.execute(
            select(UserGamificationAchievement).where(UserGamificationAchievement.user_id == user_id)
        )).scalars().all()
        xp = (await s.execute(select(User.experience_points).where(User.id == user_id))).scalar_one()
    assert len(rows) == 1
    assert xp == 50


async def test_prod_sql_removes_duplicates_and_their_xp(world):
    _, engine, user_id = world
    sql = PROD_SQL.read_text()
    first = datetime(2026, 1, 1, tzinfo=UTC)

    async with engine.begin() as conn:
        # An existing database: no index yet, and a race already paid twice.
        await conn.execute(text("DROP INDEX uq_user_gamification_achievement"))
        for kind, points, days in (("FIRST_GOAL", 50, 0), ("FIRST_GOAL", 50, 1),
                                   ("FIRST_GOAL", 50, 2), ("FIRST_TRANSACTION", 100, 0)):
            await conn.execute(
                text("INSERT INTO user_gamification_achievements "
                     "(id, user_id, achievement_type, achievement_data, points_awarded, rarity, unlocked_at, "
                     "created_at, updated_at) VALUES (:id, :u, :k, '{}', :p, 'COMMON', :at, now(), now())"),
                {"id": uuid4(), "u": user_id, "k": kind, "p": points, "at": first + timedelta(days=days)},
            )
        # 250 XP paid; 100 of it by the two extra FIRST_GOAL rows. Level 2 at 250 XP.
        await conn.execute(text("UPDATE users SET experience_points = 250, level = 2 WHERE id = :u"),
                           {"u": user_id})

    async def state():
        async with engine.connect() as conn:
            rows = (await conn.execute(text(
                "SELECT achievement_type, unlocked_at FROM user_gamification_achievements "
                "WHERE user_id = :u ORDER BY achievement_type::text"), {"u": user_id})).all()
            user = (await conn.execute(text(
                "SELECT experience_points, level FROM users WHERE id = :u"), {"u": user_id})).one()
            index = (await conn.execute(text(
                "SELECT to_regclass('uq_user_gamification_achievement') IS NOT NULL"))).scalar_one()
        return [(r[0], r[1]) for r in rows], tuple(user), index

    for _ in range(2):  # a second run changes nothing
        async with engine.connect() as conn:
            raw = await conn.get_raw_connection()
            await raw.driver_connection.execute(sql)
        rows, user, index = await state()
        assert rows == [("FIRST_GOAL", first), ("FIRST_TRANSACTION", first)]  # the first unlock kept
        assert user == (150, 1)  # 250 - 100; below 200 XP is level 1
        assert index
