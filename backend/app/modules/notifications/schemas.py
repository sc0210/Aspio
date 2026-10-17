"""
Pydantic schemas for notification-related operations in the Aspiro personal finance application.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict
from uuid import UUID

from .models import (
    NotificationType,
    NotificationPriority,
    NotificationStatus,
    NotificationChannel,
)


# ===== Base Schemas =====


class NotificationBase(BaseModel):
    """Base schema for notifications"""

    type: NotificationType
    title: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1)
    priority: NotificationPriority = NotificationPriority.MEDIUM
    data: Optional[Dict[str, Any]] = Field(default_factory=dict)
    channels: List[NotificationChannel] = Field(default_factory=list)
    language: str = Field(default="en", min_length=2, max_length=5)
    category: Optional[str] = None
    is_actionable: bool = False
    is_persistent: bool = False
    action_url: Optional[str] = None
    action_label: Optional[str] = None
    expires_at: Optional[datetime] = None


# ===== Request Schemas =====


class NotificationCreateRequest(NotificationBase):
    """Request schema for creating a notification"""

    user_id: Optional[UUID] = None  # Optional - can be set by service
    scheduled_at: Optional[datetime] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[UUID] = None
    group_key: Optional[str] = None


class NotificationUpdateRequest(BaseModel):
    """Request schema for updating notification status"""

    status: Optional[NotificationStatus] = None
    read_at: Optional[datetime] = None
    dismissed_at: Optional[datetime] = None


class BulkNotificationActionRequest(BaseModel):
    """Request schema for bulk notification actions"""

    notification_ids: List[UUID] = Field(min_length=1, max_length=100)
    action: str = Field(pattern="^(mark_read|mark_unread|dismiss|delete)$")


class NotificationTemplateCreateRequest(BaseModel):
    """Request schema for creating notification templates"""

    template_key: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    type: NotificationType
    priority: NotificationPriority = NotificationPriority.MEDIUM
    title_template: str = Field(min_length=1, max_length=200)
    message_template: str = Field(min_length=1)
    default_channels: List[NotificationChannel] = Field(default_factory=list)
    default_expires_hours: Optional[int] = Field(None, ge=1, le=8760)  # Max 1 year
    variables: Optional[Dict[str, str]] = Field(default_factory=dict)
    category: Optional[str] = None
    supported_languages: List[str] = Field(default=["en"])
    localized_content: Optional[Dict[str, Dict[str, str]]] = Field(default_factory=dict)
    action_url_template: Optional[str] = None
    action_label: Optional[str] = None
    is_actionable: bool = False
    is_persistent: bool = False


class NotificationPreferencesUpdateRequest(BaseModel):
    """Request schema for updating notification preferences"""

    email_enabled: Optional[bool] = None
    sms_enabled: Optional[bool] = None
    push_enabled: Optional[bool] = None
    in_app_enabled: Optional[bool] = None
    transaction_alerts: Optional[bool] = None
    investment_alerts: Optional[bool] = None
    achievement_notifications: Optional[bool] = None
    security_alerts: Optional[bool] = None
    system_updates: Optional[bool] = None
    marketing_notifications: Optional[bool] = None
    quiet_hours_start: Optional[str] = Field(
        None, pattern="^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$"
    )
    quiet_hours_end: Optional[str] = Field(
        None, pattern="^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$"
    )
    timezone: Optional[str] = None
    max_daily_notifications: Optional[int] = Field(None, ge=1, le=100)
    digest_frequency: Optional[str] = Field(None, pattern="^(daily|weekly|monthly)$")
    email_address: Optional[str] = None
    phone_number: Optional[str] = None


# ===== Response Schemas =====


class NotificationResponse(NotificationBase):
    """Response schema for notifications"""

    id: UUID
    user_id: UUID
    status: NotificationStatus
    scheduled_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    read_at: Optional[datetime] = None
    dismissed_at: Optional[datetime] = None
    delivery_attempts: int
    delivery_error: Optional[str] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[UUID] = None
    group_key: Optional[str] = None
    is_expired: bool
    is_read: bool
    is_dismissed: bool
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class NotificationListResponse(BaseModel):
    """Response schema for notification list"""

    id: UUID
    type: NotificationType
    title: str
    message: str
    priority: NotificationPriority
    status: NotificationStatus
    is_read: bool
    is_actionable: bool
    action_url: Optional[str] = None
    action_label: Optional[str] = None
    created_at: datetime
    expires_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class NotificationTemplateResponse(BaseModel):
    """Response schema for notification templates"""

    id: UUID
    template_key: str
    name: str
    description: Optional[str] = None
    type: NotificationType
    priority: NotificationPriority
    title_template: str
    message_template: str
    default_channels: List[NotificationChannel]
    default_expires_hours: Optional[int] = None
    variables: Optional[Dict[str, str]] = None
    category: Optional[str] = None
    supported_languages: List[str]
    localized_content: Optional[Dict[str, Dict[str, str]]] = None
    action_url_template: Optional[str] = None
    action_label: Optional[str] = None
    is_actionable: bool
    is_persistent: bool
    is_active: bool
    usage_count: int
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class NotificationPreferencesResponse(BaseModel):
    """Response schema for notification preferences"""

    id: UUID
    user_id: UUID
    email_enabled: bool
    sms_enabled: bool
    push_enabled: bool
    in_app_enabled: bool
    transaction_alerts: bool
    investment_alerts: bool
    achievement_notifications: bool
    security_alerts: bool
    system_updates: bool
    marketing_notifications: bool
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None
    timezone: str
    max_daily_notifications: int
    digest_frequency: str
    email_address: Optional[str] = None
    phone_number: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class NotificationStatsResponse(BaseModel):
    """Response schema for notification statistics"""

    total_notifications: int
    unread_notifications: int
    read_notifications: int
    dismissed_notifications: int
    expired_notifications: int
    failed_notifications: int
    notifications_by_type: Dict[str, int]
    notifications_by_priority: Dict[str, int]
    recent_notifications: List[NotificationListResponse]
    model_config = ConfigDict(from_attributes=True)


# ===== Filter and Query Schemas =====


class NotificationFilterParams(BaseModel):
    """Query parameters for filtering notifications"""

    type: Optional[NotificationType] = None
    priority: Optional[NotificationPriority] = None
    status: Optional[NotificationStatus] = None
    is_read: Optional[bool] = None
    is_actionable: Optional[bool] = None
    category: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    related_entity_type: Optional[str] = None
    search: Optional[str] = None


class NotificationSortParams(BaseModel):
    """Query parameters for sorting notifications"""

    sort_by: str = Field(
        default="created_at", pattern="^(created_at|priority|type|status|title)$"
    )
    sort_order: str = Field(default="desc", pattern="^(asc|desc)$")


# ===== Utility Schemas =====


