#!/usr/bin/env python3
"""
Manual script to create admin user in the database.
Run this script to grant admin privileges to a user.

Usage:
    python scripts/create_admin.py
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from app.database.session import get_db_session
from app.modules.users.models import User
from app.modules.admin.models import AdminUser, AdminRole


async def create_admin_user(email: str, role: str = "super_admin"):
    """Create or update admin user by email."""

    async for session in get_db_session():
        try:
            # Find user by email
            result = await session.execute(
                select(User).where(User.email == email)
            )
            user = result.scalar_one_or_none()

            if not user:
                print(f"❌ User not found with email: {email}")
                print(f"   Please register an account first, then run this script.")
                return False

            print(f"✓ Found user: {user.email} (ID: {user.id})")

            # Check if admin record exists
            result = await session.execute(
                select(AdminUser).where(AdminUser.user_id == user.id)
            )
            admin = result.scalar_one_or_none()

            if admin:
                # Update existing admin
                admin.role = role
                admin.is_active = True
                print(f"✓ Updated existing admin role to: {role}")
            else:
                # Create new admin
                admin = AdminUser(
                    user_id=user.id,
                    role=role,
                    is_active=True,
                    notes="Created via manual script"
                )
                session.add(admin)
                print(f"✓ Created new admin with role: {role}")

            await session.commit()
            print(f"\n✅ SUCCESS! {email} is now an admin with role: {role}")
            print(f"   Admin ID: {admin.id}")
            print(f"   User ID: {user.id}")
            return True

        except Exception as e:
            await session.rollback()
            print(f"❌ Error: {e}")
            return False
        finally:
            break


async def list_admins():
    """List all existing admin users."""
    async for session in get_db_session():
        try:
            result = await session.execute(
                select(AdminUser, User)
                .join(User, AdminUser.user_id == User.id)
                .where(AdminUser.is_active == True)
            )
            admins = result.all()

            if not admins:
                print("No admin users found.")
                return

            print(f"\n📋 Current Admins ({len(admins)}):")
            print("=" * 70)
            for admin, user in admins:
                print(f"  • {user.email}")
                print(f"    Role: {admin.role}")
                print(f"    Active: {admin.is_active}")
                print(f"    Admin ID: {admin.id}")
                print()

        except Exception as e:
            print(f"❌ Error listing admins: {e}")
        finally:
            break


async def main():
    """Main script execution."""
    print("=" * 70)
    print("Aspiro Admin User Management")
    print("=" * 70)
    print()

    # List current admins
    await list_admins()

    # Prompt for email
    print("\nCreate/Update Admin User")
    print("-" * 70)
    email = input("Enter user email (or press Enter to skip): ").strip()

    if not email:
        print("Skipped. No changes made.")
        return

    # Prompt for role
    print("\nAvailable roles:")
    print("  1. super_admin  - Full access to all features")
    print("  2. admin        - Standard admin access")
    print("  3. moderator    - Content moderation")
    print("  4. analyst      - View-only analytics")
    print("  5. support      - User support functions")

    role_input = input("\nSelect role (1-5) [default: 1]: ").strip() or "1"

    role_map = {
        "1": "super_admin",
        "2": "admin",
        "3": "moderator",
        "4": "analyst",
        "5": "support"
    }

    role = role_map.get(role_input, "super_admin")

    print(f"\nCreating admin: {email} with role: {role}")
    confirm = input("Continue? (y/N): ").strip().lower()

    if confirm != 'y':
        print("Cancelled. No changes made.")
        return

    # Create/update admin
    success = await create_admin_user(email, role)

    if success:
        print("\n" + "=" * 70)
        print("Next steps:")
        print("  1. Restart your backend server (if running)")
        print("  2. Log out and log back in to the frontend")
        print("  3. Navigate to /admin to access the admin dashboard")
        print("=" * 70)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nCancelled by user.")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        sys.exit(1)
