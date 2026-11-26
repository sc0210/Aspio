"""
Notifications router for Aspiro FastAPI backend.

This module contains notification-related endpoints for managing user notifications,
preferences, and delivery channels.
"""

from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .schemas import (
    NotificationUpdateRequest,
    NotificationResponse,
    NotificationListResponse,
    NotificationFilterParams,
    NotificationSortParams,
    NotificationPreferencesUpdateRequest,
    NotificationPreferencesResponse,
)
from .models import NotificationStatus
from ...core.database import get_db
from ...common.schemas import ApiResponse, PaginationMeta, PaginationParams
from ..users.dependencies import get_optional_current_user
from .services import get_notifications_service
from typing import Optional

router = APIRouter()

# ===== Health Check Endpoints =====


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


# ===== Statistics and Analytics =====


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


# ===== Single notification =====
# Declared last: "/{notification_id}" would otherwise capture /preferences and
# answer it with a 422 for not being a UUID.


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
