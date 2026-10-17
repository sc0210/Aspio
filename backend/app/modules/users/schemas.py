"""
Pydantic schemas for user API endpoints.
"""

import uuid
from datetime import datetime, date
from typing import Optional, Dict, Any, List

from pydantic import BaseModel, Field, EmailStr, ConfigDict, field_validator

from ...common.schemas import BaseSchema, TimestampMixin


class UserPreferences(BaseModel):
    """User preferences schema"""
    currency: str = Field("USD", description="Default currency")
    language: str = Field("en", description="Language preference")
    locale: str = Field("en-US", description="Locale preference")
    timezone: str = Field("UTC", description="Timezone preference")
    date_format: str = Field("western", pattern="^(western|roc|iso)$", description="Date format preference")
    number_format: str = Field("western", pattern="^(western|asian)$", description="Number format preference")
    notifications: Dict[str, bool] = Field(
        default_factory=lambda: {
            "email": True,
            "push": True,
            "sms": False,
            "goal_reminders": True,
            "transaction_alerts": True
        },
        description="Notification preferences"
    )


class UserBase(BaseSchema):
    """Base user schema"""
    email: EmailStr = Field(..., description="User email address")
    name: str = Field(..., min_length=1, max_length=255, description="User full name")
    avatar_url: Optional[str] = Field(None, max_length=500, description="Avatar image URL")


class UserCreate(UserBase):
    """Schema for creating a user"""
    password: str = Field(..., min_length=8, max_length=128, description="User password")
    confirm_password: str = Field(..., description="Password confirmation")
    preferences: Optional[UserPreferences] = Field(None, description="User preferences")
    
    @field_validator("confirm_password")
    @classmethod
    def passwords_match(cls, v, values):
        if 'password' in values.data and v != values.data['password']:
            raise ValueError('Passwords do not match')
        return v


class UserUpdate(BaseModel):
    """Schema for updating a user"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    username: Optional[str] = Field(None, min_length=3, max_length=30, pattern=r"^[a-zA-Z0-9_]+$")
    avatar_url: Optional[str] = Field(None, max_length=500)
    date_of_birth: Optional[date] = None
    occupation: Optional[str] = Field(None, max_length=255)
    monthly_income: Optional[float] = Field(None, ge=0, description="Monthly income in dollars")
    risk_tolerance: Optional[str] = Field(None, pattern="^(conservative|moderate|aggressive)$")
    preferences: Optional[UserPreferences] = None


class UserProfile(BaseModel):
    """User profile information"""
    model_config = ConfigDict(from_attributes=True)
    
    date_of_birth: Optional[date]
    occupation: Optional[str]
    monthly_income: Optional[float] = None  # converted from cents to dollars
    risk_tolerance: Optional[str]


class UserResponse(UserBase, TimestampMixin):
    """Schema for user response"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    is_active: bool
    is_verified: bool
    experience_points: int = 0
    level: int = 1
    preferences: Optional[Dict[str, Any]] = None
    profile: Optional[UserProfile] = None
    
    @field_validator("preferences", mode="before")
    @classmethod
    def ensure_preferences(cls, v):
        """Ensure preferences are properly formatted"""
        if v is None:
            return {}
        return v
    
    # Additional regional fields for Asian markets
    preferred_language: Optional[str] = Field("en", description="User's preferred language")
    preferred_currency: Optional[str] = Field("TWD", description="User's preferred currency")
    timezone: Optional[str] = Field("UTC", description="User's timezone")
    current_login_streak: int = Field(0, description="Current login streak")
    longest_login_streak: int = Field(0, description="Longest login streak achieved")


class LoginRequest(BaseModel):
    """Schema for user login request"""
    email: EmailStr = Field(..., description="User email")
    password: str = Field(..., description="User password")
    remember_me: bool = Field(False, description="Keep user logged in longer")


class LoginResponse(BaseModel):
    """Schema for login response"""
    success: bool = Field(True, description="Login success status")
    access_token: str = Field(..., description="JWT access token")
    refresh_token: str = Field(..., description="JWT refresh token")
    token_type: str = Field("bearer", description="Token type")
    expires_in: int = Field(..., description="Token expiration time in seconds")
    user: UserResponse = Field(..., description="User information")


class UserRegistration(UserCreate):
    """Schema for user registration (extends UserCreate)"""
    terms_accepted: bool = Field(..., description="Terms and conditions acceptance")
    referral_code: Optional[str] = Field(None, description="Referral code")
    
    @field_validator("terms_accepted")
    @classmethod
    def terms_must_be_accepted(cls, v):
        if not v:
            raise ValueError('Terms and conditions must be accepted')
        return v


class ResendVerificationRequest(BaseModel):
    """Schema for resending verification email"""
    email: EmailStr = Field(..., description="Email address")


class ForgotPasswordRequest(BaseModel):
    """Schema for forgot password request"""
    email: EmailStr = Field(..., description="Email address")


