"""
Demo user initialization.

Creates a pre-seeded demo account on startup so anyone can sign in with
real credentials and experience the full authenticated app without registering.
Only when DEMO_ACCOUNT_ENABLED is set: the password below is public, so the
account is open to anyone who can reach the instance.

Credentials (intentionally public):
  email:    demo@aspiro.dev
  password: demo1234
"""

import logging
import uuid
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users.models import User, UserStatus
from app.modules.users.security import security_utils

logger = logging.getLogger(__name__)

DEMO_EMAIL = "demo@aspiro.dev"
DEMO_PASSWORD = "demo1234"
DEMO_NAME = "Demo User"
DEMO_USERNAME = "demo"


async def init_demo_user(session: AsyncSession) -> None:
    """Ensure the public demo account exists and is active.

    Idempotent — safe to call on every startup.  If the account already
    exists its password and status are refreshed so a manual DB change
    can never accidentally lock out the demo account.
    """
    result = await session.execute(
        select(User).where(User.email == DEMO_EMAIL)
    )
    user: User | None = result.scalar_one_or_none()

    if user is None:
        user = User(
            id=uuid.uuid4(),
            email=DEMO_EMAIL,
            name=DEMO_NAME,
            username=DEMO_USERNAME,
            hashed_password=security_utils.hash_password(DEMO_PASSWORD),
            is_active=True,
            status=UserStatus.ACTIVE,
            referral_code=security_utils.generate_secure_token(8),
        )
        session.add(user)
        await session.commit()
        logger.info("Demo user created: %s", DEMO_EMAIL)
    else:
        # Refresh password and status in case they were tampered with
        user.hashed_password = security_utils.hash_password(DEMO_PASSWORD)
        user.status = UserStatus.ACTIVE
        user.is_active = True
        if not user.username:
            user.username = DEMO_USERNAME
        await session.commit()
        logger.info("Demo user refreshed: %s", DEMO_EMAIL)

    await detach_demo_from_peers(session, user.id)


async def disable_demo_user(session: AsyncSession) -> None:
    """Deactivate an existing demo account so its public password stops working.

    Its data is kept; turning DEMO_ACCOUNT_ENABLED back on reactivates it.
    """
    user = (await session.execute(select(User).where(User.email == DEMO_EMAIL))).scalar_one_or_none()
    if user is None:
        return
    if user.is_active:
        user.is_active = False
        await session.commit()
        logger.info("Demo account disabled (DEMO_ACCOUNT_ENABLED is off): %s", DEMO_EMAIL)
    await detach_demo_from_peers(session, user.id)


async def detach_demo_from_peers(session: AsyncSession, demo_user_id: uuid.UUID) -> None:
    """End every peer connection involving the demo account.

    A peer sees the other side's wallet totals, debt and net-worth trend, and
    anyone holding the public demo password is the demo account, so no real
    user may stay connected to it. Invites to or from it are refused at
    creation (peers/service.py); this clears rows created before that.
    """
    from app.modules.peers.models import PeerConnection, PeerStatus

    rows = (await session.execute(
        select(PeerConnection).where(
            and_(
                or_(PeerConnection.requester_id == demo_user_id, PeerConnection.receiver_id == demo_user_id),
                PeerConnection.status.in_([PeerStatus.PENDING, PeerStatus.ACCEPTED]),
            )
        )
    )).scalars().all()
    for conn in rows:
        conn.status = PeerStatus.REMOVED
    if rows:
        await session.commit()
        logger.info("Removed %d peer connection(s) involving the demo account", len(rows))
