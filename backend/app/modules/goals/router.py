"""
Goals API Router

Endpoints for managing financial goals and milestones.
"""

from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.schemas import ApiResponse, PaginationMeta
from app.core.database import get_db
from app.modules.users.dependencies import CurrentUser, OptionalCurrentUser
from .schemas import (
    GoalCreate,
    GoalUpdate,
    GoalResponse,
    GoalSummary,
    GoalContributionCreate,
    GoalContributionResponse,
)
from .service import get_goal_service

router = APIRouter()


@router.post(
    "/", response_model=ApiResponse[GoalResponse], status_code=status.HTTP_201_CREATED
)
async def create_goal(
    goal_data: GoalCreate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Create a new financial goal"""
    import logging

    logger = logging.getLogger(__name__)

    try:
        logger.info(
            f"[GoalRouter] Received create goal request from user {current_user.id}"
        )
        logger.info(f"[GoalRouter] Request data: {goal_data.model_dump()}")

        goal_service = get_goal_service(session)
        goal = await goal_service.create_goal(current_user.id, goal_data)

        logger.info(f"[GoalRouter] Goal created successfully: {goal.id}")

        return ApiResponse.success_response(
            data=GoalResponse.model_validate(goal), message="Goal created successfully"
        )
    except Exception as e:
        logger.error(f"[GoalRouter] Error creating goal: {str(e)}", exc_info=True)
        raise


@router.get("/", response_model=ApiResponse[List[GoalResponse]])
async def list_goals(
    current_user: OptionalCurrentUser,
    status: Optional[str] = Query(
        None, description="Filter by status (active, completed, paused, cancelled)"
    ),
    category: Optional[str] = Query(None, description="Filter by category"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(50, ge=1, le=200, description="Maximum records to return"),
    session: AsyncSession = Depends(get_db),
):
    """List all financial goals"""
    if not current_user:
        # Unauthenticated / demo mode — return empty list (not an error)
        return ApiResponse.success_response(
            data=[],
            message="Unauthenticated - no goals",
            meta=PaginationMeta.create(page=1, limit=limit, total=0),
        )

    goal_service = get_goal_service(session)
    goals, total = await goal_service.list_goals(
        current_user.id, status, category, skip=skip, limit=limit
    )

    return ApiResponse.success_response(
        data=[GoalResponse.model_validate(g) for g in goals],
        message=f"Retrieved {len(goals)} goals",
        meta=PaginationMeta.create(page=skip // limit + 1, limit=limit, total=total),
    )


@router.get("/summary", response_model=ApiResponse[GoalSummary])
async def get_goals_summary(
    current_user: OptionalCurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Get goals summary for dashboard"""
    if not current_user:
        # Return demo data
        return ApiResponse.success_response(
            data=GoalSummary(
                total_goals=3,
                active_goals=2,
                completed_goals=1,
                total_target_amount=144000,
                total_current_amount=43200,
                overall_progress=30.00,
            ),
            message="Demo mode - summary",
        )

    goal_service = get_goal_service(session)
    summary = await goal_service.get_summary(current_user.id)

    return ApiResponse.success_response(data=summary, message="Goals summary retrieved")


@router.get("/{goal_id}", response_model=ApiResponse[GoalResponse])
async def get_goal(
    goal_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Get a specific goal"""
    goal_service = get_goal_service(session)
    goal = await goal_service.get_goal(goal_id, current_user.id)

    if not goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
        )

    return ApiResponse.success_response(
        data=GoalResponse.model_validate(goal), message="Goal retrieved"
    )


@router.put("/{goal_id}", response_model=ApiResponse[GoalResponse])
async def update_goal(
    goal_id: UUID,
    goal_data: GoalUpdate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Update a goal"""
    goal_service = get_goal_service(session)
    goal = await goal_service.update_goal(goal_id, current_user.id, goal_data)

    if not goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
        )

    return ApiResponse.success_response(
        data=GoalResponse.model_validate(goal), message="Goal updated successfully"
    )


@router.delete("/{goal_id}", response_model=ApiResponse[None])
async def delete_goal(
    goal_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Delete a goal"""
    goal_service = get_goal_service(session)
    success = await goal_service.delete_goal(goal_id, current_user.id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
        )

    return ApiResponse.success_response(message="Goal deleted successfully")


@router.post(
    "/{goal_id}/contributions",
    response_model=ApiResponse[GoalContributionResponse],
    status_code=status.HTTP_201_CREATED,
)
async def add_contribution(
    goal_id: UUID,
    contribution_data: GoalContributionCreate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Add a contribution to a goal"""
    goal_service = get_goal_service(session)
    contribution = await goal_service.add_contribution(
        goal_id, current_user.id, contribution_data
    )

    if not contribution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found"
        )

    return ApiResponse.success_response(
        data=GoalContributionResponse.model_validate(contribution),
        message="Contribution added successfully",
    )
