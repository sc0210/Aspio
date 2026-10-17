"""
Enhanced users router with comprehensive gamification, analytics, and regional features.

This router extends the basic user functionality with:
- Gamification system with achievements and levels
- User analytics and engagement tracking
- Regional preferences for Asian markets
- Enhanced security and privacy features
- Data export and GDPR compliance
"""

import logging
from typing import List

from fastapi import APIRouter, Depends, Query

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession

from .schemas import (
    UserResponse, UserGamificationStats, AchievementResponse,
    AchievementProgressResponse, UserActivityRequest,
    RegionalPreferencesUpdate
)
from .services_simple import get_user_service
from .gamification_service import get_gamification_service, get_user_analytics_service
from .dependencies import (
    CurrentUser
)
from ...core.database import get_async_session
from ...common.schemas import ApiResponse

router = APIRouter(tags=["Enhanced User Management"])

# ===== Gamification Endpoints =====

@router.get("/me/gamification", response_model=ApiResponse[UserGamificationStats])
async def get_user_gamification_stats(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_async_session)
):
    """
    Get comprehensive gamification statistics for current user.
    
    Returns level, experience points, achievements, streaks, and regional scores
    tailored for Asian market engagement patterns.
    """
    gamification_service = get_gamification_service(session)
    stats = await gamification_service.get_user_gamification_stats(current_user.id)
    
    return ApiResponse.success_response(
        data=stats,
        message="Gamification statistics retrieved successfully"
    )


@router.get("/me/achievements", response_model=ApiResponse[List[AchievementResponse]])
async def get_user_achievements(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_async_session),
    limit: int = Query(50, ge=1, le=100, description="Number of achievements to return"),
    offset: int = Query(0, ge=0, description="Number of achievements to skip")
):
    """
    Get user's unlocked achievements with pagination.
    
    Returns achievements sorted by unlock date (most recent first).
    """
    gamification_service = get_gamification_service(session)
    gamification_repo = gamification_service.gamification_repo
    
    achievements = await gamification_repo.get_user_achievements(
        current_user.id, limit=limit, offset=offset
    )
    
    achievement_responses = []
    for ach in achievements:
        metadata = gamification_service._get_achievement_metadata(ach.achievement_type)
        achievement_responses.append(AchievementResponse(
            id=ach.id,
            user_id=ach.user_id,
            achievement_type=ach.achievement_type.value,
            achievement_data=ach.achievement_data,
            points_awarded=ach.points_awarded,
            rarity=ach.rarity.value,
            unlocked_at=ach.unlocked_at,
            **metadata
        ))
    
    return ApiResponse.success_response(
        data=achievement_responses,
        message=f"Retrieved {len(achievement_responses)} achievements"
    )


@router.get("/me/achievements/progress", response_model=ApiResponse[List[AchievementProgressResponse]])
async def get_achievement_progress(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_async_session)
):
    """
    Get achievement progress showing both unlocked and available achievements.
    
    Returns detailed progress information including tips and completion percentage
    for all achievement types.
    """
    gamification_service = get_gamification_service(session)
    progress = await gamification_service.get_achievement_progress(current_user.id)
    
    return ApiResponse.success_response(
        data=progress,
        message="Achievement progress retrieved successfully"
    )


@router.post("/me/streak/update", response_model=ApiResponse[dict])
async def update_login_streak(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_async_session)
):
    """
    Update user's login streak and check for streak achievements.
    
    Called automatically on login but can be manually triggered.
    Awards experience points and achievements for consistent usage.
    """
    analytics_service = get_user_analytics_service(session)
    streak_info = await analytics_service.update_login_streak(current_user.id)
    
    return ApiResponse.success_response(
        data=streak_info,
        message="Login streak updated successfully"
    )


# ===== Regional Preferences Endpoints =====

@router.put("/me/regional-preferences", response_model=ApiResponse[UserResponse])
async def update_regional_preferences(
    preferences_update: RegionalPreferencesUpdate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_async_session)
):
    """
    Update regional preferences for Asian market customization.
    
    Supports language, currency, timezone, date formats, number formats,
    cultural calendars, and preferred payment methods.
    """
    user_service = get_user_service(session)
    
    # Convert regional preferences to user update format
    update_data = {}
    if preferences_update.preferred_language:
        update_data['preferred_language'] = preferences_update.preferred_language
    if preferences_update.preferred_currency:
        update_data['preferred_currency'] = preferences_update.preferred_currency
    if preferences_update.timezone:
        update_data['timezone'] = preferences_update.timezone
    
    # Update preferences dictionary
    preferences = current_user.preferences or {}
    if preferences_update.date_format:
        preferences['date_format'] = preferences_update.date_format
    if preferences_update.number_format:
        preferences['number_format'] = preferences_update.number_format
    if preferences_update.cultural_calendar:
        preferences['cultural_calendar'] = preferences_update.cultural_calendar
    if preferences_update.payment_methods:
        preferences['payment_methods'] = preferences_update.payment_methods
    
    if preferences:
        update_data['preferences'] = preferences
    
    # Use existing update method
    updated_user = await user_service.update_user_data(current_user.id, update_data)
    
    # Log regional preference update activity
    analytics_service = get_user_analytics_service(session)
    await analytics_service.log_user_activity(
        current_user.id,
        UserActivityRequest(
            activity_type="regional_preferences_updated",
            activity_data=preferences_update.model_dump(exclude_none=True)
        )
    )
    
    return ApiResponse.success_response(
        data=UserResponse.model_validate(updated_user),
        message="Regional preferences updated successfully"
    )


@router.post("/me/achievements/check-all", response_model=ApiResponse[List[AchievementResponse]])
async def check_all_achievements(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_async_session),
):
    """
    Re-evaluate every achievement for the current user and award any that are
    now complete but not yet unlocked.

    Sweeps the whole achievement set — including types with no trigger wired up
    — so the frontend can offer a single "check for new achievements" action and
    surface everything the user has earned since their last visit. Idempotent:
    already-unlocked achievements are never re-awarded.
    """
    gamification_service = get_gamification_service(session)

    awarded = await gamification_service.sweep_achievements(
        current_user.id, {"manual_trigger": True}
    )

    return ApiResponse.success_response(
        data=awarded,
        message=f"Checked all achievements. {len(awarded)} new achievement(s) awarded.",
    )
