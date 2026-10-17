"""
Notifications router for Aspiro FastAPI backend.

This module contains notification-related endpoints for managing user notifications,
preferences, and delivery channels.
"""

from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from .schemas import (
    NotificationCreateRequest,
    NotificationUpdateRequest,
    NotificationResponse,
    NotificationListResponse,
    NotificationStatsResponse,
    NotificationFilterParams,
    NotificationSortParams,
    BulkNotificationActionRequest,
    NotificationPreferencesUpdateRequest,
    NotificationPreferencesResponse,
    NotificationTemplateCreateRequest,
    NotificationTemplateResponse,
)
from .models import NotificationStatus
from sqlalchemy import select
from ...core.database import get_db
from ...common.schemas import ApiResponse, PaginationMeta, PaginationParams
from ..users.dependencies import get_optional_current_user
from ..admin.models import AdminUser
from .services import get_notifications_service
from typing import Optional

router = APIRouter()

# ===== Health Check Endpoints =====


@router.get("/status", response_model=ApiResponse[dict])
async def notifications_status():
    """Get notifications service status"""
    return ApiResponse.success_response(
        data={"service": "notifications", "status": "operational"},
        message="Notifications service is ready",
    )


@router.get("/health", response_model=ApiResponse[dict])
async def notifications_health_check():
    """Detailed health check for notifications service"""
    return ApiResponse.success_response(
        data={
            "service": "notifications",
            "status": "healthy",
            "features": {
                "in_app_notifications": True,
                "email_notifications": True,
                "push_notifications": True,
                "sms_notifications": False,  # Not implemented yet
                "notification_templates": True,
                "user_preferences": True,
                "bulk_operations": True,
            },
        },
        message="Notifications service health check completed",
    )


# ===== User Notification Endpoints =====


@router.get("/", response_model=ApiResponse[List[NotificationListResponse]])
async def get_notifications(
    filters: NotificationFilterParams = Depends(),
    sort: NotificationSortParams = Depends(),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[object] = Depends(get_optional_current_user),
):
    """Get user's notifications with filtering and pagination"""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    svc = get_notifications_service(db)
    items, total = await svc.list_notifications_for_user(
        current_user.id, filters, page=pagination.page, limit=pagination.limit
    )

    meta = PaginationMeta.create(
        page=pagination.page, limit=pagination.limit, total=total
    )

    return ApiResponse.success_response(
        data=items, meta=meta, message="Notifications retrieved"
    )


@router.post("/bulk-action", response_model=ApiResponse[dict])
async def bulk_notification_action(
    action_data: BulkNotificationActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[object] = Depends(get_optional_current_user),
):
    """Perform bulk actions on notifications"""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    # For now only support mark_read action for list of ids
    if action_data.action == "mark_read":
        svc = get_notifications_service(db)
        updated = 0
        for nid in action_data.notification_ids:
            obj = await svc.mark_notification_read(nid, current_user.id)
            if obj:
                updated += 1
        return ApiResponse.success_response(
            data={"updated": updated}, message="Bulk action completed"
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported bulk action"
    )


# ===== Statistics and Analytics =====


@router.get("/stats/summary", response_model=ApiResponse[NotificationStatsResponse])
async def get_notification_stats(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[object] = Depends(get_optional_current_user),
):
    """Get notification statistics and summary"""
    from sqlalchemy import func, case
    from .models import Notification, NotificationStatus, NotificationType, NotificationPriority
    from datetime import datetime, timezone

    # Without this an anonymous caller got every user's counts and recent notifications.
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    user_filter = Notification.user_id == current_user.id

    # Single query: count by status
    status_rows = await db.execute(
        select(Notification.status, func.count().label("cnt"))
        .where(user_filter)
        .group_by(Notification.status)
    )
    by_status: dict[str, int] = {row.status: row.cnt for row in status_rows}

    # Count by type
    type_rows = await db.execute(
        select(Notification.type, func.count().label("cnt"))
        .where(user_filter)
        .group_by(Notification.type)
    )
    by_type: dict[str, int] = {row.type: row.cnt for row in type_rows}

    # Count by priority
    priority_rows = await db.execute(
        select(Notification.priority, func.count().label("cnt"))
        .where(user_filter)
        .group_by(Notification.priority)
    )
    by_priority: dict[str, int] = {row.priority: row.cnt for row in priority_rows}

    # Count expired (expires_at < now)
    now = datetime.now(timezone.utc)
    expired_result = await db.execute(
        select(func.count())
        .select_from(Notification)
        .where(user_filter)
        .where(Notification.expires_at != None)
        .where(Notification.expires_at < now)
    )
    expired_count = expired_result.scalar_one()

    # Recent 5 notifications
    recent_result = await db.execute(
        select(Notification)
        .where(user_filter)
        .order_by(Notification.created_at.desc())
        .limit(5)
    )
    recent = recent_result.scalars().all()

    total = sum(by_status.values())
    unread = by_status.get(NotificationStatus.PENDING, 0) + by_status.get(NotificationStatus.SENT, 0)

    stats = NotificationStatsResponse(
        total_notifications=total,
        unread_notifications=unread,
        read_notifications=by_status.get(NotificationStatus.READ, 0),
        dismissed_notifications=by_status.get(NotificationStatus.DISMISSED, 0),
        expired_notifications=expired_count,
        failed_notifications=by_status.get(NotificationStatus.FAILED, 0),
        notifications_by_type={k: v for k, v in by_type.items()},
        notifications_by_priority={k: v for k, v in by_priority.items()},
        recent_notifications=recent,
    )
    return ApiResponse.success_response(data=stats)