class ResetPasswordRequest(BaseModel):
    """Schema for password reset"""
    token: str = Field(..., description="Reset token")
    new_password: str = Field(..., min_length=8, max_length=128, description="New password")
    confirm_password: str = Field(..., description="Password confirmation")
    
    @field_validator("confirm_password")
    @classmethod
    def passwords_match(cls, v, values):
        if 'new_password' in values.data and v != values.data['new_password']:
            raise ValueError('Passwords do not match')
        return v


# Additional schemas referenced in router
class TokenRefreshRequest(BaseModel):
    """Schema for token refresh request"""
    refresh_token: str = Field(..., description="Refresh token")


class TokenRefreshResponse(BaseModel):
    """Schema for token refresh response"""
    access_token: str = Field(..., description="New JWT access token")
    refresh_token: str = Field(..., description="New JWT refresh token")
    token_type: str = Field("bearer", description="Token type")
    expires_in: int = Field(..., description="Token expiration time in seconds")


class LogoutRequest(BaseModel):
    """Schema for logout request"""
    refresh_token: str = Field(..., description="Refresh token to revoke")
    logout_all_devices: bool = Field(False, description="Logout from all devices")


class ChangePasswordRequest(BaseModel):
    """Schema for password change request"""
    current_password: str = Field(..., description="Current password")
    new_password: str = Field(..., min_length=8, max_length=128, description="New password")
    confirm_new_password: str = Field(..., description="New password confirmation")
    
    @field_validator("confirm_new_password")
    @classmethod
    def passwords_match(cls, v, values):
        if 'new_password' in values.data and v != values.data['new_password']:
            raise ValueError('New passwords do not match')
        return v


class VerifyEmailRequest(BaseModel):
    """Schema for email verification with token"""
    token: str = Field(..., description="Verification token")


class GoogleOAuthRequest(BaseModel):
    """Schema for Google OAuth request"""
    authorization_code: str = Field(..., description="Google authorization code")
    redirect_uri: Optional[str] = Field(None, description="OAuth redirect URI")


class GoogleCallbackRequest(BaseModel):
    """Schema for Google OAuth callback from NextAuth"""
    code: str = Field(..., description="Google access token from NextAuth")
    email: str = Field(..., description="User email from Google")
    name: Optional[str] = Field(None, description="User name from Google")
    picture: Optional[str] = Field(None, description="User profile picture URL")
    id: str = Field(..., description="Google provider account ID")
    verified_email: bool = Field(True, description="Email verification status")


class GoogleCallbackResponse(BaseModel):
    """Schema for Google OAuth callback response"""
    success: bool = Field(True, description="Callback success status")
    access_token: str = Field(..., description="JWT access token")
    refresh_token: str = Field(..., description="JWT refresh token")
    token_type: str = Field("bearer", description="Token type")
    expires_in: int = Field(..., description="Token expiration time in seconds")
    user: UserResponse = Field(..., description="User information")
    is_new_user: bool = Field(..., description="Whether this is a new user registration")


class GoogleOAuthResponse(BaseModel):
    """Schema for Google OAuth response"""
    success: bool = Field(True, description="OAuth success status")
    access_token: str = Field(..., description="JWT access token")
    refresh_token: str = Field(..., description="JWT refresh token")
    token_type: str = Field("bearer", description="Token type")
    expires_in: int = Field(..., description="Token expiration time in seconds")
    user: UserResponse = Field(..., description="User information")
    is_new_user: bool = Field(..., description="Whether this is a new user registration")


class UserProfileResponse(UserResponse):
    """Extended user profile response with additional details"""
    model_config = ConfigDict(from_attributes=True)
    
    # Additional profile data
    last_login_at: Optional[datetime] = None
    account_age_days: Optional[int] = None
    total_sessions: int = 0
    achievements_count: int = 0
    referral_count: int = 0


class UserStatsResponse(BaseModel):
    """User statistics response"""
    total_users: int = Field(..., description="Total number of users")
    active_users: int = Field(..., description="Number of active users")
    verified_users: int = Field(..., description="Number of verified users")
    new_users_today: int = Field(..., description="New users registered today")
    new_users_this_week: int = Field(..., description="New users registered this week")
    new_users_this_month: int = Field(..., description="New users registered this month")
    users_by_country: Dict[str, int] = Field(default_factory=dict, description="User count by country")
    users_by_currency: Dict[str, int] = Field(default_factory=dict, description="User count by preferred currency")
    average_level: float = Field(0.0, description="Average user level")
    total_experience_points: int = Field(0, description="Total experience points across all users")


# ===== Gamification Schemas =====

