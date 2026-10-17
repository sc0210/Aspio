"""
Database package for Aspiro FastAPI Backend

All SQLAlchemy models inherit from the Base class defined in base.py.
Schema migrations live in backend/alembic/, not here.

Components:
- base.py: SQLAlchemy base models and model registration
- session.py: Database session management utilities
"""

from .base import Base, BaseModel, import_all_models

__all__ = ["Base", "BaseModel", "import_all_models"]