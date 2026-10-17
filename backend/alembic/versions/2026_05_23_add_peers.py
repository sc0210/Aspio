"""Add username to users and create peer_connections table

Revision ID: 2026_05_23_add_peers
Revises: 2026_05_22_db_storage_cleanup
Create Date: 2026-05-23

Adds:
  - users.username  VARCHAR(30) UNIQUE nullable — public handle for peer discovery
  - peer_connections table — stores directional invite/connection state between users
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_05_23_add_peers"
down_revision = "2026_05_22_db_storage_cleanup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- users: add username column ---------------------------------------------
    op.add_column(
        "users",
        sa.Column("username", sa.String(30), nullable=True),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    # -- peer_connections table -------------------------------------------------
    op.create_table(
        "peer_connections",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "requester_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "receiver_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "requester_id != receiver_id",
            name="no_self_connection",
        ),
        sa.UniqueConstraint(
            "requester_id",
            "receiver_id",
            name="unique_pair",
        ),
    )

    op.create_index(
        "idx_peer_conn_requester",
        "peer_connections",
        ["requester_id"],
    )
    op.create_index(
        "idx_peer_conn_receiver",
        "peer_connections",
        ["receiver_id"],
    )
    op.create_index(
        "idx_peer_conn_status",
        "peer_connections",
        ["requester_id", "status"],
    )


def downgrade() -> None:
    # -- Drop peer_connections --------------------------------------------------
    op.drop_index("idx_peer_conn_status", table_name="peer_connections")
    op.drop_index("idx_peer_conn_receiver", table_name="peer_connections")
    op.drop_index("idx_peer_conn_requester", table_name="peer_connections")
    op.drop_table("peer_connections")

    # -- Drop users.username ---------------------------------------------------
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "username")
