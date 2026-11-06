"""Add 'car_purchase' to the goalcategory enum

Revision ID: 2026_11_06_goal_car_purchase
Revises: 2026_11_03_security_quotes
Create Date: 2026-11-06

The goal create/edit modals offer "Car purchase", but the enum never had it, so
saving such a goal hit a LookupError and the API answered 500.
"""

from alembic import op

revision = "2026_11_06_goal_car_purchase"
down_revision = "2026_11_03_security_quotes"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE goalcategory ADD VALUE IF NOT EXISTS 'car_purchase'")


def downgrade():
    # PostgreSQL cannot drop an enum value; downgrade is a no-op.
    pass
