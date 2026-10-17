"""
Notification models for SQLAlchemy 2.0 in the Aspiro personal finance application.
"""

import uuid
from datetime import datetime, timezone


def _utc_aware(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware (UTC).
    DB TIMESTAMP WITHOUT TIME ZONE columns return naive datetimes even when
    the ORM model declares DateTime(timezone=True); normalise before comparison.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
from typing import Optional
from sqlalchemy import String, Text, DateTime, Boolean, ForeignKey, Index, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from ...database.base import BaseModel, JSONType
import enum


class NotificationType(str, enum.Enum):
    """Notification type enumeration"""

    TRANSACTION_REMINDER = "transaction_reminder"
    ACHIEVEMENT_UNLOCKED = "achievement_unlocked"
    INVESTMENT_ALERT = "investment_alert"
    SECURITY_ALERT = "security_alert"
    SYSTEM_UPDATE = "system_update"
    PAYMENT_DUE = "payment_due"
    RECURRING_TRANSACTION = "recurring_transaction"
    MARKET_UPDATE = "market_update"


class NotificationPriority(str, enum.Enum):
    """Notification priority enumeration"""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class NotificationStatus(str, enum.Enum):
    """Notification status enumeration"""

    PENDING = "pending"
    SENT = "sent"
    READ = "read"
    DISMISSED = "dismissed"
    FAILED = "failed"


class NotificationChannel(str, enum.Enum):
    """Notification delivery channel enumeration"""

    IN_APP = "in_app"
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"
    WEBHOOK = "webhook"


class Notification(BaseModel):
    """Notification model"""

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    type: Mapped[NotificationType] = mapped_column(
        SQLEnum(NotificationType), nullable=False
    )
    priority: Mapped[NotificationPriority] = mapped_column(
        SQLEnum(NotificationPriority),
        nullable=False,
        default=NotificationPriority.MEDIUM,
    )
    status: Mapped[NotificationStatus] = mapped_column(
        SQLEnum(NotificationStatus), nullable=False, default=NotificationStatus.PENDING
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    # Optional data payload for dynamic content
    data: Mapped[Optional[dict]] = mapped_column(JSONType, default=dict)

    # Delivery channels
    channels: Mapped[list] = mapped_column(
        JSONType, default=list
    )  # List of NotificationChannel values

    # Timestamps
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=None)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=None)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=None)
    dismissed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=None)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=None)

    # Delivery tracking
    delivery_attempts: Mapped[int] = mapped_column(nullable=False, default=0)
    max_delivery_attempts: Mapped[int] = mapped_column(nullable=False, default=3)
    delivery_error: Mapped[Optional[str]] = mapped_column(Text, default=None)

    # Related entity references
    related_entity_type: Mapped[Optional[str]] = mapped_column(
        String(50), default=None
    )  # e.g., "goal", "budget", "transaction"
    related_entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), default=None
    )

    # Action URLs and metadata
    action_url: Mapped[Optional[str]] = mapped_column(String(500), default=None)
    action_label: Mapped[Optional[str]] = mapped_column(String(100), default=None)

    # Localization
    language: Mapped[str] = mapped_column(String(5), nullable=False, default="en")

    # Grouping and categorization
    category: Mapped[Optional[str]] = mapped_column(String(50), default=None)
    group_key: Mapped[Optional[str]] = mapped_column(
        String(100), default=None
    )  # For grouping similar notifications

    # User interaction flags
    is_actionable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_persistent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_system_notification: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # Relationships
    user: Mapped["User"] = relationship("User")

    __table_args__ = (
        Index("idx_notifications_user_id", "user_id"),
        Index("idx_notifications_user_status", "user_id", "status"),
        Index("idx_notifications_user_created", "user_id", "created_at"),
        Index("idx_notifications_scheduled_at", "scheduled_at"),
        Index("idx_notifications_expires_at", "expires_at"),
    )

    @property
    def is_expired(self) -> bool:
        """Check if notification has expired"""
        if not self.expires_at:
            return False
        return datetime.now(timezone.utc) > _utc_aware(self.expires_at)

    @property
    def is_read(self) -> bool:
        """Check if notification has been read"""
        return self.status == NotificationStatus.READ

    @property
    def is_dismissed(self) -> bool:
        """Check if notification has been dismissed"""
        return self.status == NotificationStatus.DISMISSED

    @property
    def can_retry_delivery(self) -> bool:
        """Check if delivery can be retried"""
        return (
            self.status == NotificationStatus.FAILED
            and self.delivery_attempts < self.max_delivery_attempts
            and not self.is_expired
        )


class NotificationTemplate(BaseModel):
    """Notification template model for reusable notification content"""

    __tablename__ = "notification_templates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    template_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)

    type: Mapped[NotificationType] = mapped_column(
        SQLEnum(NotificationType), nullable=False
    )
    priority: Mapped[NotificationPriority] = mapped_column(
        SQLEnum(NotificationPriority),
        nullable=False,
        default=NotificationPriority.MEDIUM,
    )

    # Template content with placeholders
    title_template: Mapped[str] = mapped_column(String(200), nullable=False)
    message_template: Mapped[str] = mapped_column(Text, nullable=False)

    # Default channels and settings
    default_channels: Mapped[list] = mapped_column(JSONType, default=list)
    default_expires_hours: Mapped[Optional[int]] = mapped_column(default=None)

    # Template metadata
    variables: Mapped[Optional[dict]] = mapped_column(
        JSONType, default=dict
    )  # Required template variables
    category: Mapped[Optional[str]] = mapped_column(String(50), default=None)

    # Localization
    supported_languages: Mapped[list] = mapped_column(JSONType, default=["en"])
    localized_content: Mapped[Optional[dict]] = mapped_column(JSONType, default=dict)

    # Template status
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    usage_count: Mapped[int] = mapped_column(nullable=False, default=0)

    # Action configuration
    action_url_template: Mapped[Optional[str]] = mapped_column(
        String(500), default=None
    )
    action_label: Mapped[Optional[str]] = mapped_column(String(100), default=None)
    is_actionable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_persistent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class NotificationPreference(BaseModel):
    """User notification preferences model"""

    __tablename__ = "notification_preferences"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    # Channel preferences
    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sms_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    push_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    in_app_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Type-specific preferences
    transaction_alerts: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    investment_alerts: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    achievement_notifications: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    security_alerts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    system_updates: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    marketing_notifications: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # Timing preferences
    quiet_hours_start: Mapped[Optional[str]] = mapped_column(
        String(5), default="22:00"
    )  # HH:MM format
    quiet_hours_end: Mapped[Optional[str]] = mapped_column(
        String(5), default="08:00"
    )  # HH:MM format
    timezone: Mapped[str] = mapped_column(String(50), nullable=False, default="UTC")

    # Frequency limits
    max_daily_notifications: Mapped[int] = mapped_column(nullable=False, default=10)
    digest_frequency: Mapped[str] = mapped_column(
        String(20), nullable=False, default="daily"
    )  # daily, weekly, monthly

    # Contact information
    email_address: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    phone_number: Mapped[Optional[str]] = mapped_column(String(20), default=None)

    # Relationships
    user: Mapped["User"] = relationship("User")

    __table_args__ = (
        Index("idx_notification_preferences_user_id", "user_id", unique=True),
    )
