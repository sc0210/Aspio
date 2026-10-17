"""Backfill existing LINE group currency USD -> TWD

Revision ID: 2026_06_22_line_group_currency_twd
Revises: 2026_06_22_merge_heads_txn_index
Create Date: 2026-06-22

A LINE expense group is a shared bill-splitting context for the Taiwan market and
is always denominated in TWD. Until now, ``_get_or_create_group`` seeded a new
group's currency from the *creator's* personal ``preferred_currency`` — so a user
whose account predates the 2026-06-04 "default -> TWD" change (revision
``3a8f1d2e9b5c``, which intentionally did NOT backfill existing rows) created
groups in USD, and that currency is frozen at creation. One member's personal
USD preference should never define the whole group's currency.

The service now hard-codes new groups to TWD. This revision repairs the existing
rows so already-created groups stop displaying USD.

Scope: only ``line_groups`` (a small, TW-market table) — deliberately narrower
than a blanket backfill of ``users.preferred_currency``, where some accounts may
legitimately use USD.
"""

from alembic import op

revision = "2026_06_22_line_group_currency_twd"
down_revision = "2026_06_22_merge_heads_txn_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE line_groups SET currency = 'TWD' WHERE currency = 'USD'")


def downgrade() -> None:
    # No-op: this is a one-way data backfill. The original per-group USD/TWD split
    # is not recorded anywhere, so there is nothing to restore on downgrade.
    pass