class AchievementResponse(BaseModel):
    """User achievement response schema"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    user_id: uuid.UUID
    achievement_type: str
    achievement_data: Optional[Dict[str, Any]] = None
    points_awarded: int
    rarity: str
    unlocked_at: datetime
    
    # Achievement metadata (computed fields)
    title: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    category: Optional[str] = None


class UserStreakInfo(BaseModel):
    """User streak information"""
    current_login_streak: int = Field(0, description="Current consecutive login days")
    longest_login_streak: int = Field(0, description="Longest login streak achieved")
    last_streak_update: Optional[datetime] = None
    streak_bonus_earned: int = Field(0, description="Total bonus points from streaks")


class UserGamificationStats(BaseModel):
    """Comprehensive user gamification statistics"""
    model_config = ConfigDict(from_attributes=True)
    
    user_id: uuid.UUID
    level: int
    experience_points: int
    experience_to_next_level: int
    total_achievements: int
    achievements_by_rarity: Dict[str, int] = Field(default_factory=dict)
    streak_info: UserStreakInfo
    recent_achievements: List[AchievementResponse] = Field(default_factory=list)
    
    # Regional gamification metrics
    digital_adoption_score: int = Field(0, description="Score for digital payment adoption")
    savings_discipline_score: int = Field(0, description="Score for consistent savings")
    investment_knowledge_score: int = Field(0, description="Score for investment education")
    community_engagement_score: int = Field(0, description="Score for community features")


class AchievementProgressResponse(BaseModel):
    """Achievement progress tracking for user engagement"""
    achievement_type: str
    title: str
    description: str
    category: str
    icon: str
    rarity: str
    points_reward: int
    current_progress: int
    required_progress: int
    progress_percentage: float
    is_unlocked: bool
    unlocked_at: Optional[datetime] = None
    tips: List[str] = Field(default_factory=list, description="Tips to achieve this")


# ===== User Activity and Analytics Schemas =====

class UserActivityRequest(BaseModel):
    """Request schema for logging user activities"""
    activity_type: str = Field(..., description="Type of activity")
    activity_data: Optional[Dict[str, Any]] = Field(None, description="Additional activity data")
    session_id: Optional[str] = Field(None, description="Session identifier")


class UserActivityResponse(BaseModel):
    """User activity response schema"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    user_id: uuid.UUID
    activity_type: str
    activity_data: Optional[Dict[str, Any]] = None
    session_id: Optional[str] = None
    created_at: datetime


class UserEngagementMetrics(BaseModel):
    """User engagement analytics"""
    user_id: uuid.UUID
    total_sessions: int
    average_session_duration: float  # in minutes
    last_active: Optional[datetime] = None
    features_used: List[str] = Field(default_factory=list)
    daily_engagement_score: float
    weekly_engagement_score: float
    monthly_engagement_score: float
    engagement_trend: str = Field(..., pattern="^(increasing|stable|decreasing)$")


# ===== Data Privacy and Compliance Schemas =====

class DataExportRequest(BaseModel):
    """GDPR data export request"""
    export_type: str = Field(
        "full_export", 
        pattern="^(full_export|data_portability|specific_data)$",
        description="Type of data export requested"
    )
    data_categories: Optional[List[str]] = Field(
        None,
        description="Specific data categories if export_type is 'specific_data'"
    )
    format: str = Field(
        "json", 
        pattern="^(json|csv|pdf)$",
        description="Export format preference"
    )


class DataExportResponse(BaseModel):
    """Data export response"""
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    user_id: uuid.UUID
    request_type: str
    status: str
    file_path: Optional[str] = None
    file_size: Optional[int] = None
    expires_at: Optional[datetime] = None
    download_count: int = 0
    created_at: datetime
    completed_at: Optional[datetime] = None


# ===== Regional and Localization Schemas =====

class RegionalPreferencesUpdate(BaseModel):
    """Update regional preferences for Asian markets"""
    preferred_language: Optional[str] = Field(
        None, 
        pattern="^(en|zh-TW|zh-CN|ja|ko|th|vi|id|ms)$",
        description="Preferred language code"
    )
    preferred_currency: Optional[str] = Field(
        None,
        # Offered account defaults, trimmed to the two common currencies for our
        # users. A subset of the PreferredCurrency DB enum (users/models.py),
        # which still holds JPY/HKD/SGD/CNY/KRW for any legacy rows.
        pattern="^(USD|TWD)$",
        description="Preferred currency code"
    )
    timezone: Optional[str] = Field(None, description="Preferred timezone")
    date_format: Optional[str] = Field(
        None,
        pattern="^(western|roc|iso|lunar)$",
        description="Date format preference including lunar calendar"
    )
    number_format: Optional[str] = Field(
        None,
        pattern="^(western|asian|chinese)$",
        description="Number format preference"
    )
    cultural_calendar: Optional[str] = Field(
        None,
        pattern="^(gregorian|lunar|fiscal|academic)$",
        description="Calendar system preference"
    )
    payment_methods: Optional[List[str]] = Field(
        None,
        description="Preferred payment methods (e.g., 'wechat_pay', 'alipay', 'grab_pay')"
    )


# ===== Enhanced Security Schemas =====

