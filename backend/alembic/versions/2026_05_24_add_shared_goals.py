"""Add shared_goals table for joint savings feature

Revision ID: 2026_05_24_add_shared_goals
Revises: 2026_05_23_add_peers
Create Date: 2026-05-24

Adds:
  - shared_goals table — tracks joint savings goals between two peers, with
    per-side contribution amounts (requester_amount / receiver_amount) and
    automatic status transitions (active → completed when total >= target).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_05_24_add_shared_goals"
down_revision = "2026_05_23_add_peers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shared_goals",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "connection_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("peer_connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column(
            "target_amount",
            sa.Numeric(15, 2),
            nullable=False,
        ),
        sa.Column("target_date", sa.Date, nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # 'active' | 'completed' | 'cancelled'
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="active",
        ),
        # Contribution by the connection.requester
        sa.Column(
            "requester_amount",
            sa.Numeric(15, 2),
            nullable=False,
            server_default="0",
        ),
        # Contribution by the connection.receiver
        sa.Column(
            "receiver_amount",
            sa.Numeric(15, 2),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )

    op.create_index(
        "idx_shared_goals_connection_id",
        "shared_goals",
        ["connection_id"],
    )
    op.create_index(
        "idx_shared_goals_created_by",
        "shared_goals",
        ["created_by"],
    )


def downgrade() -> None:
    op.drop_index("idx_shared_goals_created_by", table_name="shared_goals")
    op.drop_index("idx_shared_goals_connection_id", table_name="shared_goals")
    op.drop_table("shared_goals")
