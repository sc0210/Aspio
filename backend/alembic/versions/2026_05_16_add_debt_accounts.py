"""Add debt_accounts table and loan columns to transactions

Revision ID: 2026_05_16_add_debt_accounts
Revises: 2026_05_14_disable_rls
Create Date: 2026-05-16

Changes:
  - New enum types: loan_account_type, loan_status
  - New table: debt_accounts
  - New columns on transactions: loan_id, principal_portion, interest_portion
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_05_16_add_debt_accounts"
down_revision = "2026_05_14_disable_rls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # All DDL is idempotent so re-running is safe.

    # ── Enum types ────────────────────────────────────────────────────────────
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE loan_account_type AS ENUM
                ('personal_loan', 'mortgage', 'auto_loan', 'student_loan', 'credit_card', 'other');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE loan_status AS ENUM ('active', 'paid_off', 'paused');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)

    # ── debt_accounts table ───────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS debt_accounts (
            id                UUID            PRIMARY KEY,
            user_id           UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name              VARCHAR(200)    NOT NULL,
            lender_name       VARCHAR(200),
            account_type      loan_account_type NOT NULL,
            principal_amount  NUMERIC(15, 2)  NOT NULL,
            current_balance   NUMERIC(15, 2)  NOT NULL,
            interest_rate     NUMERIC(6, 4)   NOT NULL,
            minimum_payment   NUMERIC(15, 2)  NOT NULL,
            payment_due_day   SMALLINT        NOT NULL,
            start_date        DATE            NOT NULL,
            term_months       INTEGER,
            currency          VARCHAR(3)      NOT NULL DEFAULT 'TWD',
            status            loan_status     NOT NULL DEFAULT 'active',
            notes             TEXT,
            is_deleted        BOOLEAN         NOT NULL DEFAULT false,
            deleted_at        TIMESTAMPTZ,
            created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
            updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
            CONSTRAINT ck_debt_principal_positive    CHECK (principal_amount > 0),
            CONSTRAINT ck_debt_balance_non_negative  CHECK (current_balance >= 0),
            CONSTRAINT ck_debt_rate_non_negative     CHECK (interest_rate >= 0),
            CONSTRAINT ck_debt_min_payment_positive  CHECK (minimum_payment > 0),
            CONSTRAINT ck_debt_due_day_range         CHECK (payment_due_day >= 1 AND payment_due_day <= 31)
        );
    """)

    op.execute("CREATE INDEX IF NOT EXISTS idx_debt_accounts_user        ON debt_accounts(user_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_debt_accounts_status      ON debt_accounts(status);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_debt_accounts_user_status ON debt_accounts(user_id, status);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_debt_accounts_deleted     ON debt_accounts(is_deleted);")

    # ── transactions: loan repayment columns ──────────────────────────────────
    op.execute("""
        ALTER TABLE transactions
            ADD COLUMN IF NOT EXISTS loan_id           UUID       REFERENCES debt_accounts(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS principal_portion NUMERIC(15, 2),
            ADD COLUMN IF NOT EXISTS interest_portion  NUMERIC(15, 2);
    """)

    op.execute("CREATE INDEX IF NOT EXISTS idx_transactions_loan_id ON transactions(loan_id);")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_transactions_loan_id;")
    op.execute("ALTER TABLE transactions DROP COLUMN IF EXISTS interest_portion;")
    op.execute("ALTER TABLE transactions DROP COLUMN IF EXISTS principal_portion;")
    op.execute("ALTER TABLE transactions DROP COLUMN IF EXISTS loan_id;")

    op.execute("DROP INDEX IF EXISTS idx_debt_accounts_deleted;")
    op.execute("DROP INDEX IF EXISTS idx_debt_accounts_user_status;")
    op.execute("DROP INDEX IF EXISTS idx_debt_accounts_status;")
    op.execute("DROP INDEX IF EXISTS idx_debt_accounts_user;")
    op.execute("DROP TABLE IF EXISTS debt_accounts;")

    op.execute("DROP TYPE IF EXISTS loan_status;")
    op.execute("DROP TYPE IF EXISTS loan_account_type;")
