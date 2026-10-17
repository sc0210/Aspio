"""
Demo user initialization.

Creates a pre-seeded demo account on startup so anyone can sign in with
real credentials and experience the full authenticated app without registering.

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

    # Auto-accept any pending invites sent to the demo user
    try:
        from app.modules.peers.models import PeerConnection, PeerStatus

        pending_stmt = select(PeerConnection).where(
            and_(
                PeerConnection.receiver_id == user.id,
                PeerConnection.status == PeerStatus.PENDING,
            )
        )
        pending = (await session.execute(pending_stmt)).scalars().all()
        for conn in pending:
            conn.status = PeerStatus.ACCEPTED
        if pending:
            await session.commit()
            logger.info("Demo user auto-accepted %d pending invite(s)", len(pending))
    except Exception as e:
        logger.warning("Demo user invite auto-accept skipped: %s", e)
