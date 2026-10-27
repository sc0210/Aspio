"""
Admin monitoring and management endpoints.

Provides elevated access for administrators to monitor users, system stats,
database metrics, the audit log and system health, and perform administrative actions.
"""

from fastapi import APIRouter, Depends, Query, Path, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
from uuid import UUID

from app.core.database import get_db
from app.common.schemas import ApiResponse
from .dependencies import (
    get_current_admin,
    get_optional_admin,
    require_view_users,
    require_view_system_stats,
    require_super_admin,
)
from .models import AdminUser, AdminPermission
from .services import AdminMonitoringService, UserManagementService

router = APIRouter(tags=["admin"])


# ============================================================================
# Admin Status Check
# ============================================================================

@router.get("/check")
async def check_admin_status(
    current_admin: Optional[AdminUser] = Depends(get_optional_admin)
):
    """
    Check if current user has admin privileges.
    Returns admin status and role information.
    """
    if not current_admin:
        return {"isAdmin": False, "isSuperAdmin": False, "role": None}
    return {
        "isAdmin": True,
        "isSuperAdmin": current_admin.role == "super_admin",
        "role": current_admin.role,
    }


# ============================================================================
# User Monitoring Endpoints
# ============================================================================

@router.get("/users", response_model=ApiResponse)
async def list_users(
    search: Optional[str] = Query(None, description="Search by email or name"),
    is_active: Optional[bool] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_view_users),
    session: AsyncSession = Depends(get_db),
):
    """
    List all users with filtering and search.
    
    **Required Permission:** `view_users`
    
    Returns user details including:
    - Basic info (email, name, created date)
    - Account status
    - Last login timestamp
    - Portfolio count and total value
    - Transaction count
    """
    service = UserManagementService(session)
    
    result = await service.search_users(
        search_query=search,
        is_active=is_active,
        skip=skip,
        limit=limit
    )
    
    return ApiResponse.success_response(
        data=result,
        message=f"Found {result['total']} users"
    )


@router.get("/users/{user_id}", response_model=ApiResponse)
async def get_user_details(
    user_id: UUID = Path(..., description="User ID"),
    current_admin: AdminUser = Depends(require_view_users),
    session: AsyncSession = Depends(get_db),
):
    """
    Get detailed information about a specific user.
    
    **Required Permission:** `view_users`
    
    Includes:
    - Full user profile
    - Account statistics
    - Portfolio summary
    - Recent activity
    - API usage statistics
    """
    service = UserManagementService(session)
    user_details = await service.get_user_full_details(user_id)
    
    return ApiResponse.success_response(
        data=user_details,
        message="User details retrieved"
    )


