"""
Gamification and user analytics repository for enhanced user engagement.

This module provides async database operations for gamification features,
achievements, user activity tracking, and analytics.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from uuid import UUID
import logging

from sqlalchemy import select, update, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    User, UserGamificationAchievement, UserActivityLog, UserSecurityLog, AchievementType,
    AchievementRarity
)
from .achievement_catalogue import (
    DEFAULT_TIPS,
    UNTRACKED_ACHIEVEMENTS,
    get_definition,
)

logger = logging.getLogger(__name__)

#: Experience points required to reach level ``n`` is ``n² × 50``. Anything that
#: writes ``User.level`` must go through :func:`level_for_experience` — a second
#: formula elsewhere made the level badge jump around depending on which code
#: path last touched the row.
XP_PER_LEVEL_FACTOR = 50
MAX_LEVEL = 100


def level_for_experience(experience_points: int) -> int:
    """Return the level an account with ``experience_points`` has reached."""
    import math

    if experience_points < 100:
        return 1
    level = math.floor(math.sqrt(experience_points / XP_PER_LEVEL_FACTOR))
    return max(1, min(level, MAX_LEVEL))


class GamificationRepository:
    """Repository for gamification and achievement operations"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def award_achievement(
        self, 
        user_id: UUID, 
        achievement_type: AchievementType,
        points: int = 0,
        rarity: AchievementRarity = AchievementRarity.COMMON,
        achievement_data: Optional[Dict[str, Any]] = None
    ) -> Optional[UserGamificationAchievement]:
        """
        Award an achievement to a user if they don't already have it.
        
        Args:
            user_id: User's UUID
            achievement_type: Type of achievement
            points: Points awarded for this achievement
            rarity: Rarity level of achievement
            achievement_data: Additional metadata
            
        Returns:
            UserAchievement instance if newly awarded, None if already exists
        """
        try:
            # Check if user already has this achievement
            existing = await self.session.execute(
                select(UserGamificationAchievement).where(
                    and_(
                        UserGamificationAchievement.user_id == user_id,
                        UserGamificationAchievement.achievement_type == achievement_type
                    )
                )
            )
            
            if existing.scalar_one_or_none():
                logger.debug(f"User {user_id} already has achievement {achievement_type}")
                return None
            
            # Create new achievement
            achievement = UserGamificationAchievement(
                user_id=user_id,
                achievement_type=achievement_type,
                points_awarded=points,
                rarity=rarity,
                achievement_data=achievement_data or {},
                unlocked_at=datetime.now(timezone.utc)
            )
            
            self.session.add(achievement)
            
            # Update user's experience points
            await self.session.execute(
                update(User)
                .where(User.id == user_id)
                .values(experience_points=User.experience_points + points)
            )
            
            await self.session.commit()
            await self.session.refresh(achievement)
            
            logger.info(f"Awarded achievement {achievement_type} to user {user_id} ({points} points)")
            return achievement
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error awarding achievement: {str(e)}")
            raise
    
    async def get_user_achievements(
        self, 
        user_id: UUID,
        limit: int = 50,
        offset: int = 0
    ) -> List[UserGamificationAchievement]:
        """Get user's achievements with pagination"""
        try:
            query = (
                select(UserGamificationAchievement)
                .where(UserGamificationAchievement.user_id == user_id)
                .order_by(desc(UserGamificationAchievement.unlocked_at))
                .limit(limit)
                .offset(offset)
            )
            
            result = await self.session.execute(query)
            return result.scalars().all()
            
        except Exception as e:
            logger.error(f"Error getting user achievements: {str(e)}")
            return []
    
    async def get_achievement_progress(
        self, 
        user_id: UUID
    ) -> Dict[str, Dict[str, Any]]:
        """
        Get achievement progress for a user including unlocked and available achievements.
        
        Returns:
            Dictionary with achievement progress data
        """
        try:
            # Get unlocked achievements
            unlocked_query = select(UserGamificationAchievement).where(
                UserGamificationAchievement.user_id == user_id
            )
            unlocked_result = await self.session.execute(unlocked_query)
            unlocked_achievements = {
                ach.achievement_type.value: ach for ach in unlocked_result.scalars().all()
            }
            
            # Get user data for progress calculation
            user_query = select(User).where(User.id == user_id)
            user_result = await self.session.execute(user_query)
            user = user_result.scalar_one_or_none()
            
            if not user:
                return {}
            
            # Calculate progress for each achievement type.
            #
            # Several types resolve from the same counter — FIRST_TRANSACTION,
            # HUNDRED_TRANSACTIONS and THOUSAND_TRANSACTIONS all read the
            # transaction count — so a memo shared across this one request
            # collapses those into a single query each. It is created here and
            # discarded with the response, so it can never serve stale counts.
            counter_cache: Dict[str, int] = {}
            progress_data = {}
            for achievement_type in AchievementType:
                unlocked = unlocked_achievements.get(achievement_type.value)
                if achievement_type in UNTRACKED_ACHIEVEMENTS and unlocked is None:
                    continue
                progress_info = await self._calculate_achievement_progress(
                    user, achievement_type, unlocked, counter_cache
                )
                progress_data[achievement_type.value] = progress_info
            
            return progress_data
            
        except Exception as e:
            logger.error(f"Error getting achievement progress: {str(e)}")
            return {}
    
    async def _calculate_achievement_progress(
        self,
        user: User,
        achievement_type: AchievementType,
        unlocked_achievement: Optional[UserGamificationAchievement],
        counter_cache: Optional[Dict[str, int]] = None,
    ) -> Dict[str, Any]:
        """Calculate progress towards a specific achievement.

        Static fields (title, icon, requirement, …) come from
        :data:`ACHIEVEMENT_CATALOGUE`; this only resolves the live count.
        """

        definition = get_definition(achievement_type)
        current_progress = await self._current_progress_for(
            user, achievement_type, counter_cache
        )
        required_progress = max(1, definition.required_progress)

        return {
            "achievement_type": achievement_type.value,
            "title": definition.title,
            "description": definition.description,
            "category": definition.category,
            "icon": definition.icon,
            "rarity": definition.rarity.value,
            "points_reward": definition.points,
            "current_progress": current_progress,
            "required_progress": required_progress,
            "progress_percentage": min(
                100.0, (current_progress / required_progress) * 100
            ),
            "is_unlocked": unlocked_achievement is not None,
            "unlocked_at": (
                unlocked_achievement.unlocked_at if unlocked_achievement else None
            ),
            "tips": list(definition.tips) or list(DEFAULT_TIPS),
        }

    async def _current_progress_for(
        self,
        user: User,
        achievement_type: AchievementType,
        counter_cache: Optional[Dict[str, int]] = None,
    ) -> int:
        """Resolve the live progress count for one achievement type.

        Only the counter the requested type needs is executed — a single
        ``if`` chain rather than gathering every count up front. When a
        ``counter_cache`` is supplied, counters shared by several achievement
        types are run once for the whole request instead of once per type.
        """
        A = AchievementType

        async def counted(name: str) -> int:
            """Run counter ``name`` once, reusing this request's result."""
            if counter_cache is not None and name in counter_cache:
                return counter_cache[name]
            value = await getattr(self, name)(user.id)
            if counter_cache is not None:
                counter_cache[name] = value
            return value

        if achievement_type is A.FIRST_TRANSACTION:
            return min(1, await counted("_count_user_transactions"))
        if achievement_type in (A.HUNDRED_TRANSACTIONS, A.THOUSAND_TRANSACTIONS):
            return await counted("_count_user_transactions")
        if achievement_type is A.FIRST_GOAL:
            return min(1, await counted("_count_user_goals"))
        if achievement_type in (A.GOAL_COMPLETED, A.FIVE_GOALS_COMPLETED):
            return await counted("_count_completed_goals")
        if achievement_type is A.FIRST_SAVINGS_MILESTONE:
            return await counted("_count_completed_milestones")
        if achievement_type is A.EMERGENCY_FUND_BUILT:
            return await counted("_count_completed_emergency_goals")
        if achievement_type is A.INVESTMENT_STARTER:
            return await counted("_count_holdings")
        if achievement_type is A.DIVERSIFIED_PORTFOLIO:
            return await counted("_count_distinct_asset_types")
        if achievement_type is A.LOCAL_INVESTMENT_EXPLORER:
            return await counted("_count_local_investments")
        if achievement_type is A.QR_PAYMENT_MASTER:
            return await counted("_count_qr_payments")
        if achievement_type is A.DIGITAL_WALLET_USER:
            return await counted("_count_ewallet_payments")
        if achievement_type is A.MULTI_CURRENCY_TRACKER:
            return await counted("_count_currencies_used")
        if achievement_type is A.EXPENSE_TRACKER:
            return await counted("_count_expense_tracking_days")
        if achievement_type is A.REFERRAL_CHAMPION:
            return await counted("_count_referrals")
        if achievement_type in (
            A.DAILY_LOGIN_STREAK_7,
            A.DAILY_LOGIN_STREAK_30,
            A.DAILY_LOGIN_STREAK_100,
        ):
            return user.current_login_streak
        if achievement_type is A.EARLY_ADOPTER:
            return user.level

        # Untracked types (see ACHIEVEMENT_CATALOGUE) have no signal yet.
        return 0

    async def _count_user_transactions(self, user_id: UUID) -> int:
        """Count user's total transactions"""
        try:
            # Import here to avoid circular imports
            from ..transactions.models import Transaction
            
            query = select(func.count(Transaction.id)).where(Transaction.user_id == user_id)
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0
    
    async def _count_user_goals(self, user_id: UUID) -> int:
        """Count user's total goals"""
        try:
            from ..goals.models import Goal

            query = select(func.count(Goal.id)).where(Goal.user_id == user_id)
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0

    async def _count_completed_goals(self, user_id: UUID) -> int:
        """Count user's completed goals"""
        try:
            from ..goals.models import Goal, GoalStatus

            query = select(func.count(Goal.id)).where(
                and_(
                    Goal.user_id == user_id,
                    Goal.status == GoalStatus.COMPLETED,
                )
            )
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0

    async def _count_qr_payments(self, user_id: UUID) -> int:
        """Count QR payments made by user"""
        try:
            from ..transactions.models import PaymentMethod, Transaction

            # Filter on enum members, not raw strings: the column is a plain
            # ``Enum(PaymentMethod)`` so it persists member *names* (LINE_PAY),
            # and comparing against lowercase values silently matched nothing.
            qr_methods = [
                PaymentMethod.QR_CODE,
                PaymentMethod.WECHAT_PAY,
                PaymentMethod.ALIPAY,
                PaymentMethod.LINE_PAY,
                PaymentMethod.SHOPEE_PAY,
                PaymentMethod.GRAB_PAY,
                PaymentMethod.MOMO,
                PaymentMethod.PAYNOW,
            ]
            query = select(func.count(Transaction.id)).where(
                and_(
                    Transaction.user_id == user_id,
                    Transaction.payment_method.in_(qr_methods),
                )
            )
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0

    async def _count_ewallet_payments(self, user_id: UUID) -> int:
        """Count e-wallet payments made by user"""
        try:
            from ..transactions.models import PaymentMethod, Transaction

            ewallet_methods = [
                PaymentMethod.DIGITAL_WALLET,
                PaymentMethod.TOUCH_N_GO,
                PaymentMethod.BOOST,
                PaymentMethod.GCASH,
                PaymentMethod.DANA,
                PaymentMethod.OVO,
                PaymentMethod.GOPAY,
                PaymentMethod.LINE_PAY,
            ]
            query = select(func.count(Transaction.id)).where(
                and_(
                    Transaction.user_id == user_id,
                    Transaction.payment_method.in_(ewallet_methods),
                )
            )
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0

    async def _count_expense_tracking_days(self, user_id: UUID) -> int:
        """Count distinct days on which the user logged an expense"""
        try:
            from ..transactions.models import Transaction, TransactionType

            query = select(
                func.count(func.distinct(Transaction.transaction_date))
            ).where(
                and_(
                    Transaction.user_id == user_id,
                    Transaction.type == TransactionType.EXPENSE,
                )
            )
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0

    async def _count_completed_milestones(self, user_id: UUID) -> int:
        """Count goal milestones the user has reached"""
        try:
            from ..goals.models import Goal, GoalMilestone

            query = (
                select(func.count(GoalMilestone.id))
                .join(Goal, Goal.id == GoalMilestone.goal_id)
                .where(
                    and_(
                        Goal.user_id == user_id,
                        GoalMilestone.is_completed.is_(True),
                    )
                )
            )
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0

    async def _count_completed_emergency_goals(self, user_id: UUID) -> int:
        """Count completed emergency-fund goals"""
        try:
            from ..goals.models import Goal, GoalCategory, GoalStatus

            query = select(func.count(Goal.id)).where(
                and_(
                    Goal.user_id == user_id,
                    Goal.category == GoalCategory.EMERGENCY_FUND,
                    Goal.status == GoalStatus.COMPLETED,
                )
            )
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0

    async def _count_holdings(self, user_id: UUID) -> int:
        """Count the user's portfolio holdings"""
        try:
            from ..portfolio.models import PortfolioHolding

            query = select(func.count(PortfolioHolding.id)).where(
                PortfolioHolding.user_id == user_id
            )
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0

    async def _count_distinct_asset_types(self, user_id: UUID) -> int:
        """Count distinct asset types held by the user"""
        try:
            from ..portfolio.models import PortfolioHolding

            query = select(
                func.count(func.distinct(PortfolioHolding.type))
            ).where(PortfolioHolding.user_id == user_id)
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0

    async def _count_local_investments(self, user_id: UUID) -> int:
        """Count holdings in Asia-specific instruments"""
        try:
            from ..portfolio.models import PortfolioHolding

            query = select(func.count(PortfolioHolding.id)).where(
                and_(
                    PortfolioHolding.user_id == user_id,
                    PortfolioHolding.type.in_(
                        ["cpf", "gold_savings", "regional_fund"]
                    ),
                )
            )
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0

    async def _count_referrals(self, user_id: UUID) -> int:
        """Count users who signed up through this user's referral code"""
        try:
            query = select(func.count(User.id)).where(
                and_(
                    User.referred_by_user_id == user_id,
                    User.deleted_at.is_(None),
                )
            )
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0


    async def _count_currencies_used(self, user_id: UUID) -> int:
        """Count distinct currencies used by user"""
        try:
            from ..transactions.models import Transaction
            
            query = select(func.count(func.distinct(Transaction.currency))).where(
                Transaction.user_id == user_id
            )
            result = await self.session.execute(query)
            return result.scalar() or 0
        except Exception:
            return 0
    
    async def update_user_level(self, user_id: UUID) -> Optional[int]:
        """
        Update user level based on experience points.
        
        Returns:
            New level if changed, None if no change
        """
        try:
            user_query = select(User).where(User.id == user_id)
            result = await self.session.execute(user_query)
            user = result.scalar_one_or_none()
            
            if not user:
                return None
            
            # Calculate new level (100 XP per level, increasing by 50 each level)
            new_level = self._calculate_level_from_xp(user.experience_points)
            
            if new_level > user.level:
                await self.session.execute(
                    update(User)
                    .where(User.id == user_id)
                    .values(level=new_level)
                )
                await self.session.commit()
                
                # Award level up achievement if significant milestone
                if new_level % 5 == 0:  # Every 5 levels
                    await self.award_achievement(
                        user_id,
                        AchievementType.EARLY_ADOPTER,  # Reuse for level milestones
                        points=new_level * 50,
                        rarity=AchievementRarity.RARE,
                        achievement_data={"level_reached": new_level}
                    )
                
                logger.info(f"User {user_id} leveled up to level {new_level}")
                return new_level
            
            return None
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error updating user level: {str(e)}")
            return None
    
    def _calculate_level_from_xp(self, experience_points: int) -> int:
        """Calculate user level from experience points"""
        return level_for_experience(experience_points)


    def _calculate_xp_for_next_level(self, current_level: int) -> int:
        """Calculate XP required for next level"""
        next_level = current_level + 1
        return (next_level * next_level) * 50


