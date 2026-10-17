"""Add LINE bot shared-expense tables

Revision ID: 2026_05_26_add_line_bot_tables
Revises: 2026_05_24_add_shared_goals
Create Date: 2026-05-26

Adds six tables to support the LINE Bot shared-expense feature:
  - line_groups          : maps a LINE group/room ID to a named expense group
  - line_group_members   : which Aspiro users have linked and joined a group
  - line_user_links      : LINE user ID → Aspiro user mapping (after OAuth linking)
  - line_link_tokens     : short-lived tokens used during the /link OAuth flow
  - shared_expenses      : an expense entry recorded in a group
  - expense_splits       : per-member share of a shared expense
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_05_26_add_line_bot_tables"
down_revision = "2026_05_24_add_shared_goals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- line_groups -----------------------------------------------------------
    op.create_table(
        "line_groups",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("line_group_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(100), nullable=True),
        sa.Column("currency", sa.String(10), nullable=False, server_default="TWD"),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_line_groups_line_group_id", "line_groups", ["line_group_id"], unique=True)
    op.create_index("idx_line_groups_created_by", "line_groups", ["created_by"])

    # -- line_group_members ----------------------------------------------------
    op.create_table(
        "line_group_members",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("line_groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("line_user_id", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("group_id", "user_id", name="uq_line_group_member"),
    )
    op.create_index("idx_line_group_members_group", "line_group_members", ["group_id"])
    op.create_index("idx_line_group_members_user", "line_group_members", ["user_id"])
    op.create_index("idx_line_group_members_line_user", "line_group_members", ["line_user_id"])

    # -- line_user_links -------------------------------------------------------
    op.create_table(
        "line_user_links",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("line_user_id", sa.String(64), nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("display_name", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("line_user_id", name="uq_line_user_links_line_user_id"),
        sa.UniqueConstraint("user_id", name="uq_line_user_links_user_id"),
    )
    op.create_index("ix_line_user_links_line_user_id", "line_user_links", ["line_user_id"], unique=True)
    op.create_index("idx_line_user_links_user_id", "line_user_links", ["user_id"])

    # -- line_link_tokens ------------------------------------------------------
    op.create_table(
        "line_link_tokens",
        sa.Column(
            "token",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("line_user_id", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("idx_line_link_tokens_line_user_id", "line_link_tokens", ["line_user_id"])

    # -- shared_expenses -------------------------------------------------------
    op.create_table(
        "shared_expenses",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("line_groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "payer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("currency", sa.String(10), nullable=False, server_default="TWD"),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("amount > 0", name="ck_shared_expense_positive"),
    )
    op.create_index("idx_shared_expenses_group", "shared_expenses", ["group_id"])
    op.create_index("idx_shared_expenses_payer", "shared_expenses", ["payer_id"])
    op.create_index("idx_shared_expenses_created_at", "shared_expenses", ["created_at"])

    # -- expense_splits --------------------------------------------------------
    op.create_table(
        "expense_splits",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "expense_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("shared_expenses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("settled", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("expense_id", "user_id", name="uq_expense_split_member"),
    )
    op.create_index("idx_expense_splits_expense", "expense_splits", ["expense_id"])
    op.create_index("idx_expense_splits_user", "expense_splits", ["user_id"])
    op.create_index("idx_expense_splits_settled", "expense_splits", ["user_id", "settled"])


def downgrade() -> None:
    op.drop_table("expense_splits")
    op.drop_table("shared_expenses")
    op.drop_table("line_link_tokens")
    op.drop_table("line_user_links")
    op.drop_table("line_group_members")
    op.drop_table("line_groups")
