"""
SQLAlchemy models for user functionality.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import enum

from sqlalchemy import (
    String,
    Text,
    Boolean,
    JSON,
    Integer,
    Enum as SQLEnum,
    DateTime,
    ForeignKey,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...database.base import BaseModel


def _utc_aware(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware (UTC).

    DB columns typed as TIMESTAMP WITHOUT TIME ZONE return naive datetimes
    even when the ORM model declares DateTime(timezone=True).  Normalise them
    before any comparison against datetime.now(timezone.utc).
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class UserStatus(enum.Enum):
    """User account status enumeration"""

    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    PENDING_VERIFICATION = "pending_verification"
    PENDING_APPROVAL = "pending_approval"


class UserRole(enum.Enum):
    """User role enumeration"""

    USER = "user"
    PREMIUM = "premium"
    MODERATOR = "moderator"
    ADMIN = "admin"


class PreferredLanguage(enum.Enum):
    """User preferred language enumeration"""

    EN = "en"
    ZH_TW = "zh-TW"
    ZH_CN = "zh-CN"
    JA = "ja"
    KO = "ko"


class PreferredCurrency(enum.Enum):
    """User preferred currency enumeration"""

    USD = "USD"
    TWD = "TWD"
    CNY = "CNY"
    JPY = "JPY"
    KRW = "KRW"
    SGD = "SGD"
    HKD = "HKD"


class User(BaseModel):
    """User model"""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[Optional[str]] = mapped_column(
        String(30), unique=True, nullable=True, index=True
    )
    hashed_password: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Account status and role
    status: Mapped[UserStatus] = mapped_column(
        SQLEnum(UserStatus), default=UserStatus.PENDING_VERIFICATION, nullable=False
    )
    role: Mapped[UserRole] = mapped_column(
        SQLEnum(UserRole), default=UserRole.USER, nullable=False
    )

    # OAuth fields
    google_id: Mapped[Optional[str]] = mapped_column(
        String(100), unique=True, nullable=True, index=True
    )

    # Account security
    failed_login_attempts: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    account_locked_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_ip: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)

    # Referral system
    referral_code: Mapped[Optional[str]] = mapped_column(
        String(20), unique=True, nullable=True, index=True
    )
    referred_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    # Soft delete
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # User preferences (stored as JSON)
    preferences: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True, default=dict
    )

    # Regional preferences for Asian markets
    preferred_language: Mapped[PreferredLanguage] = mapped_column(
        SQLEnum(PreferredLanguage), default=PreferredLanguage.EN, nullable=False
    )
    preferred_currency: Mapped[PreferredCurrency] = mapped_column(
        SQLEnum(PreferredCurrency),
        default=PreferredCurrency.TWD,
        server_default=PreferredCurrency.TWD.value,
        nullable=False,
    )
    timezone: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, default="UTC"
    )

    # Gamification streak tracking
    current_login_streak: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    longest_login_streak: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    last_streak_update: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Email verification tracking
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Gamification fields
    experience_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    level: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    # Profile information
    date_of_birth: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    occupation: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    monthly_income: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # in cents
    risk_tolerance: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True  # Use string instead of SQLEnum for flexibility
    )

    # NOTE: Complex relationships temporarily disabled to fix auth persistence issues
    # These can be re-enabled once the circular import issues are resolved
    #
    # # Relationships with other modules
    # transactions: Mapped[List["Transaction"]] = relationship(
    #     "Transaction",
    #     back_populates="user",
    #     cascade="all, delete-orphan"
    # )
    # goals: Mapped[List["Goal"]] = relationship(
    #     "Goal",
    #     back_populates="user",
    #     cascade="all, delete-orphan"
    # )
    # budgets: Mapped[List["Budget"]] = relationship(
    #     "Budget",
    #     back_populates="user",
    #     cascade="all, delete-orphan"
    # )
    # chat_sessions: Mapped[List["ChatSession"]] = relationship(
    #     "ChatSession",
    #     back_populates="user",
    #     cascade="all, delete-orphan"
    # )
    # notifications: Mapped[List["Notification"]] = relationship(
    #     "Notification",
    #     back_populates="user",
    #     cascade="all, delete-orphan"
    # )
    # notification_preferences: Mapped[List["NotificationPreference"]] = relationship(
    #     "NotificationPreference",
    #     back_populates="user",
    #     cascade="all, delete-orphan"
    # )

    # NOTE: User-specific relationships temporarily disabled for auth persistence fix
    # refresh_tokens: Mapped[List["RefreshToken"]] = relationship(
    #     "RefreshToken",
    #     back_populates="user",
    #     cascade="all, delete-orphan"
    # )
    # sessions: Mapped[List["UserSession"]] = relationship(
    #     "UserSession",
    #     back_populates="user",
    #     cascade="all, delete-orphan"
    # )
    # oauth_providers: Mapped[List["OAuthProvider"]] = relationship(
    #     "OAuthProvider",
    #     back_populates="user",
    #     cascade="all, delete-orphan"
    # )
    # achievements: Mapped[List["UserGamificationAchievement"]] = relationship(
    #     "UserGamificationAchievement",
    #     back_populates="user",
    #     cascade="all, delete-orphan"
    # )
    # goal_achievements: Mapped[List["UserAchievement"]] = relationship(
    #     "UserAchievement",
    #     cascade="all, delete-orphan"
    # )

    # NOTE: Referral relationships temporarily disabled for auth persistence fix
    # referrals: Mapped[List["User"]] = relationship(
    #     "User",
    #     foreign_keys="[User.referred_by_user_id]",
    #     remote_side="[User.id]",
    #     back_populates="referrer"
    # )
    # referrer: Mapped[Optional["User"]] = relationship(
    #     "User",
    #     foreign_keys="[User.referred_by_user_id]",
    #     back_populates="referrals"
    # )

    def __repr__(self):
        return f"<User(id={self.id}, email='{self.email}', name='{self.name}')>"

    @property
    def full_name(self) -> str:
        """Get user's full name"""
        return self.name

    def get_preference(self, key: str, default: Any = None) -> Any:
        """Get a user preference value"""
        if not self.preferences:
            return default
        return self.preferences.get(key, default)

    def set_preference(self, key: str, value: Any) -> None:
        """Set a user preference value"""
        if not self.preferences:
            self.preferences = {}
        self.preferences[key] = value

    @property
    def default_preferences(self) -> Dict[str, Any]:
        """Get default user preferences"""
        return {
            "currency": "USD",
            "language": "en",
            "locale": "en-US",
            "timezone": "UTC",
            "date_format": "western",
            "number_format": "western",
            "notifications": {
                "email": True,
                "push": True,
                "sms": False,
                "goal_reminders": True,
                "transaction_alerts": True,
            },
        }

    def initialize_preferences(self) -> None:
        """Initialize user preferences with defaults"""
        if not self.preferences:
            self.preferences = self.default_preferences.copy()

    @property
    def is_account_locked(self) -> bool:
        """Check if account is currently locked"""
        if self.account_locked_until is None:
            return False
        return datetime.now(timezone.utc) < _utc_aware(self.account_locked_until)


