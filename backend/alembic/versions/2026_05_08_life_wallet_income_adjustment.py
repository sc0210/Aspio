"""Add income adjustment for users with negative life wallet from investment wallet migration

Revision ID: 2026_05_08_life_wallet_adj
Revises: 2026_05_06_partial_indexes
Create Date: 2026-05-08

When the investment wallet was removed (remove_invest_wallet migration), all
investment-wallet transactions were re-classified as life-wallet transactions.
For users who had stock purchases recorded against the investment wallet, those
expenses now appear in the life wallet without a matching income entry (the
cash that funded those purchases was tracked as portfolio holdings, not as a
transaction).  This leaves some users with a negative life wallet balance.

Fix: for every user whose life wallet is negative after the migration, insert
a single INCOME adjustment transaction that brings the balance back to zero.
"""

from alembic import op
from sqlalchemy import text
from datetime import date

revision = "2026_05_08_life_wallet_adj"
down_revision = "2026_05_06_partial_indexes"
branch_labels = None
depends_on = None

ADJUSTMENT_DATE = date(2026, 5, 8)
ADJUSTMENT_DESCRIPTION = "System: Investment Wallet Migration Adjustment"
ADJUSTMENT_NOTES = (
    "Auto-generated income adjustment. "
    "Offsets investment-wallet expenses that were re-classified to the life wallet "
    "when the investment wallet was removed."
)


def upgrade():
    conn = op.get_bind()

    # ── 1. Pick any existing INCOME category to satisfy the FK ───────────────
    category_row = conn.execute(
        text(
            "SELECT id FROM transaction_categories WHERE type = 'INCOME' LIMIT 1"
        )
    ).fetchone()

    if not category_row:
        raise RuntimeError(
            "No INCOME category found in transaction_categories. "
            "Cannot insert adjustment transactions."
        )

    category_id = str(category_row[0])

    # ── 2. Find users with a negative life-wallet balance ────────────────────
    negative_users = conn.execute(
        text(
            """
            SELECT
                user_id,
                SUM(CASE WHEN type = 'INCOME' THEN amount ELSE -amount END) AS balance
            FROM transactions
            WHERE wallet_type = 'life'
              AND is_deleted = FALSE
            GROUP BY user_id
            HAVING SUM(CASE WHEN type = 'INCOME' THEN amount ELSE -amount END) < 0
            """
        )
    ).fetchall()

    if not negative_users:
        return

    # ── 3. Insert one income adjustment per affected user ────────────────────
    for row in negative_users:
        user_id = row[0]
        deficit = abs(row[1])

        currency_row = conn.execute(
            text(
                """
                SELECT currency
                FROM transactions
                WHERE user_id = :uid
                  AND wallet_type = 'life'
                  AND is_deleted = FALSE
                GROUP BY currency
                ORDER BY COUNT(*) DESC
                LIMIT 1
                """
            ),
            {"uid": user_id},
        ).fetchone()

        currency = currency_row[0] if currency_row else "TWD"

        conn.execute(
            text(
                """
                INSERT INTO transactions
                    (id, user_id, type, wallet_type, amount, currency,
                     description, notes, transaction_date, category_id,
                     status, auto_categorized, reviewed_by_user,
                     tax_deductible, business_expense,
                     is_deleted, created_at, updated_at)
                VALUES
                    (gen_random_uuid(), :uid, 'INCOME', 'life', :amount, :currency,
                     :description, :notes, :txn_date, :category_id,
                     'COMPLETED', FALSE, FALSE,
                     FALSE, FALSE,
                     FALSE, NOW(), NOW())
                """
            ),
            {
                "uid": user_id,
                "amount": float(deficit),
                "currency": currency,
                "description": ADJUSTMENT_DESCRIPTION,
                "notes": ADJUSTMENT_NOTES,
                "txn_date": ADJUSTMENT_DATE,
                "category_id": category_id,
            },
        )


def downgrade():
    conn = op.get_bind()

    conn.execute(
        text("DELETE FROM transactions WHERE description = :desc"),
        {"desc": ADJUSTMENT_DESCRIPTION},
    )