@router.patch("/users/{user_id}/toggle-active", response_model=ApiResponse)
async def toggle_user_active(
    user_id: UUID = Path(..., description="User ID"),
    current_admin: AdminUser = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """
    Toggle user active/inactive status.

    **Required Permission:** super_admin only
    """
    # Prevent self-deactivation
    if str(user_id) == str(current_admin.user_id):
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    service = UserManagementService(session)
    result = await service.toggle_user_active(user_id)

    await service.log_admin_action(
        admin_id=current_admin.id,
        action="toggle_active",
        resource_type="user",
        resource_id=str(user_id),
        metadata={"is_active": result["is_active"], "email": result["email"]},
    )

    action = "activated" if result["is_active"] else "deactivated"
    return ApiResponse.success_response(
        data=result,
        message=f"User {result['email']} {action}",
    )


@router.delete("/users/{user_id}", response_model=ApiResponse)
async def delete_user(
    user_id: UUID = Path(..., description="User ID to delete"),
    current_admin: AdminUser = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """
    Delete a user and all associated data.

    **Required Permission:** super_admin only

    This will permanently delete:
    - User account
    - All portfolios
    - All transactions
    - All goals and budgets

    This action cannot be undone.
    """
    from app.modules.users.models import User
    from fastapi import HTTPException

    # Prevent self-deletion before touching the DB
    if str(user_id) == str(current_admin.user_id):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    # Verify user exists
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_email = user.email

    # Log the deletion before we delete everything
    service = UserManagementService(session)
    await service.log_admin_action(
        admin_id=current_admin.id,
        action="delete_user",
        resource_type="user",
        resource_id=str(user_id),
        metadata={"user_email": user_email}
    )

    # Hard-delete in dependency order (ORM cascades are disabled on User model)
    await service.hard_delete_user(user_id)

    return ApiResponse.success_response(
        message=f"User {user_email} deleted successfully"
    )


# ============================================================================
# Pending User Approval Endpoints
# ============================================================================

@router.get("/pending-users", response_model=ApiResponse)
async def get_pending_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_admin: AdminUser = Depends(require_view_users),
    session: AsyncSession = Depends(get_db),
):
    """
    Get all users pending approval.

    **Required Permission:** `view_users`

    Returns users with PENDING_APPROVAL status who are waiting for admin approval
    to access the application.
    """
    service = UserManagementService(session)
    pending_users = await service.get_pending_approval_users(skip=skip, limit=limit)

    return ApiResponse.success_response(
        data=pending_users,
        message=f"Found {pending_users['total']} pending users"
    )


@router.post("/approve-user/{user_id}", response_model=ApiResponse)
async def approve_user(
    user_id: UUID = Path(..., description="User ID to approve"),
    current_admin: AdminUser = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """
    Approve a pending user and activate their account.

    **Required Permission:** super_admin only

    Changes user status from PENDING_APPROVAL to ACTIVE, allowing them to
    log in and use the application.
    """
    service = UserManagementService(session)
    approved_user = await service.approve_user(user_id)

    # Log the approval
    await service.log_admin_action(
        admin_id=current_admin.id,
        action="approve_user",
        resource_type="user",
        resource_id=str(user_id),
        metadata={"user_email": approved_user.email}
    )

    return ApiResponse.success_response(
        data={"user_id": str(user_id), "email": approved_user.email},
        message=f"User {approved_user.email} approved successfully"
    )


@router.post("/reject-user/{user_id}", response_model=ApiResponse)
async def reject_user(
    user_id: UUID = Path(..., description="User ID to reject"),
    reason: Optional[str] = Query(None, description="Rejection reason"),
    current_admin: AdminUser = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """
    Reject a pending user and delete their account.

    **Required Permission:** super_admin only

    Permanently removes the user account. Optionally provide a rejection reason
    for audit logs.
    """
    from app.modules.users.models import User

    # Get the user
    user = await session.get(User, user_id)
    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")

    from app.modules.users.models import UserStatus as US
    if user.status != US.PENDING_APPROVAL:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail="Can only reject users with PENDING_APPROVAL status"
        )

    user_email = user.email

    # Log the rejection
    service = UserManagementService(session)
    await service.log_admin_action(
        admin_id=current_admin.id,
        action="reject_user",
        resource_type="user",
        resource_id=str(user_id),
        metadata={"user_email": user_email, "reason": reason or "No reason provided"}
    )

    # Delete the user
    await session.delete(user)
    await session.commit()

    return ApiResponse.success_response(
        message=f"User {user_email} rejected and removed"
    )


@router.post("/bulk-approve", response_model=ApiResponse)
async def bulk_approve_users(
    user_ids: List[UUID],
    current_admin: AdminUser = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """
    Bulk approve multiple pending users.

    **Required Permission:** super_admin only
    """
    from sqlalchemy import select, update
    from app.modules.users.models import User, UserStatus

    # Pre-fetch all target users in one query (avoids N+1 session.get per user)
    rows = (await session.execute(
        select(User.id, User.email, User.status)
        .where(User.id.in_(user_ids))
    )).all()

    user_map = {r.id: r for r in rows}
    approved = []
    failed = []
    approved_ids = []

    for user_id in user_ids:
        row = user_map.get(user_id)
        if not row or row.status != UserStatus.PENDING_APPROVAL:
            failed.append(str(user_id))
            continue
        approved.append(str(user_id))
        approved_ids.append(user_id)

    if approved_ids:
        # Single bulk UPDATE instead of one commit per user
        await session.execute(
            update(User)
            .where(User.id.in_(approved_ids))
            .values(status=UserStatus.ACTIVE, is_active=True)
            .execution_options(synchronize_session=False)
        )
        await session.commit()

        service = UserManagementService(session)
        for user_id in approved_ids:
            await service.log_admin_action(
                admin_id=current_admin.id,
                action="approve_user",
                resource_type="user",
                resource_id=str(user_id),
                metadata={"user_email": user_map[user_id].email, "bulk": True},
            )

    return ApiResponse.success_response(
        data={"approved": approved, "failed": failed},
        message=f"Approved {len(approved)} users. {len(failed)} failed."
    )


@router.post("/bulk-delete", response_model=ApiResponse)
async def bulk_delete_users(
    user_ids: List[UUID],
    current_admin: AdminUser = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """
    Bulk delete multiple users.

    **Required Permission:** super_admin only
    """
    from sqlalchemy import select
    from app.modules.users.models import User

    # Prevent self-deletion up front
    safe_ids = [uid for uid in user_ids if str(uid) != str(current_admin.user_id)]
    self_delete_count = len(user_ids) - len(safe_ids)

    # Pre-fetch all target emails in one query (avoids N+1 session.get per user)
    email_map: dict[UUID, str] = {
        r.id: r.email
        for r in (await session.execute(
            select(User.id, User.email).where(User.id.in_(safe_ids))
        )).all()
    }

    service = UserManagementService(session)
    deleted = []
    failed = [str(uid) for uid in user_ids if str(uid) == str(current_admin.user_id)]

    for user_id in safe_ids:
        if user_id not in email_map:
            failed.append(str(user_id))
            continue
        try:
            await service.log_admin_action(
                admin_id=current_admin.id,
                action="delete_user",
                resource_type="user",
                resource_id=str(user_id),
                metadata={"user_email": email_map[user_id], "bulk": True},
            )
            await service.hard_delete_user(user_id)
            deleted.append(str(user_id))
        except Exception:
            failed.append(str(user_id))

    return ApiResponse.success_response(
        data={"deleted": deleted, "failed": failed},
        message=f"Deleted {len(deleted)} users. {len(failed)} failed."
    )


# ============================================================================
# System Statistics Endpoints
# ============================================================================

@router.post("/database/vacuum", response_model=ApiResponse)
async def vacuum_database(
    table: Optional[str] = Query(None, description="Table to vacuum; omit to vacuum all tables"),
    current_admin: AdminUser = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """
    Run VACUUM ANALYZE on a specific table or all tables.

    **Required Permission:** super_admin only

    Reclaims storage occupied by dead tuples and updates planner statistics.
    Safe to run at any time; does NOT lock the table (unlike VACUUM FULL).
    """
    monitoring = AdminMonitoringService(session)
    result = await monitoring.run_vacuum(table_name=table)

    audit = UserManagementService(session)
    await audit.log_admin_action(
        admin_id=current_admin.id,
        action="vacuum",
        resource_type="database",
        resource_id=table or "all",
        metadata=result,
    )

    target = f"table '{table}'" if table else "all tables"
    return ApiResponse.success_response(
        data=result,
        message=f"VACUUM ANALYZE completed on {target} in {result['duration_s']}s",
    )


@router.get("/database/cleanup-preview", response_model=ApiResponse)
async def cleanup_preview(
    current_admin: AdminUser = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """
    Preview counts of stale data that can be safely cleaned (no changes made).

    **Required Permission:** super_admin only

    Returns counts for:
    - Soft-deleted transactions and loans (excluding demo user)
    - Stale duplicate currency rate rows
    - Old read/sent notifications older than 30 days (excluding demo user)
    - In-process caches that are always clearable
    """
    monitoring = AdminMonitoringService(session)
    preview = await monitoring.run_cleanup_preview()
    return ApiResponse.success_response(data=preview, message="Cleanup preview generated")


@router.post("/database/cleanup", response_model=ApiResponse)
async def run_cleanup(
    current_admin: AdminUser = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """
    Permanently remove stale/dummy data. Demo user data is protected and never touched.

    **Required Permission:** super_admin only

    Cleans:
    - Soft-deleted transactions and loans
    - Stale duplicate currency rate rows
    - Old read notifications (30+ days)
    - In-process price and LINE profile caches
    """
    monitoring = AdminMonitoringService(session)
    result = await monitoring.run_cleanup()

    audit = UserManagementService(session)
    await audit.log_admin_action(
        admin_id=current_admin.id,
        action="cleanup",
        resource_type="database",
        resource_id="all",
        metadata=result,
    )

    return ApiResponse.success_response(data=result, message="Database cleanup completed successfully")


@router.get("/stats/system", response_model=ApiResponse)
async def get_system_stats(
    current_admin: AdminUser = Depends(get_current_admin),
    session: AsyncSession = Depends(get_db),
):
    """
    Get overall system statistics.

    **Required Permission:** `view_system_stats` (checked via get_current_admin)

    Returns:
    - Total users (active/inactive)
    - Total portfolios and holdings
    - Total transactions
    - Database size and table statistics
    - Cache hit rate
    - Active sessions
    """
    # Check permission manually since we're not using RequirePermission dependency
    if not current_admin.has_permission(AdminPermission.VIEW_SYSTEM_STATS):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission 'view_system_stats' required"
        )

    service = AdminMonitoringService(session)
    stats = await service.get_system_statistics()

    return ApiResponse.success_response(
        data=stats,
        message="System statistics retrieved"
    )


@router.get("/stats/database", response_model=ApiResponse)
async def get_database_stats(
    current_admin: AdminUser = Depends(require_view_system_stats),
    session: AsyncSession = Depends(get_db),
):
    """
    Get database performance and usage statistics.
    
    **Required Permission:** `view_system_stats`
    
    Returns:
    - Database size
    - Table sizes and row counts
    - Index usage statistics
    - Slow query log summary
    - Connection pool stats
    """
    service = AdminMonitoringService(session)
    db_stats = await service.get_database_statistics()
    
    return ApiResponse.success_response(
        data=db_stats,
        message="Database statistics retrieved"
    )


# ============================================================================
# Audit Log Endpoints
# ============================================================================

@router.get("/audit-logs", response_model=ApiResponse)
async def get_audit_logs(
    action: Optional[str] = Query(None, description="Filter by action"),
    resource_type: Optional[str] = Query(None),
    admin_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_admin: AdminUser = Depends(require_view_system_stats),
    session: AsyncSession = Depends(get_db),
):
    """
    Get admin action audit logs.
    
    **Required Permission:** `view_system_stats`
    
    Returns chronological log of all admin actions.
    """
    service = AdminMonitoringService(session)
    logs = await service.get_audit_logs(
        action=action,
        resource_type=resource_type,
        admin_id=admin_id,
        skip=skip,
        limit=limit
    )
    
    return ApiResponse.success_response(
        data=logs,
        message=f"Found {logs['total']} audit log entries"
    )


# ============================================================================
# System Health Endpoints
# ============================================================================

@router.get("/health/detailed", response_model=ApiResponse)
async def get_detailed_health(
    current_admin: AdminUser = Depends(require_view_system_stats),
    session: AsyncSession = Depends(get_db),
):
    """
    Get detailed system health check.

    **Required Permission:** `view_system_stats`

    Checks:
    - Database round trip, version and size
    - Whether any worker holds the scheduler lock
    - How old the wallet snapshots, historical prices and FX rates are
    """
    service = AdminMonitoringService(session)
    health = await service.get_system_health()

    return ApiResponse.success_response(
        data=health,
        message="System health check complete"
    )
