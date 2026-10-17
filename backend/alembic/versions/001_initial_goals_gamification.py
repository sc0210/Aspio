"""Initial goals and gamification system

Revision ID: 001_initial_goals_gamification
Revises: 
Create Date: 2025-01-09 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001_initial_goals_gamification'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create custom enums
    goal_type_enum = postgresql.ENUM(
        'savings', 'investment', 'debt_payoff', 'emergency_fund', 'retirement',
        'education', 'vacation', 'car_purchase', 'house_down_payment', 'other',
        name='goaltype'
    )
    goal_status_enum = postgresql.ENUM(
        'active', 'completed', 'paused', 'cancelled',
        name='goalstatus'
    )
    goal_priority_enum = postgresql.ENUM(
        'low', 'medium', 'high', 'critical',
        name='goalpriority'
    )
    contribution_type_enum = postgresql.ENUM(
        'manual', 'automatic', 'transfer', 'dividend', 'interest',
        name='contributiontype'
    )
    streak_type_enum = postgresql.ENUM(
        'daily_logging', 'goal_contributions', 'budget_compliance',
        'investment_reviews', 'achievement_hunting',
        name='streaktype'
    )
    achievement_type_enum = postgresql.ENUM(
        'goal_based', 'streak_based', 'savings_based',
        'milestone_based', 'behavioral', 'seasonal',
        name='achievementtype'
    )
    achievement_rarity_enum = postgresql.ENUM(
        'common', 'uncommon', 'rare', 'epic', 'legendary',
        name='achievementrarity'
    )
    risk_tolerance_enum = postgresql.ENUM(
        'conservative', 'moderate', 'aggressive',
        name='risk_tolerance_enum'
    )
    
    # Create enums
    goal_type_enum.create(op.get_bind())
    goal_status_enum.create(op.get_bind())
    goal_priority_enum.create(op.get_bind())
    contribution_type_enum.create(op.get_bind())
    streak_type_enum.create(op.get_bind())
    achievement_type_enum.create(op.get_bind())
    achievement_rarity_enum.create(op.get_bind())
    risk_tolerance_enum.create(op.get_bind())

    # Create users table
    op.create_table('users',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('email', sa.String(255), unique=True, nullable=False, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=True),
        sa.Column('avatar_url', sa.String(500), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True, nullable=False),
        sa.Column('is_verified', sa.Boolean(), default=False, nullable=False),
        sa.Column('google_id', sa.String(100), unique=True, nullable=True, index=True),
        sa.Column('preferences', postgresql.JSON(), nullable=True, default={}),
        sa.Column('experience_points', sa.Integer(), default=0, nullable=False),
        sa.Column('level', sa.Integer(), default=1, nullable=False),
        sa.Column('date_of_birth', sa.DateTime(), nullable=True),
        sa.Column('occupation', sa.String(255), nullable=True),
        sa.Column('monthly_income', sa.Integer(), nullable=True),
        sa.Column('risk_tolerance', risk_tolerance_enum, nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False)
    )

    # Create user sessions table
    op.create_table('user_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('refresh_token', sa.Text(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('is_active', sa.Boolean(), default=True, nullable=False),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE')
    )

    # Create goals table
    op.create_table('goals',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, index=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('goal_type', goal_type_enum, nullable=False, default='savings'),
        sa.Column('target_amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('current_amount', sa.Numeric(15, 2), nullable=False, default=0),
        sa.Column('currency', sa.String(3), nullable=False, default='USD'),
        sa.Column('target_date', sa.Date(), nullable=False),
        sa.Column('status', goal_status_enum, nullable=False, default='active'),
        sa.Column('priority', goal_priority_enum, nullable=False, default='medium'),
        sa.Column('progress_percentage', sa.Numeric(5, 2), nullable=False, default=0),
        sa.Column('monthly_target', sa.Numeric(15, 2), nullable=True),
        sa.Column('weekly_target', sa.Numeric(15, 2), nullable=True),
        sa.Column('achievement_points', sa.Integer(), nullable=False, default=0),
        sa.Column('milestone_count', sa.Integer(), nullable=False, default=0),
        sa.Column('completion_streak', sa.Integer(), nullable=False, default=0),
        sa.Column('auto_contribute', sa.Boolean(), nullable=False, default=False),
        sa.Column('auto_amount', sa.Numeric(15, 2), nullable=True),
        sa.Column('auto_frequency', sa.String(20), nullable=True),
        sa.Column('last_auto_contribution', sa.DateTime(timezone=True), nullable=True),
        sa.Column('tags', postgresql.JSON(), nullable=True),
        sa.Column('category_metadata', postgresql.JSON(), nullable=True),
        sa.Column('projected_completion_date', sa.Date(), nullable=True),
        sa.Column('projected_final_amount', sa.Numeric(15, 2), nullable=True),
        sa.Column('risk_assessment', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.CheckConstraint('target_amount > 0', name='check_positive_target_amount'),
        sa.CheckConstraint('current_amount >= 0', name='check_non_negative_current_amount'),
        sa.CheckConstraint('progress_percentage >= 0 AND progress_percentage <= 100', name='check_valid_progress_percentage'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE')
    )
    
    # Create indexes for goals
    op.create_index('ix_goals_user_status', 'goals', ['user_id', 'status'])
    op.create_index('ix_goals_user_type', 'goals', ['user_id', 'goal_type'])
    op.create_index('ix_goals_target_date', 'goals', ['target_date'])

    # Create achievement badges table
    op.create_table('achievement_badges',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False, unique=True),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('icon_url', sa.String(500), nullable=True),
        sa.Column('badge_color', sa.String(7), nullable=True),
        sa.Column('border_color', sa.String(7), nullable=True),
        sa.Column('animation_type', sa.String(50), nullable=True),
        sa.Column('achievement_type', achievement_type_enum, nullable=False),
        sa.Column('rarity', achievement_rarity_enum, nullable=False, default='common'),
        sa.Column('criteria', postgresql.JSON(), nullable=False),
        sa.Column('points_reward', sa.Integer(), nullable=False, default=0),
        sa.Column('experience_reward', sa.Integer(), nullable=False, default=0),
        sa.Column('unlock_rewards', postgresql.JSON(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, default=True),
        sa.Column('is_secret', sa.Boolean(), nullable=False, default=False),
        sa.Column('prerequisite_badges', postgresql.JSON(), nullable=True),
        sa.Column('available_from', sa.Date(), nullable=True),
        sa.Column('available_until', sa.Date(), nullable=True),
        sa.Column('seasonal_tags', postgresql.JSON(), nullable=True),
        sa.Column('total_earned', sa.Integer(), nullable=False, default=0),
        sa.Column('rarity_score', sa.Numeric(5, 2), nullable=True),
        sa.Column('badge_metadata', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.CheckConstraint('points_reward >= 0', name='check_non_negative_points_reward'),
        sa.CheckConstraint('experience_reward >= 0', name='check_non_negative_experience_reward')
    )
    
    # Create indexes for achievement badges
    op.create_index('ix_badges_type_rarity', 'achievement_badges', ['achievement_type', 'rarity'])
    op.create_index('ix_badges_active', 'achievement_badges', ['is_active'])

    # Create goal milestones table
    op.create_table('goal_milestones',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('goal_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('target_amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False, default=0),
        sa.Column('is_completed', sa.Boolean(), nullable=False, default=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completion_percentage', sa.Numeric(5, 2), nullable=False, default=0),
        sa.Column('reward_points', sa.Integer(), nullable=False, default=0),
        sa.Column('reward_badge_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('reward_description', sa.String(500), nullable=True),
        sa.Column('celebration_message', sa.String(500), nullable=True),
        sa.Column('target_date', sa.Date(), nullable=True),
        sa.Column('estimated_completion_date', sa.Date(), nullable=True),
        sa.Column('milestone_metadata', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint('target_amount > 0', name='check_positive_milestone_amount'),
        sa.CheckConstraint('completion_percentage >= 0 AND completion_percentage <= 100', name='check_valid_milestone_percentage'),
        sa.ForeignKeyConstraint(['goal_id'], ['goals.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reward_badge_id'], ['achievement_badges.id']),
        sa.UniqueConstraint('goal_id', 'order_index', name='unique_milestone_order')
    )
    
    # Create indexes for goal milestones
    op.create_index('ix_milestones_goal_order', 'goal_milestones', ['goal_id', 'order_index'])

    # Create goal contributions table
    op.create_table('goal_contributions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('goal_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False, default='USD'),
        sa.Column('contribution_type', contribution_type_enum, nullable=False, default='manual'),
        sa.Column('source_transaction_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('source_description', sa.String(255), nullable=True),
        sa.Column('payment_method', sa.String(100), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('tags', postgresql.JSON(), nullable=True),
        sa.Column('metadata', postgresql.JSON(), nullable=True),
        sa.Column('points_earned', sa.Integer(), nullable=False, default=0),
        sa.Column('streak_contribution', sa.Boolean(), nullable=False, default=False),
        sa.Column('contribution_date', sa.Date(), nullable=False, default=sa.func.current_date()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.CheckConstraint('amount > 0', name='check_positive_contribution_amount'),
        sa.ForeignKeyConstraint(['goal_id'], ['goals.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE')
    )
    
    # Create indexes for goal contributions
    op.create_index('ix_contributions_goal_date', 'goal_contributions', ['goal_id', 'contribution_date'])
    op.create_index('ix_contributions_user_date', 'goal_contributions', ['user_id', 'contribution_date'])

    # Create goal simulations table
    op.create_table('goal_simulations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('goal_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('simulation_name', sa.String(255), nullable=False),
        sa.Column('monthly_contribution', sa.Numeric(15, 2), nullable=False),
        sa.Column('annual_return_rate', sa.Numeric(5, 4), nullable=True),
        sa.Column('inflation_rate', sa.Numeric(5, 4), nullable=True),
        sa.Column('projected_completion_date', sa.Date(), nullable=True),
        sa.Column('projected_final_amount', sa.Numeric(15, 2), nullable=True),
        sa.Column('total_contributions_needed', sa.Numeric(15, 2), nullable=True),
        sa.Column('months_to_goal', sa.Integer(), nullable=True),
        sa.Column('best_case_date', sa.Date(), nullable=True),
        sa.Column('worst_case_date', sa.Date(), nullable=True),
        sa.Column('confidence_interval', sa.Numeric(5, 2), nullable=True),
        sa.Column('monthly_projections', postgresql.JSON(), nullable=True),
        sa.Column('risk_factors', postgresql.JSON(), nullable=True),
        sa.Column('recommendations', postgresql.JSON(), nullable=True),
        sa.Column('simulation_parameters', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint('monthly_contribution > 0', name='check_positive_monthly_contribution'),
        sa.ForeignKeyConstraint(['goal_id'], ['goals.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE')
    )
    
    # Create indexes for goal simulations
    op.create_index('ix_simulations_goal_date', 'goal_simulations', ['goal_id', 'created_at'])

    # Create user streaks table
    op.create_table('user_streaks',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('streak_type', streak_type_enum, nullable=False),
        sa.Column('current_streak', sa.Integer(), nullable=False, default=0),
        sa.Column('longest_streak', sa.Integer(), nullable=False, default=0),
        sa.Column('total_count', sa.Integer(), nullable=False, default=0),
        sa.Column('last_activity_date', sa.Date(), nullable=True),
        sa.Column('streak_start_date', sa.Date(), nullable=True),
        sa.Column('last_streak_reset', sa.Date(), nullable=True),
        sa.Column('points_earned', sa.Integer(), nullable=False, default=0),
        sa.Column('milestone_rewards', postgresql.JSON(), nullable=True),
        sa.Column('streak_metadata', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.CheckConstraint('current_streak >= 0', name='check_non_negative_current_streak'),
        sa.CheckConstraint('longest_streak >= current_streak', name='check_longest_streak_validity'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('user_id', 'streak_type', name='unique_user_streak_type')
    )
    
    # Create indexes for user streaks
    op.create_index('ix_streaks_user_type', 'user_streaks', ['user_id', 'streak_type'])

    # Create user achievements table
    op.create_table('user_achievements',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('badge_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('is_earned', sa.Boolean(), nullable=False, default=False),
        sa.Column('earned_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('progress_percentage', sa.Numeric(5, 2), nullable=False, default=0),
        sa.Column('current_progress', postgresql.JSON(), nullable=True),
        sa.Column('progress_history', postgresql.JSON(), nullable=True),
        sa.Column('related_goal_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('milestone_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('points_claimed', sa.Integer(), nullable=False, default=0),
        sa.Column('experience_claimed', sa.Integer(), nullable=False, default=0),
        sa.Column('rewards_claimed', postgresql.JSON(), nullable=True),
        sa.Column('is_showcased', sa.Boolean(), nullable=False, default=False),
        sa.Column('shared_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('celebration_viewed', sa.Boolean(), nullable=False, default=False),
        sa.Column('achievement_metadata', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.CheckConstraint('progress_percentage >= 0 AND progress_percentage <= 100', name='check_valid_achievement_progress'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['badge_id'], ['achievement_badges.id']),
        sa.ForeignKeyConstraint(['related_goal_id'], ['goals.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['milestone_id'], ['goal_milestones.id'], ondelete='SET NULL'),
        sa.UniqueConstraint('user_id', 'badge_id', name='unique_user_badge')
    )
    
    # Create indexes for user achievements
    op.create_index('ix_user_achievements_earned', 'user_achievements', ['user_id', 'is_earned'])
    op.create_index('ix_user_achievements_goal', 'user_achievements', ['related_goal_id'])

    # Create gamification events table
    op.create_table('gamification_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('event_type', sa.String(100), nullable=False),
        sa.Column('event_description', sa.String(500), nullable=True),
        sa.Column('points_earned', sa.Integer(), nullable=False, default=0),
        sa.Column('experience_earned', sa.Integer(), nullable=False, default=0),
        sa.Column('bonus_multiplier', sa.Numeric(3, 2), nullable=False, default=1.0),
        sa.Column('related_goal_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('related_achievement_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('related_streak_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('event_data', postgresql.JSON(), nullable=True),
        sa.Column('triggered_by', sa.String(100), nullable=True),
        sa.Column('event_date', sa.Date(), nullable=False, default=sa.func.current_date()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['related_goal_id'], ['goals.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['related_achievement_id'], ['user_achievements.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['related_streak_id'], ['user_streaks.id'], ondelete='SET NULL')
    )
    
    # Create indexes for gamification events
    op.create_index('ix_gamification_events_user_date', 'gamification_events', ['user_id', 'event_date'])
    op.create_index('ix_gamification_events_type', 'gamification_events', ['event_type'])
    op.create_index('ix_gamification_events_goal', 'gamification_events', ['related_goal_id'])

    # Create user gamification profiles table
    op.create_table('user_gamification_profiles',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column('current_level', sa.Integer(), nullable=False, default=1),
        sa.Column('total_experience', sa.Integer(), nullable=False, default=0),
        sa.Column('experience_to_next_level', sa.Integer(), nullable=False, default=100),
        sa.Column('total_points', sa.Integer(), nullable=False, default=0),
        sa.Column('total_badges_earned', sa.Integer(), nullable=False, default=0),
        sa.Column('rare_badges_count', sa.Integer(), nullable=False, default=0),
        sa.Column('legendary_badges_count', sa.Integer(), nullable=False, default=0),
        sa.Column('goals_completed', sa.Integer(), nullable=False, default=0),
        sa.Column('total_saved', sa.Numeric(15, 2), nullable=False, default=0),
        sa.Column('milestones_reached', sa.Integer(), nullable=False, default=0),
        sa.Column('longest_overall_streak', sa.Integer(), nullable=False, default=0),
        sa.Column('active_streaks_count', sa.Integer(), nullable=False, default=0),
        sa.Column('streak_achievements', postgresql.JSON(), nullable=True),
        sa.Column('rank_points', sa.Integer(), nullable=False, default=0),
        sa.Column('global_rank', sa.Integer(), nullable=True),
        sa.Column('regional_rank', sa.Integer(), nullable=True),
        sa.Column('friend_rank', sa.Integer(), nullable=True),
        sa.Column('gamification_enabled', sa.Boolean(), nullable=False, default=True),
        sa.Column('public_profile', sa.Boolean(), nullable=False, default=False),
        sa.Column('showcase_badges', postgresql.JSON(), nullable=True),
        sa.Column('monthly_points', sa.Integer(), nullable=False, default=0),
        sa.Column('monthly_reset_date', sa.Date(), nullable=False, default=sa.func.current_date()),
        sa.Column('profile_metadata', postgresql.JSON(), nullable=True),
        sa.Column('last_activity_date', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.CheckConstraint('current_level >= 1', name='check_positive_level'),
        sa.CheckConstraint('total_experience >= 0', name='check_non_negative_experience'),
        sa.CheckConstraint('total_points >= 0', name='check_non_negative_points'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE')
    )
    
    # Create indexes for user gamification profiles
    op.create_index('ix_gamification_profiles_level', 'user_gamification_profiles', ['current_level'])
    op.create_index('ix_gamification_profiles_rank', 'user_gamification_profiles', ['rank_points'])


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_table('user_gamification_profiles')
    op.drop_table('gamification_events')
    op.drop_table('user_achievements')
    op.drop_table('user_streaks')
    op.drop_table('goal_simulations')
    op.drop_table('goal_contributions')
    op.drop_table('goal_milestones')
    op.drop_table('achievement_badges')
    op.drop_table('goals')
    op.drop_table('user_sessions')
    op.drop_table('users')
    
    # Drop enums
    op.execute('DROP TYPE IF EXISTS risk_tolerance_enum')
    op.execute('DROP TYPE IF EXISTS achievementrarity')
    op.execute('DROP TYPE IF EXISTS achievementtype')
    op.execute('DROP TYPE IF EXISTS streaktype')
    op.execute('DROP TYPE IF EXISTS contributiontype')
    op.execute('DROP TYPE IF EXISTS goalpriority')
    op.execute('DROP TYPE IF EXISTS goalstatus')
    op.execute('DROP TYPE IF EXISTS goaltype')