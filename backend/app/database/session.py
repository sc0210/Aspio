"""
Database session management for the Aspiro personal finance application.

DEPRECATED: This module re-exports from app.core.database for backwards compatibility.
New code should import directly from app.core.database.

Example:
    # Preferred
    from app.core.database import get_db, async_session, engine

    # Legacy (still works for backwards compatibility)
    from app.database.session import get_db_session, AsyncSessionLocal, engine
"""

# Re-export everything from core.database for backwards compatibility
from app.core.database import (
    engine,
    async_session as AsyncSessionLocal,  # Alias for legacy imports
    get_db as get_db_session,  # Alias for legacy imports
    get_async_session,
    init_db,
    close_db,
    get_db_health,
)

# Re-export AsyncSession for convenience
from sqlalchemy.ext.asyncio import AsyncSession

__all__ = [
    "engine",
    "AsyncSessionLocal",
    "get_db_session",
    "get_async_session",
    "init_db",
    "close_db",
    "get_db_health",
    "AsyncSession",
]
