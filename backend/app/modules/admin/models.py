"""
Admin models for Aspiro backend.

Provides role-based access control, audit logging, and administrative functions.
"""

from datetime import datetime, timezone
from enum import Enum
from sqlalchemy import Column, String, Boolean, DateTime, Integer, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid

from app.database.base import Base, JSONType


class AdminRole(str, Enum):
    """Admin role levels"""

    SUPER_ADMIN = "super_admin"  # Full system access
    ADMIN = "admin"  # User management, content moderation
    MODERATOR = "moderator"  # Content moderation only
    ANALYST = "analyst"  # Read-only analytics access
    SUPPORT = "support"  # Customer support access


class AdminPermission(str, Enum):
    """Granular admin permissions"""

    # User management
    VIEW_USERS = "view_users"
    EDIT_USERS = "edit_users"
    DELETE_USERS = "delete_users"
    IMPERSONATE_USERS = "impersonate_users"

    # System management
    VIEW_SYSTEM_STATS = "view_system_stats"
    MANAGE_SETTINGS = "manage_settings"
    VIEW_LOGS = "view_logs"
    EXPORT_DATA = "export_data"

    # Financial data
    VIEW_ALL_PORTFOLIOS = "view_all_portfolios"
    EDIT_ALL_PORTFOLIOS = "edit_all_portfolios"
    VIEW_ALL_TRANSACTIONS = "view_all_transactions"

    # Content moderation
    MODERATE_CONTENT = "moderate_content"
    BAN_USERS = "ban_users"

    # Analytics
    VIEW_ANALYTICS = "view_analytics"
    EXPORT_REPORTS = "export_reports"


# Role to permission mapping
ROLE_PERMISSIONS = {
    AdminRole.SUPER_ADMIN: [p for p in AdminPermission],  # All permissions
    AdminRole.ADMIN: [
        AdminPermission.VIEW_USERS,
        AdminPermission.EDIT_USERS,
        AdminPermission.DELETE_USERS,
        AdminPermission.VIEW_SYSTEM_STATS,
        AdminPermission.MANAGE_SETTINGS,
        AdminPermission.VIEW_LOGS,
        AdminPermission.VIEW_ALL_PORTFOLIOS,
        AdminPermission.VIEW_ALL_TRANSACTIONS,
        AdminPermission.MODERATE_CONTENT,
        AdminPermission.BAN_USERS,
        AdminPermission.VIEW_ANALYTICS,
        AdminPermission.EXPORT_REPORTS,
    ],
    AdminRole.MODERATOR: [
        AdminPermission.VIEW_USERS,
        AdminPermission.MODERATE_CONTENT,
        AdminPermission.BAN_USERS,
    ],
    AdminRole.ANALYST: [
        AdminPermission.VIEW_USERS,
        AdminPermission.VIEW_SYSTEM_STATS,
        AdminPermission.VIEW_LOGS,
        AdminPermission.VIEW_ALL_PORTFOLIOS,
        AdminPermission.VIEW_ALL_TRANSACTIONS,
        AdminPermission.VIEW_ANALYTICS,
        AdminPermission.EXPORT_REPORTS,
    ],
    AdminRole.SUPPORT: [
        AdminPermission.VIEW_USERS,
        AdminPermission.VIEW_ALL_PORTFOLIOS,
        AdminPermission.VIEW_ALL_TRANSACTIONS,
    ],
}


class AdminUser(Base):
    """Admin user model with elevated permissions"""

    __tablename__ = "admin_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, unique=True
    )
    role = Column(String(50), nullable=False, default=AdminRole.SUPPORT.value)

    # Additional permissions beyond role
    custom_permissions = Column(JSONType, default=list)

    # Status
    is_active = Column(Boolean, default=True)
    is_suspended = Column(Boolean, default=False)
    suspension_reason = Column(Text, nullable=True)
    suspended_until = Column(DateTime(timezone=True), nullable=True)

    # Metadata
    created_by_admin_id = Column(
        UUID(as_uuid=True), ForeignKey("admin_users.id"), nullable=True
    )
    notes = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", backref="admin_profile")
    audit_logs = relationship(
        "AdminAuditLog",
        back_populates="admin_user",
        foreign_keys="AdminAuditLog.admin_user_id",
    )

    def has_permission(self, permission: AdminPermission) -> bool:
        """Check if admin has a specific permission"""
        # Check role-based permissions
        role_perms = ROLE_PERMISSIONS.get(AdminRole(self.role), [])
        if permission in role_perms:
            return True

        # Check custom permissions
        if self.custom_permissions and permission.value in self.custom_permissions:
            return True

        return False

    def get_all_permissions(self) -> list[AdminPermission]:
        """Get all permissions for this admin"""
        permissions = set(ROLE_PERMISSIONS.get(AdminRole(self.role), []))

        if self.custom_permissions:
            for perm in self.custom_permissions:
                try:
                    permissions.add(AdminPermission(perm))
                except ValueError:
                    pass

        return list(permissions)


class AdminAuditLog(Base):
    """Audit log for admin actions"""

    __tablename__ = "admin_audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_user_id = Column(
        UUID(as_uuid=True), ForeignKey("admin_users.id"), nullable=False
    )

    # Action details
    action = Column(String(100), nullable=False)  # e.g., "user.delete", "user.ban"
    resource_type = Column(String(50), nullable=False)  # e.g., "user", "portfolio"
    resource_id = Column(String(100), nullable=True)

    # Request details
    method = Column(String(10), nullable=False)  # HTTP method
    endpoint = Column(String(255), nullable=False)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)

    # Action context
    changes = Column(JSONType, nullable=True)  # Before/after values
    action_metadata = Column(JSONType, nullable=True)  # Additional context

    # Result
    status = Column(String(20), nullable=False)  # success, failure, partial
    error_message = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    admin_user = relationship(
        "AdminUser", back_populates="audit_logs", foreign_keys=[admin_user_id]
    )


class SystemAlert(Base):
    """System alerts and notifications for admins"""

    __tablename__ = "system_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Alert details
    severity = Column(String(20), nullable=False)  # critical, warning, info
    category = Column(String(50), nullable=False)  # security, performance, error
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)

    # Context
    source = Column(String(100), nullable=True)  # Where alert originated
    alert_metadata = Column(JSONType, nullable=True)

    # Resolution
    is_resolved = Column(Boolean, default=False)
    resolved_by_admin_id = Column(
        UUID(as_uuid=True), ForeignKey("admin_users.id"), nullable=True
    )
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolution_notes = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )


class SystemSetting(Base):
    """System-wide settings manageable by admins"""

    __tablename__ = "system_settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Setting details
    key = Column(String(100), nullable=False, unique=True)
    value = Column(JSONType, nullable=False)
    value_type = Column(String(20), nullable=False)  # string, number, boolean, json

    # Metadata
    category = Column(
        String(50), nullable=False
    )  # feature_flags, limits, configuration
    description = Column(Text, nullable=True)
    is_public = Column(Boolean, default=False)  # Can non-admins see this?

    # Change tracking
    updated_by_admin_id = Column(
        UUID(as_uuid=True), ForeignKey("admin_users.id"), nullable=True
    )
    previous_value = Column(JSONType, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
