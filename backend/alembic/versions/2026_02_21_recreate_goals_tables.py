"""Recreate goals tables - replace old gamification schema with current model

Revision ID: recreate_goals_tables
Revises: 5210a6d8d4e0
Create Date: 2026-02-21

The database has legacy gamification-era goals tables with a different schema
(goal_type, achievement_points, etc.) and UPPERCASE enum values. The current
Goals module uses a simplified schema with 'category', 'started_at', 'extra_data'
and lowercase enum values. This migration drops the old tables and recreates them
to match the current SQLAlchemy models.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "recreate_goals_tables"
down_revision = "5210a6d8d4e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop old gamification goals tables and recreate with current schema."""

    # ── Step 1: Drop all old goal-related tables (CASCADE for FK deps) ──
    op.execute("DROP TABLE IF EXISTS goal_contributions CASCADE")
    op.execute("DROP TABLE IF EXISTS goal_milestones CASCADE")
    op.execute("DROP TABLE IF EXISTS goal_analytics CASCADE")
    op.execute("DROP TABLE IF EXISTS goal_simulations CASCADE")
    op.execute("DROP TABLE IF EXISTS goal_templates CASCADE")
    op.execute("DROP TABLE IF EXISTS goals CASCADE")

    # ── Step 2: Drop old enum types ──
    op.execute("DROP TYPE IF EXISTS goaltype CASCADE")
    op.execute("DROP TYPE IF EXISTS goalsharestatus CASCADE")
    op.execute("DROP TYPE IF EXISTS goalsharingpermission CASCADE")
    op.execute("DROP TYPE IF EXISTS goalstatus CASCADE")
    op.execute("DROP TYPE IF EXISTS goalpriority CASCADE")

    # ── Step 3: Create new enum types with lowercase values (matching models.py) ──
    op.execute(
        """
        CREATE TYPE goalcategory AS ENUM (
            'emergency_fund', 'retirement', 'house_down_payment', 'education',
            'vacation', 'debt_payoff', 'investment', 'savings', 'other'
        )
    """
    )
    op.execute(
        """
        CREATE TYPE goalpriority AS ENUM ('high', 'medium', 'low')
    """
    )
    op.execute(
        """
        CREATE TYPE goalstatus AS ENUM ('active', 'completed', 'paused', 'cancelled')
    """
    )

    # ── Step 4: Create goals table (matching Goal model) ──
    op.execute(
        """
        CREATE TABLE goals (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            category goalcategory NOT NULL DEFAULT 'savings',
            priority goalpriority NOT NULL DEFAULT 'medium',
            status goalstatus NOT NULL DEFAULT 'active',
            target_amount NUMERIC(20, 2) NOT NULL,
            current_amount NUMERIC(20, 2) NOT NULL DEFAULT 0.00,
            currency VARCHAR(3) NOT NULL DEFAULT 'USD',
            target_date TIMESTAMP WITH TIME ZONE,
            started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMP WITH TIME ZONE,
            extra_data JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    """
    )

    # ── Step 5: Create goal_milestones table (matching GoalMilestone model) ──
    op.execute(
        """
        CREATE TABLE goal_milestones (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            amount NUMERIC(20, 2) NOT NULL,
            target_date TIMESTAMP WITH TIME ZONE,
            is_completed BOOLEAN NOT NULL DEFAULT FALSE,
            completed_at TIMESTAMP WITH TIME ZONE,
            extra_data JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    """
    )

    # ── Step 6: Create goal_contributions table (matching GoalContribution model) ──
    op.execute(
        """
        CREATE TABLE goal_contributions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
            amount NUMERIC(20, 2) NOT NULL,
            contribution_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            notes TEXT,
            transaction_id UUID,
            extra_data JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    """
    )

    # ── Step 7: Create indexes (matching model __table_args__) ──
    op.execute("CREATE INDEX idx_goals_user_id ON goals (user_id)")
    op.execute("CREATE INDEX idx_goals_user_status ON goals (user_id, status)")
    op.execute("CREATE INDEX idx_goals_user_category ON goals (user_id, category)")
    op.execute("CREATE INDEX idx_goals_target_date ON goals (target_date)")
    op.execute("CREATE INDEX idx_goal_milestones_goal_id ON goal_milestones (goal_id)")
    op.execute(
        "CREATE INDEX idx_milestones_goal_completed ON goal_milestones (goal_id, is_completed)"
    )
    op.execute(
        "CREATE INDEX idx_goal_contributions_goal_id ON goal_contributions (goal_id)"
    )
    op.execute(
        "CREATE INDEX idx_contributions_goal_date ON goal_contributions (goal_id, contribution_date)"
    )


def downgrade() -> None:
    """Drop goals tables and new enum types."""
    op.execute("DROP TABLE IF EXISTS goal_contributions CASCADE")
    op.execute("DROP TABLE IF EXISTS goal_milestones CASCADE")
    op.execute("DROP TABLE IF EXISTS goals CASCADE")
    op.execute("DROP TYPE IF EXISTS goalcategory CASCADE")
    op.execute("DROP TYPE IF EXISTS goalstatus CASCADE")
    op.execute("DROP TYPE IF EXISTS goalpriority CASCADE")