@router.post("/mark-all-read", response_model=ApiResponse[dict])
async def mark_all_notifications_read(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[object] = Depends(get_optional_current_user),
):
    """Mark all notifications as read for current user"""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    svc = get_notifications_service(db)
    count = await svc.mark_all_read(current_user.id)
    return ApiResponse.success_response(
        data={"updated": count}, message="Marked all as read"
    )


# ===== User Preferences =====


@router.get("/preferences", response_model=ApiResponse[NotificationPreferencesResponse])
async def get_notification_preferences(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[object] = Depends(get_optional_current_user),
):
    """Get user's notification preferences"""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    svc = get_notifications_service(db)
    pref = await svc.get_preferences(current_user.id)
    if not pref:
        # Return defaults from model
        return ApiResponse.success_response(data=None, message="No preferences set")
    return ApiResponse.success_response(data=pref, message="Preferences retrieved")


@router.patch(
    "/preferences", response_model=ApiResponse[NotificationPreferencesResponse]
)
async def update_notification_preferences(
    preferences_data: NotificationPreferencesUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[object] = Depends(get_optional_current_user),
):
    """Update user's notification preferences"""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    svc = get_notifications_service(db)
    updates = (
        preferences_data.model_dump(exclude_unset=True)
        if hasattr(preferences_data, "model_dump")
        else preferences_data.dict(exclude_unset=True)
    )
    pref = await svc.update_preferences(current_user.id, updates)
    return ApiResponse.success_response(data=pref, message="Preferences updated")


# ===== Template Management (Admin) =====


@router.get(
    "/templates", response_model=ApiResponse[List[NotificationTemplateResponse]]
)
async def get_notification_templates(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[object] = Depends(get_optional_current_user),
):
    """Get notification templates (admin endpoint)"""
    # Verify admin role by querying AdminUser table
    if not current_user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    admin_record = (await db.execute(
        select(AdminUser).where(AdminUser.user_id == current_user.id, AdminUser.is_active == True)
    )).scalar_one_or_none()
    if not admin_record:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")

    svc = get_notifications_service(db)
    templates = await svc.list_templates(page=pagination.page, limit=pagination.limit)
    return ApiResponse.success_response(data=templates, message="Templates retrieved")


@router.post(
    "/templates",
    response_model=ApiResponse[NotificationTemplateResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_notification_template(
    template_data: NotificationTemplateCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[object] = Depends(get_optional_current_user),
):
    """Create notification template (admin endpoint)"""
    if not current_user or getattr(current_user, "role", None) != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required"
        )

    svc = get_notifications_service(db)
    data = (
        template_data.model_dump()
        if hasattr(template_data, "model_dump")
        else template_data.dict()
    )
    tpl = await svc.create_template(data)
    return ApiResponse.success_response(data=tpl, message="Template created")


# ===== Single notification =====
# Declared last: "/{notification_id}" would otherwise capture /preferences and
# /templates and answer them with a 422 for not being a UUID.


@router.get("/{notification_id}", response_model=ApiResponse[NotificationResponse])
async def get_notification(
    notification_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[object] = Depends(get_optional_current_user),
):
    """Get specific notification by ID"""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    svc = get_notifications_service(db)
    obj = await svc.get_notification(notification_id, current_user.id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found"
        )

    return ApiResponse.success_response(data=obj, message="Notification retrieved")


@router.patch("/{notification_id}", response_model=ApiResponse[NotificationResponse])
async def update_notification(
    notification_id: UUID,
    update_data: NotificationUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[object] = Depends(get_optional_current_user),
):
    """Update notification status (mark as read, dismissed, etc.)"""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )

    svc = get_notifications_service(db)
    # Only support marking as read via this endpoint for now.
    # Compare against the enum directly: `update_data.status.__class__.READ`
    # raised AttributeError whenever status was omitted, since None.__class__
    # is NoneType — so a body carrying only read_at 500'd instead of marking read.
    if update_data.status == NotificationStatus.READ or update_data.read_at:
        obj = await svc.mark_notification_read(notification_id, current_user.id)
        if not obj:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found"
            )
        return ApiResponse.success_response(data=obj, message="Notification updated")

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported update"
    )