class RefreshToken(BaseModel):
    """Refresh token model for JWT authentication"""

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Session metadata
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationship (back_populates removed to avoid circular reference issues)
    user: Mapped["User"] = relationship("User")

    def __repr__(self):
        return f"<RefreshToken(id={self.id}, user_id={self.user_id}, active={self.is_active})>"

    @property
    def is_expired(self) -> bool:
        """Check if token is expired"""
        return datetime.now(timezone.utc) > _utc_aware(self.expires_at)


class UserSession(BaseModel):
    """User session model for tracking active sessions"""

    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    refresh_token_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("refresh_tokens.id"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Session metadata
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships (back_populates removed to avoid circular reference issues)
    user: Mapped["User"] = relationship("User")
    refresh_token: Mapped["RefreshToken"] = relationship("RefreshToken")

    def __repr__(self):
        return f"<UserSession(id={self.id}, user_id={self.user_id}, active={self.is_active})>"

    @property
    def is_expired(self) -> bool:
        """Check if session is expired"""
        return datetime.now(timezone.utc) > _utc_aware(self.expires_at)


class OAuthProvider(BaseModel):
    """OAuth provider linkage for users"""

    __tablename__ = "oauth_providers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # google, facebook, etc
    provider_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    provider_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationship
    user: Mapped["User"] = relationship("User")

    def __repr__(self):
        return f"<OAuthProvider(id={self.id}, user_id={self.user_id}, provider={self.provider})>"


class EmailVerificationToken(BaseModel):
    """Email verification token model"""

    __tablename__ = "email_verification_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Relationship
    user: Mapped["User"] = relationship("User")

    def __repr__(self):
        return f"<EmailVerificationToken(id={self.id}, user_id={self.user_id}, used={self.is_used})>"

    @property
    def is_expired(self) -> bool:
        """Check if token is expired"""
        return datetime.now(timezone.utc) > _utc_aware(self.expires_at)


class PasswordResetToken(BaseModel):
    """Password reset token model"""

    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Relationship
    user: Mapped["User"] = relationship("User")

    def __repr__(self):
        return f"<PasswordResetToken(id={self.id}, user_id={self.user_id}, used={self.is_used})>"

    @property
    def is_expired(self) -> bool:
        """Check if token is expired"""
        return datetime.now(timezone.utc) > _utc_aware(self.expires_at)


class AchievementType(enum.Enum):
    """Achievement type enumeration for Asian market gamification"""

    # Financial milestones
    FIRST_TRANSACTION = "first_transaction"
    HUNDRED_TRANSACTIONS = "hundred_transactions"
    THOUSAND_TRANSACTIONS = "thousand_transactions"
    FIRST_GOAL = "first_goal"
    GOAL_COMPLETED = "goal_completed"
    FIVE_GOALS_COMPLETED = "five_goals_completed"

    # Savings achievements
    FIRST_SAVINGS_MILESTONE = "first_savings_milestone"
    EMERGENCY_FUND_BUILT = "emergency_fund_built"
    INVESTMENT_STARTER = "investment_starter"
    DIVERSIFIED_PORTFOLIO = "diversified_portfolio"

    # Engagement achievements
    DAILY_LOGIN_STREAK_7 = "daily_login_streak_7"
    DAILY_LOGIN_STREAK_30 = "daily_login_streak_30"
    DAILY_LOGIN_STREAK_100 = "daily_login_streak_100"
    EXPENSE_TRACKER = "expense_tracker"

    # Regional achievements for Asian markets
    QR_PAYMENT_MASTER = "qr_payment_master"  # For QR payment adoption
    DIGITAL_WALLET_USER = "digital_wallet_user"  # For e-wallet usage
    LOCAL_INVESTMENT_EXPLORER = "local_investment_explorer"  # CPF, gold savings etc
    MULTI_CURRENCY_TRACKER = "multi_currency_tracker"  # Multiple currency tracking
    FAMILY_SAVER = "family_saver"  # Family-oriented savings goals
    LUNAR_NEW_YEAR_SAVER = "lunar_new_year_saver"  # Cultural event savings

    # Social achievements
    REFERRAL_CHAMPION = "referral_champion"
    COMMUNITY_HELPER = "community_helper"
    EARLY_ADOPTER = "early_adopter"

    # Educational achievements
    FINANCIAL_LITERACY = "financial_literacy"
    RISK_ASSESSMENT_COMPLETE = "risk_assessment_complete"
    INVESTMENT_COURSE_COMPLETE = "investment_course_complete"


class AchievementRarity(enum.Enum):
    """Achievement rarity levels"""

    COMMON = "common"
    RARE = "rare"
    EPIC = "epic"
    LEGENDARY = "legendary"


class UserGamificationAchievement(BaseModel):
    """User gamification achievement model for engagement system"""

    __tablename__ = "user_gamification_achievements"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    achievement_type: Mapped[AchievementType] = mapped_column(
        SQLEnum(AchievementType), nullable=False
    )
    achievement_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    points_awarded: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rarity: Mapped[AchievementRarity] = mapped_column(
        SQLEnum(AchievementRarity), default=AchievementRarity.COMMON, nullable=False
    )
    unlocked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    # Relationship
    user: Mapped["User"] = relationship("User")

    def __repr__(self):
        return f"<UserGamificationAchievement(id={self.id}, user_id={self.user_id}, type={self.achievement_type})>"


class UserActivityLog(BaseModel):
    """User activity logging for engagement tracking and analytics"""

    __tablename__ = "user_activity_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    activity_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    activity_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    session_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, index=True
    )
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationship
    user: Mapped["User"] = relationship("User")

    def __repr__(self):
        return f"<UserActivityLog(id={self.id}, user_id={self.user_id}, type={self.activity_type})>"


