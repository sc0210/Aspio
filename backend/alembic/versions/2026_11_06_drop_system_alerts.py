"""Drop the unused system_alerts table

Revision ID: 2026_11_06_drop_system_alerts
Revises: 2026_11_06_goal_car_purchase
Create Date: 2026-11-06

Nothing read or wrote SystemAlert and no migration ever created its table; it
existed only on databases built with create_all. The model is gone, so drop the
orphan explicitly rather than leave it for a later autogenerate to surprise.
"""

from alembic import op

revision = "2026_11_06_drop_system_alerts"
down_revision = "2026_11_06_goal_car_purchase"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("DROP TABLE IF EXISTS system_alerts")


def downgrade():
    # The table held nothing the app used; there is nothing to restore.
    pass
