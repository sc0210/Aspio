#!/usr/bin/env python3
"""
Grant an admin role to a registered account, or list the admins.

    python scripts/create_admin.py grant you@example.com [--role super_admin]
    python scripts/create_admin.py list

On a self-hosted stack run it through `aspiro admin grant|list`, which execs it in
the backend container. Register the account in the app first: granting approves a
registration that is still pending, so the new admin can log in straight away.
Exit status: 0 done, 1 no account with that email, 2 bad arguments.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select  # noqa: E402

from app.core.database import async_session  # noqa: E402
from app.modules.admin.init_admin import grant_admin  # noqa: E402
from app.modules.admin.models import AdminRole, AdminUser  # noqa: E402
from app.modules.users.models import User  # noqa: E402

ROLES = [r.value for r in AdminRole]


async def grant(email: str, role: str) -> int:
    async with async_session() as session:
        admin = await grant_admin(session, email, role)
    if admin is None:
        print(f"No account registered as {email}. Register it in the app first.", file=sys.stderr)
        return 1
    print(f"{email} is now {admin.role}. Sign out and back in to see /admin.")
    return 0


async def list_admins() -> int:
    async with async_session() as session:
        rows = (
            await session.execute(
                select(User.email, AdminUser.role)
                .join(User, AdminUser.user_id == User.id)
                .where(AdminUser.is_active.is_(True))
                .order_by(User.email)
            )
        ).all()
    if not rows:
        print("No admins yet. Grant one with: aspiro admin grant <email> super_admin")
    for email, role in rows:
        print(f"{role:12} {email}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    sub = parser.add_subparsers(dest="command", required=True)
    g = sub.add_parser("grant", help="make a registered account an admin")
    g.add_argument("email")
    g.add_argument("--role", default="super_admin", choices=ROLES)
    sub.add_parser("list", help="list active admins")
    args = parser.parse_args()
    if args.command == "grant":
        return asyncio.run(grant(args.email, args.role))
    return asyncio.run(list_admins())


if __name__ == "__main__":
    sys.exit(main())