class UserDataExport(BaseModel):
    """User data export requests for GDPR compliance"""

    __tablename__ = "user_data_exports"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    request_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="full_export",  # full_export, data_portability, gdpr_request
    )
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="pending",  # pending, processing, completed, failed
    )
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # in bytes
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    download_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relationship
    user: Mapped["User"] = relationship("User")

    def __repr__(self):
        return f"<UserDataExport(id={self.id}, user_id={self.user_id}, status={self.status})>"

    @property
    def is_expired(self) -> bool:
        """Check if export file is expired"""
        if self.expires_at is None:
            return False
        return datetime.now(timezone.utc) > _utc_aware(self.expires_at)


class UserSecurityLog(BaseModel):
    """Security event logging for audit and compliance"""

    __tablename__ = "user_security_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,  # Can be null for failed login attempts
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    event_description: Mapped[str] = mapped_column(Text, nullable=False)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    risk_level: Mapped[str] = mapped_column(
        String(20), nullable=False, default="low"  # low, medium, high, critical
    )
    event_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )

    # Relationship
    user: Mapped[Optional["User"]] = relationship("User")

    def __repr__(self):
        return f"<UserSecurityLog(id={self.id}, user_id={self.user_id}, event={self.event_type})>"


class UserPreferenceHistory(BaseModel):
    """Track user preference changes for analytics and compliance"""

    __tablename__ = "user_preference_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    preference_key: Mapped[str] = mapped_column(String(100), nullable=False)
    old_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    new_value: Mapped[str] = mapped_column(Text, nullable=False)
    changed_by: Mapped[str] = mapped_column(
        String(20), nullable=False, default="user"  # user, admin, system
    )
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Relationship
    user: Mapped["User"] = relationship("User")

    def __repr__(self):
        return f"<UserPreferenceHistory(id={self.id}, user_id={self.user_id}, key={self.preference_key})>"
