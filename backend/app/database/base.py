"""
Base database model for SQLAlchemy 2.0 in the Aspiro personal finance application.
"""

from datetime import datetime
from sqlalchemy import DateTime, String, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, DeclarativeBase
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models"""

    pass


# Dialect-aware JSON type: uses JSONB on Postgres and JSON on SQLite
JSONType = JSONB().with_variant(JSON(), "sqlite")


class BaseModel(Base):
    """Abstract base model with common fields"""

    __abstract__ = True

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), onupdate=func.now(), nullable=False
    )


def import_all_models() -> None:
    """Import every model module so all tables register on ``Base.metadata``.

    This is the sole model-discovery mechanism for Alembic (``env.py`` calls it
    and uses ``Base.metadata`` as ``target_metadata``). Importing a single class
    from a module executes the whole module, which registers every mapped class
    defined in it — so one import per module is enough.

    Imports are direct, with no ``try/except ImportError`` swallowing: a missing
    model must fail loudly. Silently catching the error would drop that module's
    tables from autogenerate, which can make Alembic propose dropping live
    tables. Keep one entry per module that owns models.

    MAINTENANCE CONTRACT: every ``backend/app/modules/*/models.py`` must have
    exactly one import below. When you add a module that owns SQLAlchemy models,
    add it here. (At app runtime models also register transitively because
    ``app.main`` imports every router; Alembic has no such path and relies solely
    on this function — so a module missing here is invisible to autogenerate even
    if the running app sees it.)
    """
    from app.modules.admin.models import AdminUser  # noqa: F401
    from app.modules.chat.models import ChatSession  # noqa: F401
    from app.modules.goals.models import Goal  # noqa: F401
    from app.modules.line_bot.models import LineGroup  # noqa: F401
    from app.modules.loans.models import DebtAccount  # noqa: F401
    from app.modules.notifications.models import Notification  # noqa: F401
    from app.modules.peers.models import PeerConnection  # noqa: F401
    from app.modules.portfolio.models import Portfolio  # noqa: F401
    from app.modules.transactions.models import Transaction  # noqa: F401
    from app.modules.users.models import User  # noqa: F401
