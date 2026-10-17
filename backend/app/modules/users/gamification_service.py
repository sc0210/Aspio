"""
Gamification and user engagement service layer.

This module provides business logic for user gamification, achievements,
analytics, and engagement features with comprehensive Asian market support.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List, Tuple
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from .models import User, AchievementType, AchievementRarity
from .schemas import (
    UserGamificationStats,
    AchievementResponse,
    AchievementProgressResponse,
    UserEngagementMetrics,
    UserActivityRequest,
    UserActivityResponse,
    RegionalPreferencesUpdate,
    DataExportRequest,
    DataExportResponse,
)
from .gamification_repository import (
    get_gamification_repository,
    get_user_activity_repository,
    get_user_security_repository,
)
from .repositories import get_user_repository
from .achievement_catalogue import get_definition
from ...core.config import get_settings
from app.utils.datetime_helpers import business_timezone

settings = get_settings()
logger = logging.getLogger(__name__)


def compute_login_streak(
    last_streak_update: Optional[datetime],
    current_streak: int,
    now: datetime,
) -> Tuple[int, bool]:
    """Work out the login streak for a visit happening at ``now``.

    Pure helper so the login path (``UserService._update_user_activity``) and the
    manual ``/me/streak/update`` endpoint agree on the rules instead of each
    keeping their own copy.

    Returns ``(streak, advanced)`` where ``advanced`` is False when the user has
    already been counted for this calendar day — callers use it to stay
    idempotent per day.
    """
    # In the business timezone, not UTC: a streak is a run of the user's CALENDAR
    # days. On the UTC day, a login at 07:00 Taipei Monday (23:00 UTC Sunday) and
    # 09:00 Taipei Tuesday look two days apart and reset the streak, while 22:00
    # Monday and 06:00 Tuesday Taipei look like the same day and fail to advance it.
    tz = business_timezone()
    today = now.astimezone(tz).date()

    if last_streak_update is not None:
        # Rows written before the column was timezone-aware can come back naive.
        if last_streak_update.tzinfo is None:
            last_streak_update = last_streak_update.replace(tzinfo=timezone.utc)
        last_date = last_streak_update.astimezone(tz).date()

        if last_date == today:
            return max(current_streak, 1), False

        days_since = (today - last_date).days
        if days_since == 1:
            return current_streak + 1, True
        if days_since > 1:
            # Missed at least one day — streak restarts at today.
            return 1, True
        # Clock skew put the stored date in the future; leave the streak alone.
        return max(current_streak, 1), False

    return 1, True


class GamificationService:
    """Service for user gamification and achievement management"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.gamification_repo = get_gamification_repository(session)
        self.user_repo = get_user_repository(session)
        self.activity_repo = get_user_activity_repository(session)
        self.security_repo = get_user_security_repository(session)

    async def get_user_gamification_stats(self, user_id: UUID) -> UserGamificationStats:
        """
        Get comprehensive gamification statistics for a user.

        Args:
            user_id: User's UUID

        Returns:
            UserGamificationStats with all gamification data

        Raises:
            HTTPException: If user not found
        """
        try:
            # Get user data
            user = await self.user_repo.get_user_by_id(user_id)
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
                )

            # Get achievements
            achievements = await self.gamification_repo.get_user_achievements(
                user_id, limit=10
            )
            achievement_responses = [
                AchievementResponse(
                    id=ach.id,
                    user_id=ach.user_id,
                    achievement_type=ach.achievement_type.value,
                    achievement_data=ach.achievement_data,
                    points_awarded=ach.points_awarded,
                    rarity=ach.rarity.value,
                    unlocked_at=ach.unlocked_at,
                    **self._get_achievement_metadata(ach.achievement_type),
                )
                for ach in achievements
            ]

            # Calculate achievements by rarity
            achievements_by_rarity = {}
            all_achievements = await self.gamification_repo.get_user_achievements(
                user_id, limit=1000
            )
            for ach in all_achievements:
                rarity = ach.rarity.value
                achievements_by_rarity[rarity] = (
                    achievements_by_rarity.get(rarity, 0) + 1
                )

            # Calculate XP to next level
            current_level = user.level
            next_level_xp = self._calculate_xp_for_next_level(current_level)
            current_level_xp = self._calculate_xp_for_level(current_level)
            xp_to_next = max(0, next_level_xp - user.experience_points)

            # Calculate regional scores (placeholder implementation)
            regional_scores = await self._calculate_regional_scores(user_id)

            return UserGamificationStats(
                user_id=user_id,
                level=user.level,
                experience_points=user.experience_points,
                experience_to_next_level=xp_to_next,
                total_achievements=len(all_achievements),
                achievements_by_rarity=achievements_by_rarity,
                streak_info={
                    "current_login_streak": user.current_login_streak,
                    "longest_login_streak": user.longest_login_streak,
                    "last_streak_update": user.last_streak_update,
                    "streak_bonus_earned": user.current_login_streak
                    * 10,  # 10 points per day
                },
                recent_achievements=achievement_responses,
                digital_adoption_score=regional_scores["digital_adoption"],
                savings_discipline_score=regional_scores["savings_discipline"],
                investment_knowledge_score=regional_scores["investment_knowledge"],
                community_engagement_score=regional_scores["community_engagement"],
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting gamification stats: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve gamification statistics",
            )

    async def get_achievement_progress(
        self, user_id: UUID
    ) -> List[AchievementProgressResponse]:
        """
        Get achievement progress for a user showing both unlocked and available achievements.

        Args:
            user_id: User's UUID

        Returns:
            List of AchievementProgressResponse objects
        """
        try:
            progress_data = await self.gamification_repo.get_achievement_progress(
                user_id
            )

            progress_responses = []
            for achievement_type, progress_info in progress_data.items():
                progress_responses.append(AchievementProgressResponse(**progress_info))

            # Sort by completion status and then by progress percentage
            progress_responses.sort(
                key=lambda x: (x.is_unlocked, -x.progress_percentage)
            )

            return progress_responses

        except Exception as e:
            logger.error(f"Error getting achievement progress: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve achievement progress",
            )

    async def trigger_achievement_check(
        self,
        user_id: UUID,
        trigger_type: str,
        trigger_data: Optional[Dict[str, Any]] = None,
    ) -> List[AchievementResponse]:
        """
        Check and award achievements based on user actions.

        Args:
            user_id: User's UUID
            trigger_type: Type of action that triggered the check
            trigger_data: Additional data about the trigger

        Returns:
            List of newly awarded achievements
        """
        try:
            newly_awarded = []

            # Map trigger types to potential achievements
            achievement_checks = {
                "transaction_created": [
                    AchievementType.FIRST_TRANSACTION,
                    AchievementType.HUNDRED_TRANSACTIONS,
                ],
                "goal_created": [AchievementType.FIRST_GOAL],
                "goal_completed": [
                    AchievementType.GOAL_COMPLETED,
                    AchievementType.FIVE_GOALS_COMPLETED,
                ],
                "login": [
                    AchievementType.DAILY_LOGIN_STREAK_7,
                    AchievementType.DAILY_LOGIN_STREAK_30,
                    AchievementType.DAILY_LOGIN_STREAK_100,
                ],
                "qr_payment": [AchievementType.QR_PAYMENT_MASTER],
                "multi_currency": [AchievementType.MULTI_CURRENCY_TRACKER],
                "referral_complete": [AchievementType.REFERRAL_CHAMPION],
            }

            potential_achievements = achievement_checks.get(trigger_type, [])

            for achievement_type in potential_achievements:
                achievement = await self._check_and_award_achievement(
                    user_id, achievement_type, trigger_data
                )
                if achievement:
                    newly_awarded.append(achievement)

            # Update user level if needed
            new_level = await self.gamification_repo.update_user_level(user_id)
            if new_level:
                logger.info(f"User {user_id} leveled up to level {new_level}")

            return newly_awarded

        except Exception as e:
            logger.error(f"Error checking achievements: {str(e)}")
            return []

    async def sweep_achievements(
        self,
        user_id: UUID,
        trigger_data: Optional[Dict[str, Any]] = None,
    ) -> List[AchievementResponse]:
        """Award every achievement whose progress is complete but not yet unlocked.

        Trigger-driven checks (``trigger_achievement_check``) only look at the
        handful of types mapped to that trigger, so an achievement with no
        trigger entry could sit at 100% forever. This sweeps the whole progress
        map instead, which also keeps new achievement types working without
        having to remember to wire up a trigger.

        Progress is computed once and reused for every award decision — the
        per-type path recomputes the full map on each call, which is O(n²) in
        the number of achievement types.
        """
        try:
            progress_data = await self.gamification_repo.get_achievement_progress(
                user_id
            )

            awarded: List[AchievementResponse] = []
            for achievement_type in AchievementType:
                progress = progress_data.get(achievement_type.value)
                if not progress:
                    continue
                achievement = await self._check_and_award_achievement(
                    user_id, achievement_type, trigger_data, progress=progress
                )
                if achievement:
                    awarded.append(achievement)

            new_level = await self.gamification_repo.update_user_level(user_id)
            if new_level:
                logger.info(f"User {user_id} leveled up to level {new_level}")

            return awarded

        except Exception as e:
            logger.error(f"Error sweeping achievements: {str(e)}")
            return []

    async def _check_and_award_achievement(
        self,
        user_id: UUID,
        achievement_type: AchievementType,
        trigger_data: Optional[Dict[str, Any]] = None,
        progress: Optional[Dict[str, Any]] = None,
    ) -> Optional[AchievementResponse]:
        """Check if user qualifies for achievement and award it.

        ``progress`` lets a caller that already holds the progress map pass the
        relevant entry in, avoiding a full recompute per achievement.
        """

        # Get current progress
        if progress is not None:
            achievement_progress: Optional[Dict[str, Any]] = progress
        else:
            progress_data = await self.gamification_repo.get_achievement_progress(
                user_id
            )
            achievement_progress = progress_data.get(achievement_type.value)

        if not achievement_progress:
            return None

        # Check if achievement should be awarded
        if (
            achievement_progress["current_progress"]
            >= achievement_progress["required_progress"]
            and not achievement_progress["is_unlocked"]
        ):

            # Determine points and rarity based on achievement type
            points, rarity = self._get_achievement_reward(achievement_type)

            # Award the achievement
            achievement = await self.gamification_repo.award_achievement(
                user_id, achievement_type, points, rarity, trigger_data
            )

            if achievement:
                metadata = self._get_achievement_metadata(achievement_type)
                # Fire an in-app notification for the unlock (best-effort — a
                # notification failure must not roll back the awarded achievement).
                try:
                    from app.modules.notifications.services import create_notification
                    from app.modules.notifications.models import NotificationType as _NType
                    await create_notification(
                        self.session,
                        user_id=user_id,
                        type=_NType.ACHIEVEMENT_UNLOCKED,
                        title=f"{metadata.get('icon', '🏆')} Achievement unlocked!",
                        message=f"You earned “{metadata.get('title', achievement_type.value)}” (+{points} XP)",
                        related_entity_type="achievement",
                        related_entity_id=achievement.id,
                        data={"achievement_type": achievement_type.value, "points": points},
                    )
                except Exception:
                    import logging
                    logging.getLogger(__name__).warning(
                        "Failed to create achievement notification", exc_info=True
                    )
                return AchievementResponse(
                    id=achievement.id,
                    user_id=achievement.user_id,
                    achievement_type=achievement.achievement_type.value,
                    achievement_data=achievement.achievement_data,
                    points_awarded=achievement.points_awarded,
                    rarity=achievement.rarity.value,
                    unlocked_at=achievement.unlocked_at,
                    **metadata,
                )

        return None

    def _get_achievement_reward(
        self, achievement_type: AchievementType
    ) -> Tuple[int, AchievementRarity]:
        """Get points and rarity for achievement type"""
        definition = get_definition(achievement_type)
        return definition.points, definition.rarity

    def _get_achievement_metadata(
        self, achievement_type: AchievementType
    ) -> Dict[str, str]:
        """Get display metadata for achievement type"""
        definition = get_definition(achievement_type)
        return {
            "title": definition.title,
            "description": definition.description,
            "icon": definition.icon,
            "category": definition.category,
        }

    async def _calculate_regional_scores(self, user_id: UUID) -> Dict[str, int]:
        """Calculate regional gamification scores for Asian markets"""
        try:
            # Get user activities to calculate scores
            activities = await self.activity_repo.get_user_activities(
                user_id,
                start_date=datetime.now(timezone.utc) - timedelta(days=30),
                limit=1000,
            )

            # Digital adoption score (based on QR payments, digital wallet usage)
            digital_activities = [
                act
                for act in activities
                if act.activity_type
                in ["qr_payment", "digital_wallet_transaction", "mobile_banking"]
            ]
            digital_adoption = min(100, len(digital_activities) * 5)

            # Savings discipline score (based on consistent savings deposits)
            savings_activities = [
                act
                for act in activities
                if act.activity_type in ["savings_deposit", "investment_contribution"]
            ]
            savings_discipline = min(100, len(savings_activities) * 3)

            # Investment knowledge score (based on portfolio activities, educational content)
            investment_activities = [
                act
                for act in activities
                if act.activity_type
                in ["portfolio_view", "investment_research", "market_analysis"]
            ]
            investment_knowledge = min(100, len(investment_activities) * 2)

            # Community engagement score (based on referrals, social features)
            community_activities = [
                act
                for act in activities
                if act.activity_type
                in ["referral_sent", "achievement_shared", "community_interaction"]
            ]
            community_engagement = min(100, len(community_activities) * 4)

            return {
                "digital_adoption": digital_adoption,
                "savings_discipline": savings_discipline,
                "investment_knowledge": investment_knowledge,
                "community_engagement": community_engagement,
            }

        except Exception as e:
            logger.error(f"Error calculating regional scores: {str(e)}")
            return {
                "digital_adoption": 0,
                "savings_discipline": 0,
                "investment_knowledge": 0,
                "community_engagement": 0,
            }

    def _calculate_xp_for_level(self, level: int) -> int:
        """Calculate total XP required for a given level"""
        return (level * level) * 50

    def _calculate_xp_for_next_level(self, current_level: int) -> int:
        """Calculate XP required for next level"""
        return self._calculate_xp_for_level(current_level + 1)


