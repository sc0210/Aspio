#!/usr/bin/env python3
"""
Two throwaway partner accounts for the shared-spending Playwright test (dev only).

    ASPIRO_E2E=1 python scripts/e2e_split_users.py setup      # prints JSON credentials
    ASPIRO_E2E=1 python scripts/e2e_split_users.py teardown   # locks both accounts again

The test (frontend/tests/e2e/shared-spending.spec.ts) runs it in the dev backend
container with `docker exec`. setup creates or resets two accounts on
@example.com, links them as accepted partners, and wipes their ledgers, bills,
repayments and notifications, so every run starts from nothing. Each setup sets
a fresh random password, printed once and never stored, and teardown deactivates
both accounts and scrambles their passwords. So an account with a known password
never outlives a run, even if this is pointed at the wrong database by mistake.

Refuses to run without ASPIRO_E2E=1. ENVIRONMENT is not a guard: the self-hosted
production stack reports "development" too.
Exit status: 0 done, 2 bad arguments or not opted in.
"""

import asyncio
import json
import os
import secrets
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import app.main  # noqa: E402,F401  (registers every model for the relationships)
from sqlalchemy import and_, delete, or_, select  # noqa: E402

from app.core.database import async_session  # noqa: E402
from app.modules.notifications.models import Notification  # noqa: E402
from app.modules.peers.models import (  # noqa: E402
    PeerConnection, PeerConnectionPref, PeerSettlement, PeerSplit, PeerStatus,
)
from app.modules.transactions.models import Transaction  # noqa: E402
from app.modules.users.models import User, UserStatus  # noqa: E402
from app.modules.users.security import security_utils  # noqa: E402

ACCOUNTS = (
    ("e2e-split-alice@example.com", "e2e_split_alice", "E2E Alice"),
    ("e2e-split-bob@example.com", "e2e_split_bob", "E2E Bob"),
)


async def _user(session, email: str, username: str, name: str) -> User:
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        user = User(id=uuid.uuid4(), email=email, username=username, name=name,
                    hashed_password=security_utils.hash_password(secrets.token_urlsafe(24)),
                    referral_code=security_utils.generate_secure_token(8))
        session.add(user)
        await session.flush()
    return user


async def setup() -> dict:
    async with async_session() as session:
        users, creds = [], {}
        for key, (email, username, name) in zip(("alice", "bob"), ACCOUNTS):
            user = await _user(session, email, username, name)
            password = secrets.token_urlsafe(18)
            user.hashed_password = security_utils.hash_password(password)
            user.status, user.is_active, user.name = UserStatus.ACTIVE, True, name
            users.append(user)
            creds[key] = {"email": email, "password": password, "name": name}
        alice, bob = users
        ids = (alice.id, bob.id)

        # Start from nothing: their connections' bills and repayments, their own
        # ledgers and notifications.
        conns = (await session.execute(select(PeerConnection).where(or_(
            PeerConnection.requester_id.in_(ids), PeerConnection.receiver_id.in_(ids),
        )))).scalars().all()
        conn_ids = [c.id for c in conns]
        if conn_ids:
            await session.execute(delete(PeerSettlement).where(PeerSettlement.connection_id.in_(conn_ids)))
            for split in (await session.execute(select(PeerSplit).where(
                    PeerSplit.connection_id.in_(conn_ids)))).scalars().all():
                await session.delete(split)  # shares go with it (ORM cascade)
            await session.execute(delete(PeerConnectionPref).where(PeerConnectionPref.connection_id.in_(conn_ids)))
        await session.execute(delete(Transaction).where(Transaction.user_id.in_(ids)))
        await session.execute(delete(Notification).where(Notification.user_id.in_(ids)))

        # Exactly one connection, accepted, between the two; any other removed.
        pair = next((c for c in conns if {c.requester_id, c.receiver_id} == set(ids)), None)
        for c in conns:
            if c is not pair:
                c.status = PeerStatus.REMOVED
        if pair is None:
            pair = PeerConnection(id=uuid.uuid4(), requester_id=alice.id, receiver_id=bob.id)
            session.add(pair)
        pair.status = PeerStatus.ACCEPTED
        await session.commit()
        return creds


async def teardown() -> None:
    async with async_session() as session:
        for email, _, _ in ACCOUNTS:
            user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if user is not None:
                user.is_active = False
                user.hashed_password = security_utils.hash_password(secrets.token_urlsafe(24))
        await session.commit()


def main() -> int:
    if os.environ.get("ASPIRO_E2E") != "1":
        print("Refusing: set ASPIRO_E2E=1 to confirm this is a development database.", file=sys.stderr)
        return 2
    if len(sys.argv) != 2 or sys.argv[1] not in ("setup", "teardown"):
        print(__doc__, file=sys.stderr)
        return 2
    if sys.argv[1] == "setup":
        print(json.dumps(asyncio.run(setup())))
    else:
        asyncio.run(teardown())
    return 0


if __name__ == "__main__":
    sys.exit(main())
