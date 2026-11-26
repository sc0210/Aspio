"""Drop nine tables no code reads or writes

Revision ID: 2026_11_23_drop_unused_tables
Revises: 2026_11_21_tw_market_valuations
Create Date: 2026-11-23

Their models are gone:
- chat_sessions, chat_messages: the retired /chat page (removed 2026-09-17).
- password_reset_tokens: reset tokens moved to the shared emailed-token table.
- user_data_exports, user_security_logs, user_preference_history: never written.
- notification_templates, market_data: never read; market_data_type_enum went
  with market_data.
- transaction_attachments: its upload/list/delete routes had no caller and
  were removed.

A table that could hold someone's data is dropped only when it is empty: if
one has rows, the upgrade stops and names it, so nothing is lost silently.
Check with backend/scripts/prod_sql/_verify_pending.sql first.
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_11_23_drop_unused_tables"
down_revision = "2026_11_21_tw_market_valuations"
branch_labels = None
depends_on = None

# Could hold a user's own data: refuse to drop these while they have rows.
GUARDED = (
    "chat_messages",
    "chat_sessions",
    "transaction_attachments",
    "user_data_exports",
    "user_security_logs",
    "user_preference_history",
)
# Caches, templates nothing read and superseded tokens.
DISPOSABLE = ("password_reset_tokens", "notification_templates", "market_data")


def upgrade():
    conn = op.get_bind()
    nonempty = [
        t
        for t in GUARDED
        if conn.execute(sa.text("SELECT to_regclass(:t)"), {"t": t}).scalar()
        and conn.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM {t})")).scalar()  # noqa: S608
    ]
    if nonempty:
        raise RuntimeError(
            f"Not dropping {', '.join(nonempty)}: they still have rows. "
            "Export or delete them first, then rerun the migration."
        )
    for t in GUARDED + DISPOSABLE:  # chat_messages before chat_sessions (FK)
        op.execute(f"DROP TABLE IF EXISTS {t}")
    op.execute("DROP TYPE IF EXISTS market_data_type_enum")


def downgrade():
    # Older revisions' downgrades drop these tables, so stop here rather than let
    # them fail halfway down the chain. Nothing used the tables; recreate them by
    # hand from the earlier migrations if a downgrade past this point is needed.
    raise NotImplementedError("2026_11_23_drop_unused_tables cannot be downgraded")