class UserActivityRepository:
    """Repository for user activity tracking and analytics"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def log_activity(
        self,
        user_id: UUID,
        activity_type: str,
        activity_data: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> UserActivityLog:
        """Log user activity for analytics and engagement tracking"""
        try:
            activity_log = UserActivityLog(
                user_id=user_id,
                activity_type=activity_type,
                activity_data=activity_data or {},
                session_id=session_id,
                ip_address=ip_address,
                user_agent=user_agent
            )
            
            self.session.add(activity_log)
            await self.session.commit()
            await self.session.refresh(activity_log)
            
            logger.debug(f"Logged activity {activity_type} for user {user_id}")
            return activity_log
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error logging user activity: {str(e)}")
            raise
    
    async def get_user_activities(
        self,
        user_id: UUID,
        activity_types: Optional[List[str]] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[UserActivityLog]:
        """Get user activities with filtering"""
        try:
            query = select(UserActivityLog).where(UserActivityLog.user_id == user_id)
            
            if activity_types:
                query = query.where(UserActivityLog.activity_type.in_(activity_types))
            
            if start_date:
                query = query.where(UserActivityLog.created_at >= start_date)
            
            if end_date:
                query = query.where(UserActivityLog.created_at <= end_date)
            
            query = query.order_by(desc(UserActivityLog.created_at)).limit(limit).offset(offset)
            
            result = await self.session.execute(query)
            return result.scalars().all()
            
        except Exception as e:
            logger.error(f"Error getting user activities: {str(e)}")
            return []
    
    async def get_user_engagement_metrics(
        self, 
        user_id: UUID,
        days_back: int = 30
    ) -> Dict[str, Any]:
        """Calculate user engagement metrics"""
        try:
            end_date = datetime.now(timezone.utc)
            start_date = end_date - timedelta(days=days_back)
            
            # Get recent activities
            activities = await self.get_user_activities(
                user_id, 
                start_date=start_date, 
                end_date=end_date,
                limit=1000
            )
            
            # Calculate metrics
            total_sessions = len(set(act.session_id for act in activities if act.session_id))
            unique_days = len(set(act.created_at.date() for act in activities))
            features_used = list(set(act.activity_type for act in activities))
            
            # Calculate engagement scores (0-100)
            daily_score = min(100, (unique_days / days_back) * 100)
            feature_diversity_score = min(100, len(features_used) * 10)
            session_frequency_score = min(100, (total_sessions / days_back) * 20)
            
            overall_engagement = (daily_score + feature_diversity_score + session_frequency_score) / 3
            
            # Determine trend
            recent_activities = [act for act in activities if act.created_at >= end_date - timedelta(days=7)]
            older_activities = [act for act in activities if act.created_at < end_date - timedelta(days=7)]
            
            recent_engagement = len(recent_activities) / 7 if recent_activities else 0
            older_engagement = len(older_activities) / (days_back - 7) if older_activities else 0
            
            if recent_engagement > older_engagement * 1.1:
                trend = "increasing"
            elif recent_engagement < older_engagement * 0.9:
                trend = "decreasing"
            else:
                trend = "stable"
            
            return {
                "user_id": user_id,
                "total_sessions": total_sessions,
                "average_session_duration": 15.0,  # Placeholder - would need session tracking
                "last_active": activities[0].created_at if activities else None,
                "features_used": features_used,
                "daily_engagement_score": daily_score,
                "weekly_engagement_score": min(100, (unique_days / 7) * 100) if days_back >= 7 else daily_score,
                "monthly_engagement_score": daily_score,
                "engagement_trend": trend
            }
            
        except Exception as e:
            logger.error(f"Error calculating engagement metrics: {str(e)}")
            return {
                "user_id": user_id,
                "total_sessions": 0,
                "average_session_duration": 0.0,
                "features_used": [],
                "daily_engagement_score": 0.0,
                "weekly_engagement_score": 0.0,
                "monthly_engagement_score": 0.0,
                "engagement_trend": "stable"
            }


class UserSecurityRepository:
    """Repository for user security and audit logging"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def log_security_event(
        self,
        user_id: Optional[UUID],
        event_type: str,
        event_description: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        risk_level: str = "low",
        metadata: Optional[Dict[str, Any]] = None
    ) -> UserSecurityLog:
        """Log security events for audit and monitoring"""
        try:
            security_log = UserSecurityLog(
                user_id=user_id,
                event_type=event_type,
                event_description=event_description,
                ip_address=ip_address,
                user_agent=user_agent,
                risk_level=risk_level,
                metadata=metadata or {}
            )
            
            self.session.add(security_log)
            await self.session.commit()
            await self.session.refresh(security_log)
            
            logger.info(f"Logged security event {event_type} for user {user_id} (risk: {risk_level})")
            return security_log
            
        except Exception as e:
            await self.session.rollback()
            logger.error(f"Error logging security event: {str(e)}")
            raise
    
# Repository factory functions
def get_gamification_repository(session: AsyncSession) -> GamificationRepository:
    """Get gamification repository instance"""
    return GamificationRepository(session)


def get_user_activity_repository(session: AsyncSession) -> UserActivityRepository:
    """Get user activity repository instance"""
    return UserActivityRepository(session)


def get_user_security_repository(session: AsyncSession) -> UserSecurityRepository:
    """Get user security repository instance"""
    return UserSecurityRepository(session)