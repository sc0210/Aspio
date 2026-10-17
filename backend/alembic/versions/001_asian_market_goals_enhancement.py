"""Asian market goals and gamification enhancement

Revision ID: 001_asian_market_goals
Revises: base
Create Date: 2025-01-15 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001_asian_market_goals'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Create new enum types for Asian market features
    goal_sharing_permission = postgresql.ENUM(
        'view_only', 'contribute', 'manage', 'admin',
        name='goalsharingpermission'
    )
    goal_sharing_permission.create(op.get_bind())
    
    goal_share_status = postgresql.ENUM(
        'pending', 'accepted', 'declined', 'revoked',
        name='goalshare_status'
    )
    goal_share_status.create(op.get_bind())
    
    # Update existing GoalType enum to include Asian market goal types
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'hdb_flat_purchase'")
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'cpf_savings'")
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'epf_savings'")
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'children_education'")
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'elderly_care'")
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'wedding_expenses'")
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'lunar_new_year'")
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'gold_investment'")
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'property_investment'")
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'business_capital'")
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'overseas_study'")
    op.execute("ALTER TYPE goaltype ADD VALUE IF NOT EXISTS 'medical_fund'")
    
    # Update ContributionType enum to include Asian payment methods
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'qr_payment'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'ewallet'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'bank_auto_debit'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'cpf_contribution'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'epf_contribution'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'cash_deposit'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'crypto_transfer'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'giro'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'dbs_paylah'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'grabpay'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'shopee_pay'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'touch_n_go'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'paynow'")
    op.execute("ALTER TYPE contributiontype ADD VALUE IF NOT EXISTS 'promptpay'")
    
    # Update AchievementType enum to include cultural achievements
    op.execute("ALTER TYPE achievementtype ADD VALUE IF NOT EXISTS 'cultural'")
    op.execute("ALTER TYPE achievementtype ADD VALUE IF NOT EXISTS 'family_oriented'")
    op.execute("ALTER TYPE achievementtype ADD VALUE IF NOT EXISTS 'education_focused'")
    op.execute("ALTER TYPE achievementtype ADD VALUE IF NOT EXISTS 'property_milestone'")
    op.execute("ALTER TYPE achievementtype ADD VALUE IF NOT EXISTS 'filial_piety'")
    op.execute("ALTER TYPE achievementtype ADD VALUE IF NOT EXISTS 'festival_preparation'")
    
    # Create shared_goals table
    op.create_table('shared_goals',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('goal_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('goals.id'), nullable=False),
        sa.Column('shared_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('shared_with_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('permission_level', goal_sharing_permission, nullable=False, default='view_only'),
        sa.Column('share_status', goal_share_status, nullable=False, default='pending'),
        sa.Column('relationship_type', sa.String(50)),
        sa.Column('share_percentage', sa.Numeric(5, 2)),
        sa.Column('can_view_progress', sa.Boolean, nullable=False, default=True),
        sa.Column('can_contribute', sa.Boolean, nullable=False, default=False),
        sa.Column('can_edit_goal', sa.Boolean, nullable=False, default=False),
        sa.Column('can_view_contributions', sa.Boolean, nullable=False, default=True),
        sa.Column('can_invite_others', sa.Boolean, nullable=False, default=False),
        sa.Column('notify_on_contributions', sa.Boolean, nullable=False, default=True),
        sa.Column('notify_on_milestones', sa.Boolean, nullable=False, default=True),
        sa.Column('notification_frequency', sa.String(20), default='immediate'),
        sa.Column('invitation_message', sa.Text),
        sa.Column('invited_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('responded_at', sa.DateTime(timezone=True)),
        sa.Column('revoked_at', sa.DateTime(timezone=True)),
        sa.Column('sharing_metadata', postgresql.JSON),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('goal_id', 'shared_with_user_id', name='unique_goal_user_share'),
        sa.CheckConstraint('share_percentage >= 0 AND share_percentage <= 100', name='check_valid_share_percentage')
    )
    
    # Create indexes for shared_goals
    op.create_index('ix_shared_goals_user', 'shared_goals', ['shared_with_user_id', 'share_status'])
    op.create_index('ix_shared_goals_goal', 'shared_goals', ['goal_id', 'share_status'])
    
    # Create goal_templates table
    op.create_table('goal_templates',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text, nullable=False),
        sa.Column('category', sa.String(100), nullable=False),
        sa.Column('goal_type', sa.Enum(name='goaltype'), nullable=False),
        sa.Column('suggested_amount_range', postgresql.JSON),
        sa.Column('suggested_timeline_months', sa.Integer),
        sa.Column('region', sa.String(10)),
        sa.Column('cultural_context', postgresql.JSON),
        sa.Column('regulatory_info', postgresql.JSON),
        sa.Column('milestone_templates', postgresql.JSON),
        sa.Column('auto_create_milestones', sa.Boolean, nullable=False, default=True),
        sa.Column('usage_count', sa.Integer, nullable=False, default=0),
        sa.Column('popularity_score', sa.Numeric(5, 2), nullable=False, default=0),
        sa.Column('tags', postgresql.JSON),
        sa.Column('icon_url', sa.String(500)),
        sa.Column('template_metadata', postgresql.JSON),
        sa.Column('is_active', sa.Boolean, nullable=False, default=True),
        sa.Column('is_featured', sa.Boolean, nullable=False, default=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now())
    )
    
    # Create indexes for goal_templates
    op.create_index('ix_goal_templates_category', 'goal_templates', ['category', 'is_active'])
    op.create_index('ix_goal_templates_region', 'goal_templates', ['region', 'is_active'])
    op.create_index('ix_goal_templates_popularity', 'goal_templates', ['popularity_score'])
    
    # Create cultural_savings_events table
    op.create_table('cultural_savings_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('event_name', sa.String(255), nullable=False),
        sa.Column('event_type', sa.String(100), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('culture', sa.String(50)),
        sa.Column('region', sa.String(10)),
        sa.Column('event_date', sa.Date, nullable=False),
        sa.Column('preparation_start_date', sa.Date),
        sa.Column('is_recurring', sa.Boolean, nullable=False, default=True),
        sa.Column('recurrence_pattern', sa.String(50)),
        sa.Column('suggested_savings_amount', postgresql.JSON),
        sa.Column('savings_timeline_weeks', sa.Integer),
        sa.Column('spending_categories', postgresql.JSON),
        sa.Column('achievement_criteria', postgresql.JSON),
        sa.Column('bonus_points_multiplier', sa.Numeric(3, 2), default=1.0),
        sa.Column('is_active', sa.Boolean, nullable=False, default=True),
        sa.Column('notification_enabled', sa.Boolean, nullable=False, default=True),
        sa.Column('event_metadata', postgresql.JSON),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now())
    )
    
    # Create indexes for cultural_savings_events
    op.create_index('ix_cultural_events_date', 'cultural_savings_events', ['event_date', 'is_active'])
    op.create_index('ix_cultural_events_type', 'cultural_savings_events', ['event_type', 'region'])
    op.create_index('ix_cultural_events_culture', 'cultural_savings_events', ['culture', 'is_active'])
    
    # Create goal_analytics table
    op.create_table('goal_analytics',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('goal_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('goals.id'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('analysis_date', sa.Date, nullable=False, default=sa.func.current_date()),
        sa.Column('analysis_type', sa.String(50), nullable=False),
        sa.Column('contribution_velocity', sa.Numeric(15, 2)),
        sa.Column('consistency_score', sa.Numeric(5, 2)),
        sa.Column('momentum_score', sa.Numeric(5, 2)),
        sa.Column('projected_completion_date', sa.Date),
        sa.Column('confidence_interval', sa.Numeric(5, 2)),
        sa.Column('risk_factors', postgresql.JSON),
        sa.Column('contribution_patterns', postgresql.JSON),
        sa.Column('seasonal_trends', postgresql.JSON),
        sa.Column('peer_comparison', postgresql.JSON),
        sa.Column('optimization_suggestions', postgresql.JSON),
        sa.Column('milestone_adjustments', postgresql.JSON),
        sa.Column('timeline_recommendations', postgresql.JSON),
        sa.Column('market_correlation', postgresql.JSON),
        sa.Column('economic_indicators', postgresql.JSON),
        sa.Column('analytics_metadata', postgresql.JSON),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )
    
    # Create indexes for goal_analytics
    op.create_index('ix_goal_analytics_goal_date', 'goal_analytics', ['goal_id', 'analysis_date'])
    op.create_index('ix_goal_analytics_user_date', 'goal_analytics', ['user_id', 'analysis_date'])
    op.create_index('ix_goal_analytics_type', 'goal_analytics', ['analysis_type'])
    
    # Create family_goal_groups table
    op.create_table('family_goal_groups',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('group_name', sa.String(255), nullable=False),
        sa.Column('group_type', sa.String(50), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('created_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('primary_admin_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('max_members', sa.Integer, default=10),
        sa.Column('invitation_code', sa.String(20), unique=True),
        sa.Column('is_private', sa.Boolean, nullable=False, default=True),
        sa.Column('requires_approval', sa.Boolean, nullable=False, default=True),
        sa.Column('cultural_background', sa.String(50)),
        sa.Column('primary_language', sa.String(10), default='en'),
        sa.Column('regional_focus', sa.String(10)),
        sa.Column('shared_goals', postgresql.JSON),
        sa.Column('group_savings_target', sa.Numeric(15, 2)),
        sa.Column('group_currency', sa.String(3), default='USD'),
        sa.Column('enable_group_chat', sa.Boolean, nullable=False, default=True),
        sa.Column('notification_preferences', postgresql.JSON),
        sa.Column('celebration_preferences', postgresql.JSON),
        sa.Column('is_active', sa.Boolean, nullable=False, default=True),
        sa.Column('member_count', sa.Integer, nullable=False, default=1),
        sa.Column('group_metadata', postgresql.JSON),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now())
    )
    
    # Create indexes for family_goal_groups
    op.create_index('ix_family_groups_admin', 'family_goal_groups', ['primary_admin_user_id'])
    op.create_index('ix_family_groups_active', 'family_goal_groups', ['is_active'])
    op.create_index('ix_family_groups_code', 'family_goal_groups', ['invitation_code'])
    
    # Create family_goal_members table
    op.create_table('family_goal_members',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('group_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('family_goal_groups.id'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False, default='member'),
        sa.Column('contribution_percentage', sa.Numeric(5, 2)),
        sa.Column('relationship_to_admin', sa.String(50)),
        sa.Column('display_name', sa.String(100)),
        sa.Column('join_status', sa.String(20), nullable=False, default='pending'),
        sa.Column('joined_at', sa.DateTime(timezone=True)),
        sa.Column('invited_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_active', sa.DateTime(timezone=True)),
        sa.Column('notification_enabled', sa.Boolean, nullable=False, default=True),
        sa.Column('show_in_leaderboard', sa.Boolean, nullable=False, default=True),
        sa.Column('member_metadata', postgresql.JSON),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('group_id', 'user_id', name='unique_group_member')
    )
    
    # Create indexes for family_goal_members
    op.create_index('ix_family_members_group', 'family_goal_members', ['group_id', 'join_status'])
    op.create_index('ix_family_members_user', 'family_goal_members', ['user_id'])


def downgrade():
    # Drop tables in reverse order
    op.drop_table('family_goal_members')
    op.drop_table('family_goal_groups')
    op.drop_table('goal_analytics')
    op.drop_table('cultural_savings_events')
    op.drop_table('goal_templates')
    op.drop_table('shared_goals')
    
    # Drop custom enum types
    op.execute("DROP TYPE IF EXISTS goalshare_status")
    op.execute("DROP TYPE IF EXISTS goalsharingpermission")
    
    # Note: We don't remove the added enum values as they might break existing data
    # In production, enum value removal should be handled more carefully