class UserAnalyticsService:
    """Service for user analytics and engagement metrics"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.activity_repo = get_user_activity_repository(session)
        self.user_repo = get_user_repository(session)

    async def log_user_activity(
        self,
        user_id: UUID,
        activity_request: UserActivityRequest,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> UserActivityResponse:
        """
        Log user activity for analytics and engagement tracking.

        Args:
            user_id: User's UUID
            activity_request: Activity data to log
            ip_address: Optional IP address
            user_agent: Optional user agent string

        Returns:
            UserActivityResponse with logged activity data
        """
        try:
            activity_log = await self.activity_repo.log_activity(
                user_id=user_id,
                activity_type=activity_request.activity_type,
                activity_data=activity_request.activity_data,
                session_id=activity_request.session_id,
                ip_address=ip_address,
                user_agent=user_agent,
            )

            return UserActivityResponse(
                id=activity_log.id,
                user_id=activity_log.user_id,
                activity_type=activity_log.activity_type,
                activity_data=activity_log.activity_data,
                session_id=activity_log.session_id,
                created_at=activity_log.created_at,
            )

        except Exception as e:
            logger.error(f"Error logging user activity: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to log user activity",
            )

    async def get_user_engagement_metrics(
        self, user_id: UUID, days_back: int = 30
    ) -> UserEngagementMetrics:
        """
        Get comprehensive engagement metrics for a user.

        Args:
            user_id: User's UUID
            days_back: Number of days to analyze

        Returns:
            UserEngagementMetrics with calculated metrics
        """
        try:
            metrics_data = await self.activity_repo.get_user_engagement_metrics(
                user_id, days_back
            )
            return UserEngagementMetrics(**metrics_data)

        except Exception as e:
            logger.error(f"Error getting engagement metrics: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve engagement metrics",
            )

    async def update_login_streak(self, user_id: UUID) -> Dict[str, Any]:
        """
        Update user's login streak and award streak achievements.

        Args:
            user_id: User's UUID

        Returns:
            Dictionary with streak information and any new achievements
        """
        try:
            user = await self.user_repo.get_user_by_id(user_id)
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
                )

            now = datetime.now(timezone.utc)
            new_streak, advanced = compute_login_streak(
                user.last_streak_update, user.current_login_streak, now
            )
            longest_streak = max(user.longest_login_streak, new_streak)

            if not advanced:
                # Already counted today — idempotent, but still repair a row whose
                # streak columns never got written (e.g. a login before this was
                # tracked at all).
                if (
                    user.current_login_streak == new_streak
                    and user.longest_login_streak == longest_streak
                ):
                    return {
                        "current_streak": new_streak,
                        "longest_streak": longest_streak,
                        "streak_updated": False,
                        "new_achievements": [],
                    }

            await self.user_repo.update_user(
                user_id,
                {
                    "current_login_streak": new_streak,
                    "longest_login_streak": longest_streak,
                    "last_streak_update": now,
                },
            )

            # Check for streak achievements
            gamification_service = GamificationService(self.session)
            new_achievements = await gamification_service.trigger_achievement_check(
                user_id, "login", {"new_streak": new_streak}
            )

            logger.info(f"Updated login streak for user {user_id}: {new_streak} days")

            return {
                "current_streak": new_streak,
                "longest_streak": longest_streak,
                "streak_updated": True,
                "new_achievements": new_achievements,
                "streak_bonus_points": new_streak * 10,  # 10 points per day
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error updating login streak: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update login streak",
            )


# Service factory functions
def get_gamification_service(session: AsyncSession) -> GamificationService:
    """Get gamification service instance"""
    return GamificationService(session)


def get_user_analytics_service(session: AsyncSession) -> UserAnalyticsService:
    """Get user analytics service instance"""
    return UserAnalyticsService(session)
