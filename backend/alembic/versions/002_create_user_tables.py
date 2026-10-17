"""Create user management tables

Revision ID: 002_create_user_tables
Revises: 001_initial_schema
Create Date: 2024-09-09 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '002_create_user_tables'
down_revision = '001_initial_schema'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum types
    user_status_enum = postgresql.ENUM(
        'active', 'inactive', 'suspended', 'pending_verification', 'deactivated',
        name='userstatus'
    )
    user_status_enum.create(op.get_bind())
    
    user_role_enum = postgresql.ENUM(
        'user', 'premium', 'admin', 'moderator',
        name='userrole'
    )
    user_role_enum.create(op.get_bind())
    
    preferred_language_enum = postgresql.ENUM(
        'en', 'zh-CN', 'zh-HK', 'zh-TW', 'id', 'ms', 'th', 'vi', 'tl',
        name='preferredlanguage'
    )
    preferred_language_enum.create(op.get_bind())
    
    preferred_currency_enum = postgresql.ENUM(
        'USD', 'SGD', 'HKD', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'TWD', 'CNY', 'JPY', 'KRW',
        name='preferredcurrency'
    )
    preferred_currency_enum.create(op.get_bind())
    
    # Create users table
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        
        # Basic user information
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('password_hash', sa.String(255), nullable=True, comment='Bcrypt hashed password'),
        sa.Column('first_name', sa.String(100), nullable=False),
        sa.Column('last_name', sa.String(100), nullable=False),
        sa.Column('display_name', sa.String(100), nullable=True),
        
        # Profile information
        sa.Column('profile_picture_url', sa.String(500), nullable=True),
        sa.Column('phone_number', sa.String(20), nullable=True),
        sa.Column('date_of_birth', sa.DateTime(timezone=True), nullable=True),
        sa.Column('bio', sa.Text, nullable=True),
        
        # Account status and verification
        sa.Column('status', user_status_enum, nullable=False, default='pending_verification'),
        sa.Column('role', user_role_enum, nullable=False, default='user'),
        sa.Column('is_verified', sa.Boolean, nullable=False, default=False),
        sa.Column('is_active', sa.Boolean, nullable=False, default=True),
        sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True),
        
        # Authentication tracking
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_login_ip', sa.String(45), nullable=True),
        sa.Column('failed_login_attempts', sa.Integer, nullable=False, default=0),
        sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
        
        # User preferences
        sa.Column('preferred_language', preferred_language_enum, nullable=False, default='en'),
        sa.Column('preferred_currency', preferred_currency_enum, nullable=False, default='USD'),
        sa.Column('timezone', sa.String(50), nullable=False, default='UTC'),
        
        # Privacy and consent (GDPR compliance)
        sa.Column('privacy_policy_accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('marketing_emails_consent', sa.Boolean, nullable=False, default=False),
        sa.Column('data_processing_consent', sa.Boolean, nullable=False, default=True),
        
        # Notification preferences
        sa.Column('email_notifications', sa.Boolean, nullable=False, default=True),
        sa.Column('push_notifications', sa.Boolean, nullable=False, default=True),
        sa.Column('sms_notifications', sa.Boolean, nullable=False, default=False),
        
        # Gamification fields
        sa.Column('experience_points', sa.Integer, nullable=False, default=0),
        sa.Column('level', sa.Integer, nullable=False, default=1),
        sa.Column('current_streak', sa.Integer, nullable=False, default=0),
        sa.Column('longest_streak', sa.Integer, nullable=False, default=0),
        sa.Column('last_activity_date', sa.DateTime(timezone=True), nullable=True),
        
        # Financial profile
        sa.Column('monthly_income', sa.DECIMAL(15, 2), nullable=True),
        sa.Column('financial_goals_json', sa.JSON, nullable=True),
        sa.Column('risk_tolerance', sa.String(20), nullable=True),
        
        # Regional compliance fields
        sa.Column('country_code', sa.String(2), nullable=True),
        sa.Column('tax_residency', sa.String(2), nullable=True),
        sa.Column('kyc_status', sa.String(20), nullable=False, default='not_required'),
        sa.Column('kyc_verified_at', sa.DateTime(timezone=True), nullable=True),
        
        # Referral system
        sa.Column('referral_code', sa.String(10), nullable=True),
        sa.Column('referred_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
        sa.UniqueConstraint('referral_code'),
        sa.ForeignKeyConstraint(['referred_by_user_id'], ['users.id'], ),
    )
    
    # Create indexes for users table
    op.create_index('idx_users_email_active', 'users', ['email', 'is_active'])
    op.create_index('idx_users_status_role', 'users', ['status', 'role'])
    op.create_index('idx_users_referral_code', 'users', ['referral_code'])
    op.create_index('idx_users_country_currency', 'users', ['country_code', 'preferred_currency'])
    op.create_index('idx_users_last_login', 'users', ['last_login_at'])
    op.create_index('idx_users_created_status', 'users', ['created_at', 'status'])
    
    # Create refresh_tokens table
    op.create_table(
        'refresh_tokens',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token_hash', sa.String(255), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_revoked', sa.Boolean, nullable=False, default=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('device_info', sa.JSON, nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    
    # Create indexes for refresh_tokens table
    op.create_index('idx_refresh_tokens_user_active', 'refresh_tokens', ['user_id', 'is_revoked'])
    op.create_index('idx_refresh_tokens_expires', 'refresh_tokens', ['expires_at'])
    op.create_index('idx_refresh_tokens_hash', 'refresh_tokens', ['token_hash'])
    
    # Create user_sessions table
    op.create_table(
        'user_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('session_token', sa.String(255), nullable=False),
        sa.Column('ip_address', sa.String(45), nullable=False),
        sa.Column('user_agent', sa.Text, nullable=True),
        sa.Column('device_type', sa.String(50), nullable=True),
        sa.Column('browser', sa.String(100), nullable=True),
        sa.Column('operating_system', sa.String(100), nullable=True),
        sa.Column('location_country', sa.String(2), nullable=True),
        sa.Column('location_city', sa.String(100), nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, default=True),
        sa.Column('last_activity_at', sa.DateTime(timezone=True), nullable=False, default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('session_token'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    
    # Create indexes for user_sessions table
    op.create_index('idx_user_sessions_user_active', 'user_sessions', ['user_id', 'is_active'])
    op.create_index('idx_user_sessions_token', 'user_sessions', ['session_token'])
    op.create_index('idx_user_sessions_expires', 'user_sessions', ['expires_at'])
    op.create_index('idx_user_sessions_last_activity', 'user_sessions', ['last_activity_at'])
    
    # Create oauth_providers table
    op.create_table(
        'oauth_providers',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('provider_name', sa.String(50), nullable=False),
        sa.Column('provider_user_id', sa.String(255), nullable=False),
        sa.Column('provider_email', sa.String(255), nullable=True),
        sa.Column('provider_data', sa.JSON, nullable=True),
        sa.Column('access_token_hash', sa.String(255), nullable=True),
        sa.Column('refresh_token_hash', sa.String(255), nullable=True),
        sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, default=True),
        sa.Column('linked_at', sa.DateTime(timezone=True), nullable=False, default=sa.func.now()),
        
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    
    # Create indexes for oauth_providers table
    op.create_index('idx_oauth_providers_user', 'oauth_providers', ['user_id'])
    op.create_index('idx_oauth_providers_provider', 'oauth_providers', ['provider_name', 'provider_user_id'])
    op.create_index('idx_oauth_providers_unique', 'oauth_providers', ['provider_name', 'provider_user_id'], unique=True)
    
    # Create user_achievements table
    op.create_table(
        'user_achievements',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('achievement_type', sa.String(100), nullable=False),
        sa.Column('achievement_name', sa.String(200), nullable=False),
        sa.Column('achievement_description', sa.Text, nullable=True),
        sa.Column('badge_icon_url', sa.String(500), nullable=True),
        sa.Column('points_awarded', sa.Integer, nullable=False, default=0),
        sa.Column('earned_at', sa.DateTime(timezone=True), nullable=False, default=sa.func.now()),
        sa.Column('metadata', sa.JSON, nullable=True),
        
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    
    # Create indexes for user_achievements table
    op.create_index('idx_user_achievements_user', 'user_achievements', ['user_id'])
    op.create_index('idx_user_achievements_type', 'user_achievements', ['achievement_type'])
    op.create_index('idx_user_achievements_earned', 'user_achievements', ['earned_at'])
    op.create_index('idx_user_achievements_unique', 'user_achievements', ['user_id', 'achievement_type'], unique=True)
    
    # Create email_verification_tokens table
    op.create_table(
        'email_verification_tokens',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('token_hash', sa.String(255), nullable=False),
        sa.Column('token_type', sa.String(50), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_used', sa.Boolean, nullable=False, default=False),
        
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    
    # Create indexes for email_verification_tokens table
    op.create_index('idx_email_tokens_user', 'email_verification_tokens', ['user_id'])
    op.create_index('idx_email_tokens_hash', 'email_verification_tokens', ['token_hash'])
    op.create_index('idx_email_tokens_expires', 'email_verification_tokens', ['expires_at'])
    op.create_index('idx_email_tokens_type', 'email_verification_tokens', ['token_type'])


def downgrade() -> None:
    # Drop all tables in reverse order
    op.drop_table('email_verification_tokens')
    op.drop_table('user_achievements')
    op.drop_table('oauth_providers')
    op.drop_table('user_sessions')
    op.drop_table('refresh_tokens')
    op.drop_table('users')
    
    # Drop enum types
    op.execute('DROP TYPE IF EXISTS preferredcurrency')
    op.execute('DROP TYPE IF EXISTS preferredlanguage')
    op.execute('DROP TYPE IF EXISTS userrole')
    op.execute('DROP TYPE IF EXISTS userstatus')