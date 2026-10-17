"""
Dashboard module models: daily wallet balance snapshots.

The rest of the dashboard is computed from other modules' tables; this is the
one table the module owns.
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import BaseModel


class DailyWalletSnapshot(BaseModel):
    """One row per user per day: closing wallet balances, TWD-normalized.

    Written by the nightly scheduler job (and the one-time backfill script) so
    trend endpoints can read precomputed rows instead of replaying the full
    transaction ledger and holdings history on every request. Today's point is
    always computed live; snapshots only serve past days.
    """

    __tablename__ = "daily_wallet_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)

    life_balance: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0")
    )
    portfolio_value: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0")
    )
    emergency_value: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0")
    )
    debt_balance: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0")
    )
    net_worth: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0")
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="TWD")

    __table_args__ = (
        # Also serves as the (user_id, snapshot_date) lookup index for range
        # reads — Postgres scans unique indexes in either direction.
        UniqueConstraint(
            "user_id", "snapshot_date", name="uq_daily_wallet_snapshots_user_date"
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<DailyWalletSnapshot user={self.user_id} date={self.snapshot_date} "
            f"net_worth={self.net_worth}>"
        )
