"""
Base repository with common patterns for all repositories.
Automatically handles soft delete filtering and query optimization.
"""

from typing import TypeVar, Generic, Type, Optional, List, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

T = TypeVar("T")


class BaseRepository(Generic[T]):
    """
    Base repository class with common operations.

    Provides:
    - Automatic soft delete filtering
    - Common CRUD patterns
    - Query optimization helpers
    """

    def __init__(self, db: AsyncSession, model: Type[T]):
        self.db = db
        self.model = model

    def _apply_soft_delete_filter(self, stmt):
        """
        Automatically apply soft delete filter if model supports it.

        Checks for:
        - is_deleted boolean column
        - deleted_at datetime column
        """
        if hasattr(self.model, "is_deleted"):
            # Boolean soft delete (is_deleted = false)
            stmt = stmt.where(self.model.is_deleted == False)
        elif hasattr(self.model, "deleted_at"):
            # Datetime soft delete (deleted_at IS NULL)
            stmt = stmt.where(self.model.deleted_at.is_(None))
        return stmt

    async def get_by_id(self, id: Any) -> Optional[T]:
        """Get single record by ID with auto soft-delete filtering."""
        stmt = select(self.model).where(self.model.id == id)
        stmt = self._apply_soft_delete_filter(stmt)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_all(self, skip: int = 0, limit: int = 100) -> List[T]:
        """Get all records with auto soft-delete filtering."""
        stmt = select(self.model)
        stmt = self._apply_soft_delete_filter(stmt)
        stmt = stmt.offset(skip).limit(limit)
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def create(self, **data) -> T:
        """Create a new record."""
        obj = self.model(**data)
        self.db.add(obj)
        await self.db.flush()
        return obj

    async def update(self, id: Any, **data) -> Optional[T]:
        """Update a record by ID."""
        obj = await self.get_by_id(id)
        if not obj:
            return None

        for key, value in data.items():
            if hasattr(obj, key):
                setattr(obj, key, value)

        await self.db.flush()
        return obj

    async def delete(self, id: Any) -> bool:
        """Soft delete a record by ID."""
        obj = await self.get_by_id(id)
        if not obj:
            return False

        if hasattr(self.model, "is_deleted"):
            obj.is_deleted = True
        elif hasattr(self.model, "deleted_at"):
            from datetime import datetime, timezone

            obj.deleted_at = datetime.now(timezone.utc)

        await self.db.flush()
        return True

