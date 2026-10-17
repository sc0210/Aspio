"""Add gamification and user analytics models

Revision ID: add_gamification_models
Revises: 
Create Date: 2024-01-15 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_gamification_models'
down_revision = None  # Replace with actual revision ID if migrating from existing
branch_labels = None
depends_on = None


def upgrade():
    """Add gamification and user analytics tables"""
    
    # Create achievement type enum
    achievement_type_enum = postgresql.ENUM(
        'first_transaction',
        'hundred_transactions', 
        'thousand_transactions',
        'first_goal',
        'goal_completed',
        'five_goals_completed',
        'first_savings_milestone',
        'emergency_fund_built',
        'investment_starter',
        'diversified_portfolio',
        'daily_login_streak_7',
        'daily_login_streak_30',
        'daily_login_streak_100',
        'budget_master',
        'expense_tracker',
        'qr_payment_master',
        'digital_wallet_user',
        'local_investment_explorer',
        'multi_currency_tracker',
        'family_saver',
        'lunar_new_year_saver',
        'referral_champion',
        'community_helper',
        'early_adopter',
        'financial_literacy',
        'risk_assessment_complete',
        'investment_course_complete',
        name='achievementtype'
    )
    achievement_type_enum.create(op.get_bind())
    
    # Create achievement rarity enum
    achievement_rarity_enum = postgresql.ENUM(
        'common',
        'rare',
        'epic',
        'legendary',
        name='achievementrarity'
    )
    achievement_rarity_enum.create(op.get_bind())
    
    # Create user_gamification_achievements table
    op.create_table('user_gamification_achievements',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('achievement_type', achievement_type_enum, nullable=False),
        sa.Column('achievement_data', sa.JSON(), nullable=True),
        sa.Column('points_awarded', sa.Integer(), nullable=False, default=0),
        sa.Column('rarity', achievement_rarity_enum, nullable=False, default='common'),
        sa.Column('unlocked_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_gamification_achievements_user_id'), 'user_gamification_achievements', ['user_id'], unique=False)
    
    # Create user_activity_logs table
    op.create_table('user_activity_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('activity_type', sa.String(length=100), nullable=False),
        sa.Column('activity_data', sa.JSON(), nullable=True),
        sa.Column('session_id', sa.String(length=100), nullable=True),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_activity_logs_user_id'), 'user_activity_logs', ['user_id'], unique=False)
    op.create_index(op.f('ix_user_activity_logs_activity_type'), 'user_activity_logs', ['activity_type'], unique=False)
    op.create_index(op.f('ix_user_activity_logs_session_id'), 'user_activity_logs', ['session_id'], unique=False)
    
    # Create user_data_exports table
    op.create_table('user_data_exports',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('request_type', sa.String(length=50), nullable=False, default='full_export'),
        sa.Column('status', sa.String(length=50), nullable=False, default='pending'),
        sa.Column('file_path', sa.String(length=500), nullable=True),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('download_count', sa.Integer(), nullable=False, default=0),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_data_exports_user_id'), 'user_data_exports', ['user_id'], unique=False)
    
    # Create user_security_logs table
    op.create_table('user_security_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('event_type', sa.String(length=100), nullable=False),
        sa.Column('event_description', sa.Text(), nullable=False),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('risk_level', sa.String(length=20), nullable=False, default='low'),
        sa.Column('event_metadata', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_security_logs_user_id'), 'user_security_logs', ['user_id'], unique=False)
    op.create_index(op.f('ix_user_security_logs_event_type'), 'user_security_logs', ['event_type'], unique=False)
    
    # Create user_preference_history table
    op.create_table('user_preference_history',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('preference_key', sa.String(length=100), nullable=False),
        sa.Column('old_value', sa.Text(), nullable=True),
        sa.Column('new_value', sa.Text(), nullable=False),
        sa.Column('changed_by', sa.String(length=20), nullable=False, default='user'),
        sa.Column('reason', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_preference_history_user_id'), 'user_preference_history', ['user_id'], unique=False)


def downgrade():
    """Remove gamification and user analytics tables"""
    
    # Drop tables
    op.drop_index(op.f('ix_user_preference_history_user_id'), table_name='user_preference_history')
    op.drop_table('user_preference_history')
    
    op.drop_index(op.f('ix_user_security_logs_event_type'), table_name='user_security_logs')
    op.drop_index(op.f('ix_user_security_logs_user_id'), table_name='user_security_logs')
    op.drop_table('user_security_logs')
    
    op.drop_index(op.f('ix_user_data_exports_user_id'), table_name='user_data_exports')
    op.drop_table('user_data_exports')
    
    op.drop_index(op.f('ix_user_activity_logs_session_id'), table_name='user_activity_logs')
    op.drop_index(op.f('ix_user_activity_logs_activity_type'), table_name='user_activity_logs')
    op.drop_index(op.f('ix_user_activity_logs_user_id'), table_name='user_activity_logs')
    op.drop_table('user_activity_logs')
    
    op.drop_index(op.f('ix_user_gamification_achievements_user_id'), table_name='user_gamification_achievements')
    op.drop_table('user_gamification_achievements')
    
    # Drop enums
    op.execute("DROP TYPE achievementrarity")
    op.execute("DROP TYPE achievementtype")