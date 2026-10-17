"""
Test suite for user gamification and enhanced user management features.

This module tests the gamification system, user analytics, achievements,
regional preferences, and security features for Asian market integration.
"""

import pytest
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users.models import (
    User, UserGamificationAchievement, UserActivityLog, AchievementType, 
    AchievementRarity, UserStatus, UserRole
)
from app.modules.users.schemas import (
    UserGamificationStats, AchievementResponse, UserActivityRequest,
    RegionalPreferencesUpdate, DataExportRequest
)
from app.modules.users.gamification_service import (
    GamificationService,
    UserAnalyticsService,
    compute_login_streak,
)
from app.modules.users.gamification_repository import (
    GamificationRepository,
    level_for_experience,
)
from app.modules.users.achievement_catalogue import ACHIEVEMENT_CATALOGUE
from app.modules.users.repositories import UserRepository


class TestGamificationRepository:
    """Test gamification repository operations"""
    
    @pytest.fixture
    def mock_session(self):
        """Create mock async session"""
        session = AsyncMock(spec=AsyncSession)
        return session
    
    @pytest.fixture
    def gamification_repo(self, mock_session):
        """Create gamification repository with mock session"""
        return GamificationRepository(mock_session)
    
    @pytest.fixture
    def sample_user(self):
        """Create sample user for testing"""
        return User(
            id=uuid4(),
            email="test@example.com",
            name="Test User",
            experience_points=0,
            level=1,
            current_login_streak=0,
            longest_login_streak=0,
            status=UserStatus.ACTIVE,
            role=UserRole.USER
        )
    
    @pytest.mark.asyncio
    async def test_award_achievement_new(self, gamification_repo, sample_user):
        """Test awarding a new achievement"""
        # Mock no existing achievement — result must be MagicMock (sync), not AsyncMock
        mock_check_result = MagicMock()
        mock_check_result.scalar_one_or_none.return_value = None
        mock_update_result = MagicMock()
        gamification_repo.session.execute = AsyncMock(
            side_effect=[mock_check_result, mock_update_result]
        )

        # Mock successful creation (session.add is sync, commit/refresh are async)
        gamification_repo.session.add = MagicMock()
        gamification_repo.session.commit = AsyncMock()
        gamification_repo.session.refresh = AsyncMock()
        
        achievement = await gamification_repo.award_achievement(
            sample_user.id,
            AchievementType.FIRST_TRANSACTION,
            points=100,
            rarity=AchievementRarity.COMMON
        )
        
        assert achievement is not None
        gamification_repo.session.add.assert_called_once()
        gamification_repo.session.commit.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_award_achievement_existing(self, gamification_repo, sample_user):
        """Test awarding achievement that already exists"""
        # Mock existing achievement
        existing_achievement = UserGamificationAchievement(
            id=uuid4(),
            user_id=sample_user.id,
            achievement_type=AchievementType.FIRST_TRANSACTION,
            points_awarded=100,
            rarity=AchievementRarity.COMMON,
            unlocked_at=datetime.now(timezone.utc)
        )
        
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_achievement
        gamification_repo.session.execute = AsyncMock(return_value=mock_result)
        
        achievement = await gamification_repo.award_achievement(
            sample_user.id,
            AchievementType.FIRST_TRANSACTION,
            points=100
        )
        
        assert achievement is None
        # Should not try to create new achievement
        gamification_repo.session.add.assert_not_called()
    
    @pytest.mark.asyncio
    async def test_get_user_achievements(self, gamification_repo, sample_user):
        """Test retrieving user achievements"""
        mock_achievements = [
            UserGamificationAchievement(
                id=uuid4(),
                user_id=sample_user.id,
                achievement_type=AchievementType.FIRST_TRANSACTION,
                points_awarded=100,
                rarity=AchievementRarity.COMMON,
                unlocked_at=datetime.now(timezone.utc)
            )
        ]
        
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = mock_achievements
        gamification_repo.session.execute = AsyncMock(return_value=mock_result)
        
        achievements = await gamification_repo.get_user_achievements(sample_user.id)
        
        assert len(achievements) == 1
        assert achievements[0].achievement_type == AchievementType.FIRST_TRANSACTION
    
    @pytest.mark.asyncio
    async def test_calculate_level_from_xp(self, gamification_repo):
        """Test level calculation from experience points"""
        assert gamification_repo._calculate_level_from_xp(0) == 1
        assert gamification_repo._calculate_level_from_xp(100) == 1
        assert gamification_repo._calculate_level_from_xp(200) == 2
        assert gamification_repo._calculate_level_from_xp(450) == 3
        assert gamification_repo._calculate_level_from_xp(800) == 4


class TestGamificationService:
    """Test gamification service operations"""
    
    @pytest.fixture
    def mock_session(self):
        """Create mock async session"""
        session = AsyncMock(spec=AsyncSession)
        return session
    
    @pytest.fixture
    def gamification_service(self, mock_session):
        """Create gamification service with mock session"""
        service = GamificationService(mock_session)
        service.gamification_repo = AsyncMock(spec=GamificationRepository)
        service.user_repo = AsyncMock(spec=UserRepository)
        service.activity_repo = AsyncMock()
        service.security_repo = AsyncMock()
        return service
    
    @pytest.fixture
    def sample_user(self):
        """Create sample user for testing"""
        return User(
            id=uuid4(),
            email="test@example.com",
            name="Test User",
            experience_points=250,
            level=2,
            current_login_streak=5,
            longest_login_streak=10,
            status=UserStatus.ACTIVE,
            role=UserRole.USER,
            preferences={}
        )
    
    @pytest.mark.asyncio
    async def test_get_user_gamification_stats(self, gamification_service, sample_user):
        """Test retrieving user gamification statistics"""
        # Mock repository responses
        gamification_service.user_repo.get_user_by_id.return_value = sample_user
        gamification_service.gamification_repo.get_user_achievements.return_value = []
        gamification_service._calculate_regional_scores = AsyncMock(return_value={
            "digital_adoption": 75,
            "savings_discipline": 60,
            "investment_knowledge": 40,
            "community_engagement": 30
        })
        
        stats = await gamification_service.get_user_gamification_stats(sample_user.id)
        
        assert isinstance(stats, UserGamificationStats)
        assert stats.user_id == sample_user.id
        assert stats.level == 2
        assert stats.experience_points == 250
        assert stats.digital_adoption_score == 75
        # streak_info may be a dict or UserStreakInfo object depending on implementation
        streak_info = stats.streak_info
        if hasattr(streak_info, 'current_login_streak'):
            assert streak_info.current_login_streak == 5
        else:
            assert streak_info["current_login_streak"] == 5
    
    @pytest.mark.asyncio
    async def test_trigger_achievement_check_transaction(self, gamification_service, sample_user):
        """Test achievement checking for transaction creation"""
        mock_achievement = UserGamificationAchievement(
            id=uuid4(),
            user_id=sample_user.id,
            achievement_type=AchievementType.FIRST_TRANSACTION,
            points_awarded=100,
            rarity=AchievementRarity.COMMON,
            unlocked_at=datetime.now(timezone.utc)
        )
        
        gamification_service._check_and_award_achievement = AsyncMock(return_value=AchievementResponse(
            id=mock_achievement.id,
            user_id=mock_achievement.user_id,
            achievement_type=mock_achievement.achievement_type.value,
            points_awarded=mock_achievement.points_awarded,
            rarity=mock_achievement.rarity.value,
            unlocked_at=mock_achievement.unlocked_at,
            title="First Steps",
            description="Recorded your first transaction",
            icon="📝",
            category="financial"
        ))
        
        gamification_service.gamification_repo.update_user_level.return_value = None
        
        new_achievements = await gamification_service.trigger_achievement_check(
            sample_user.id, "transaction_created"
        )
        
        assert len(new_achievements) >= 1
        assert any(a.achievement_type == "first_transaction" for a in new_achievements)
    
    @pytest.mark.asyncio
    async def test_get_achievement_metadata(self, gamification_service):
        """Test achievement metadata retrieval"""
        metadata = gamification_service._get_achievement_metadata(AchievementType.FIRST_TRANSACTION)
        
        assert metadata["title"] == "First Steps"
        assert metadata["description"] == "Record your first transaction"
        assert metadata["icon"] == "📝"
        assert metadata["category"] == "financial"
    
    @pytest.mark.asyncio
    async def test_get_achievement_reward(self, gamification_service):
        """Test achievement reward calculation"""
        points, rarity = gamification_service._get_achievement_reward(AchievementType.FIRST_TRANSACTION)
        
        assert points == 100
        assert rarity == AchievementRarity.COMMON
        
        points, rarity = gamification_service._get_achievement_reward(AchievementType.DAILY_LOGIN_STREAK_100)
        
        assert points == 5000
        assert rarity == AchievementRarity.LEGENDARY


class TestUserAnalyticsService:
    """Test user analytics service operations"""
    
    @pytest.fixture
    def mock_session(self):
        """Create mock async session"""
        session = AsyncMock(spec=AsyncSession)
        return session
    
    @pytest.fixture
    def analytics_service(self, mock_session):
        """Create analytics service with mock session"""
        service = UserAnalyticsService(mock_session)
        service.activity_repo = AsyncMock()
        # spec= matters: an unspecced AsyncMock happily accepts calls to methods
        # the real repository doesn't have, which is how a call to a
        # non-existent `update_user_data` shipped while these tests stayed green.
        service.user_repo = AsyncMock(spec=UserRepository)
        return service
    
    @pytest.fixture
    def sample_user(self):
        """Create sample user for testing"""
        return User(
            id=uuid4(),
            email="test@example.com",
            name="Test User",
            current_login_streak=5,
            longest_login_streak=10,
            last_streak_update=datetime.now(timezone.utc) - timedelta(days=1),
            status=UserStatus.ACTIVE,
            role=UserRole.USER
        )
    
    @pytest.mark.asyncio
    async def test_log_user_activity(self, analytics_service, sample_user):
        """Test logging user activity"""
        mock_activity_log = UserActivityLog(
            id=uuid4(),
            user_id=sample_user.id,
            activity_type="transaction_created",
            activity_data={"amount": 100},
            session_id="session123",
            created_at=datetime.now(timezone.utc)
        )
        
        analytics_service.activity_repo.log_activity.return_value = mock_activity_log
        
        activity_request = UserActivityRequest(
            activity_type="transaction_created",
            activity_data={"amount": 100},
            session_id="session123"
        )
        
        response = await analytics_service.log_user_activity(
            sample_user.id, activity_request, "127.0.0.1", "test-agent"
        )
        
        assert response.activity_type == "transaction_created"
        assert response.user_id == sample_user.id
        analytics_service.activity_repo.log_activity.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_update_login_streak_consecutive(self, analytics_service, sample_user):
        """Test updating login streak for consecutive day"""
        sample_user.last_streak_update = datetime.now(timezone.utc) - timedelta(days=1)
        analytics_service.user_repo.get_user_by_id.return_value = sample_user

        # Mock gamification service for achievement checks
        with patch.object(analytics_service, 'session') as mock_session:
            with patch('app.modules.users.gamification_service.GamificationService') as MockGamificationService:
                mock_gamification = MockGamificationService.return_value
                mock_gamification.trigger_achievement_check = AsyncMock(return_value=[])

                result = await analytics_service.update_login_streak(sample_user.id)

        assert result["current_streak"] == 6  # 5 + 1
        assert result["longest_streak"] == 10  # No change
        assert result["streak_updated"] == True

        # The new count must actually be persisted, not just returned.
        analytics_service.user_repo.update_user.assert_awaited_once()
        _, payload = analytics_service.user_repo.update_user.await_args.args
        assert payload["current_login_streak"] == 6
        assert payload["longest_login_streak"] == 10
        assert payload["last_streak_update"] is not None

    @pytest.mark.asyncio
    async def test_update_login_streak_broken(self, analytics_service, sample_user):
        """Test updating login streak when broken"""
        # Set last update to 3 days ago (streak broken)
        sample_user.last_streak_update = datetime.now(timezone.utc) - timedelta(days=3)

        analytics_service.user_repo.get_user_by_id.return_value = sample_user

        with patch.object(analytics_service, 'session') as mock_session:
            with patch('app.modules.users.gamification_service.GamificationService') as MockGamificationService:
                mock_gamification = MockGamificationService.return_value
                mock_gamification.trigger_achievement_check = AsyncMock(return_value=[])

                result = await analytics_service.update_login_streak(sample_user.id)

        assert result["current_streak"] == 1  # Reset to 1
        assert result["longest_streak"] == 10  # No change
        assert result["streak_updated"] == True

        analytics_service.user_repo.update_user.assert_awaited_once()
        _, payload = analytics_service.user_repo.update_user.await_args.args
        assert payload["current_login_streak"] == 1

    @pytest.mark.asyncio
    async def test_update_login_streak_is_idempotent_within_a_day(
        self, analytics_service, sample_user
    ):
        """A second visit on the same calendar day must not advance the streak"""
        sample_user.last_streak_update = datetime.now(timezone.utc)
        analytics_service.user_repo.get_user_by_id.return_value = sample_user

        result = await analytics_service.update_login_streak(sample_user.id)

        assert result["current_streak"] == 5  # unchanged
        assert result["streak_updated"] is False
        analytics_service.user_repo.update_user.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_update_login_streak_first_ever_login(
        self, analytics_service, sample_user
    ):
        """A user with no recorded streak starts at 1 rather than staying at 0"""
        sample_user.last_streak_update = None
        sample_user.current_login_streak = 0
        sample_user.longest_login_streak = 0
        analytics_service.user_repo.get_user_by_id.return_value = sample_user

        with patch('app.modules.users.gamification_service.GamificationService') as MockGamificationService:
            MockGamificationService.return_value.trigger_achievement_check = AsyncMock(
                return_value=[]
            )
            result = await analytics_service.update_login_streak(sample_user.id)

        assert result["current_streak"] == 1
        assert result["longest_streak"] == 1
        assert result["streak_updated"] is True


class TestEnhancedUserAPI:
    """Test enhanced user management API endpoints"""

    @pytest.fixture
    def mock_current_user(self):
        """Mock current user for authentication"""
        return User(
            id=uuid4(),
            email="test@example.com",
            name="Test User",
            hashed_password="$2b$12$fakehash",
            is_active=True,
            is_verified=True,
            experience_points=500,
            level=3,
            current_login_streak=7,
            longest_login_streak=15,
            status=UserStatus.ACTIVE,
            role=UserRole.USER,
            preferences={}
        )

    @pytest.fixture
    def client(self, mock_current_user, override_get_async_session):
        """Create test client with auth and DB session dependencies overridden"""
        from app.main import app as fastapi_app
        from app.modules.users.dependencies import get_current_active_user
        from app.core.database import get_async_session, get_db

        fastapi_app.dependency_overrides[get_current_active_user] = lambda: mock_current_user
        fastapi_app.dependency_overrides[get_async_session] = override_get_async_session
        fastapi_app.dependency_overrides[get_db] = override_get_async_session
        with TestClient(fastapi_app) as c:
            yield c
        fastapi_app.dependency_overrides.clear()

    def test_get_gamification_stats_endpoint(self, client, mock_current_user):
        """Test gamification stats API endpoint requires auth"""
        with patch('app.modules.users.enhanced_router.get_gamification_service') as mock_service_factory:
            mock_svc = MagicMock()
            mock_svc.get_user_gamification_stats = AsyncMock(return_value=UserGamificationStats(
                user_id=mock_current_user.id,
                level=3,
                experience_points=500,
                experience_to_next_level=300,
                total_achievements=5,
                achievements_by_rarity={"common": 3, "rare": 2},
                streak_info={
                    "current_login_streak": 7,
                    "longest_login_streak": 15,
                    "last_streak_update": datetime.now(timezone.utc),
                    "streak_bonus_earned": 70,
                },
                recent_achievements=[],
                digital_adoption_score=80,
                savings_discipline_score=65,
                investment_knowledge_score=45,
                community_engagement_score=35,
            ))
            mock_service_factory.return_value = mock_svc

            response = client.get("/api/v1/users/me/gamification")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["level"] == 3
            assert data["data"]["experience_points"] == 500
            assert data["data"]["digital_adoption_score"] == 80

    def test_update_regional_preferences_endpoint(self, client, mock_current_user):
        """Test regional preferences update API endpoint"""
        preferences_update = {
            "preferred_language": "zh-TW",
            "preferred_currency": "TWD",
            "timezone": "Asia/Taipei",
            "date_format": "roc",
            "number_format": "asian",
            "payment_methods": ["line_pay", "jko_pay"],
        }

        from app.modules.users.schemas import UserResponse as _UserResponse
        mock_user_response = MagicMock(spec=_UserResponse)

        with patch('app.modules.users.enhanced_router.get_user_service') as mock_user_service_factory:
            with patch('app.modules.users.enhanced_router.get_user_analytics_service') as mock_analytics_factory:
                with patch('app.modules.users.enhanced_router.UserResponse') as mock_ur_cls:
                    mock_svc = MagicMock()
                    mock_svc.update_user_data = AsyncMock(return_value=mock_current_user)
                    mock_user_service_factory.return_value = mock_svc
                    mock_ur_cls.model_validate.return_value = mock_user_response

                    mock_analytics_svc = MagicMock()
                    mock_analytics_svc.log_user_activity = AsyncMock()
                    mock_analytics_factory.return_value = mock_analytics_svc

                    response = client.put(
                        "/api/v1/users/me/regional-preferences",
                        json=preferences_update,
                    )

                    assert response.status_code == 200

class TestRegionalFeatures:
    """Test regional features for Asian markets"""
    
    def test_asian_language_support(self):
        """Test Asian language validation"""
        preferences = RegionalPreferencesUpdate(
            preferred_language="zh-TW",
            preferred_currency="TWD",
            date_format="roc",
            number_format="asian"
        )
        
        assert preferences.preferred_language == "zh-TW"
        assert preferences.preferred_currency == "TWD"
        assert preferences.date_format == "roc"
        assert preferences.number_format == "asian"
    
    def test_cultural_calendar_support(self):
        """Test cultural calendar preferences"""
        preferences = RegionalPreferencesUpdate(
            cultural_calendar="lunar",
            payment_methods=["wechat_pay", "alipay", "grab_pay"]
        )
        
        assert preferences.cultural_calendar == "lunar"
        assert "wechat_pay" in preferences.payment_methods
        assert "grab_pay" in preferences.payment_methods
    
    def test_regional_achievement_types(self):
        """Test regional achievement types for Asian markets"""
        regional_achievements = [
            AchievementType.QR_PAYMENT_MASTER,
            AchievementType.DIGITAL_WALLET_USER,
            AchievementType.MULTI_CURRENCY_TRACKER,
            AchievementType.LUNAR_NEW_YEAR_SAVER,
            AchievementType.FAMILY_SAVER
        ]
        
        for achievement in regional_achievements:
            assert achievement.value in [
                "qr_payment_master",
                "digital_wallet_user", 
                "multi_currency_tracker",
                "lunar_new_year_saver",
                "family_saver"
            ]


class TestSecurityFeatures:
    """Test security and privacy features"""
    
    def test_data_export_request_validation(self):
        """Test data export request validation"""
        # Valid request
        valid_request = DataExportRequest(
            export_type="full_export",
            format="json"
        )
        assert valid_request.export_type == "full_export"
        assert valid_request.format == "json"
        
        # Test specific data categories
        specific_request = DataExportRequest(
            export_type="specific_data",
            data_categories=["transactions", "goals"],
            format="csv"
        )
        assert specific_request.export_type == "specific_data"
        assert len(specific_request.data_categories) == 2
    
class TestAchievementCatalogue:
    """The catalogue is the single source of truth for badge metadata."""

    def test_covers_every_achievement_type(self):
        """Every enum member needs an entry, or it renders as a raw enum value."""
        missing = [t.value for t in AchievementType if t not in ACHIEVEMENT_CATALOGUE]
        assert missing == [], f"achievement types missing from catalogue: {missing}"

    def test_requirements_are_positive(self):
        """required_progress of 0 would divide by zero when computing percentage."""
        bad = [
            t.value
            for t, definition in ACHIEVEMENT_CATALOGUE.items()
            if definition.required_progress < 1
        ]
        assert bad == []

    def test_tracked_achievements_have_tips(self):
        """Tips drive the 'how do I earn this' panel on the achievements page."""
        missing = [
            t.value
            for t, definition in ACHIEVEMENT_CATALOGUE.items()
            if definition.tracked and not definition.tips
        ]
        assert missing == []


class TestLevelCalculation:
    """One formula, used by every code path that writes User.level."""

    def test_matches_xp_for_next_level(self, ):
        """level_for_experience must invert _calculate_xp_for_next_level.

        They disagreed once (sqrt(xp/50) vs sqrt(xp/100)), so logging in could
        drop a user's displayed level.
        """
        repo = GamificationRepository(AsyncMock(spec=AsyncSession))
        for level in range(1, 20):
            xp_needed = repo._calculate_xp_for_next_level(level)
            assert level_for_experience(xp_needed) == level + 1
            assert level_for_experience(xp_needed - 1) == level

    def test_floor_and_cap(self):
        assert level_for_experience(0) == 1
        assert level_for_experience(99) == 1
        assert level_for_experience(10_000_000) == 100

    def test_never_decreases_as_xp_grows(self):
        levels = [level_for_experience(xp) for xp in range(0, 20_000, 137)]
        assert levels == sorted(levels)


class TestLoginStreakCalculation:
    """Rules shared by the login path and the /me/streak/update endpoint."""

    @staticmethod
    def _now():
        return datetime(2026, 7, 26, 10, 0, tzinfo=timezone.utc)

    def test_first_ever_login_starts_at_one(self):
        assert compute_login_streak(None, 0, self._now()) == (1, True)

    def test_consecutive_day_increments(self):
        yesterday = self._now() - timedelta(days=1)
        assert compute_login_streak(yesterday, 6, self._now()) == (7, True)

    def test_same_day_does_not_advance(self):
        earlier_today = self._now() - timedelta(hours=3)
        assert compute_login_streak(earlier_today, 7, self._now()) == (7, False)

    def test_missed_day_resets_to_one(self):
        three_days_ago = self._now() - timedelta(days=3)
        assert compute_login_streak(three_days_ago, 12, self._now()) == (1, True)

    # The day boundary is the business one (Asia/Taipei), not UTC. The cases above
    # cannot tell: _now() is 10:00 UTC, which is 18:00 Taipei, so both clocks agree
    # on the date and reverting to `now.date()` would keep them all green. These two
    # are chosen so the UTC and Taipei answers differ.

    def test_two_logins_in_one_taipei_day_do_not_advance_it(self):
        """23:00 and 01:00 UTC are different UTC days, one Taipei day.

        2026-07-27 07:00 and 09:00 in Taipei — the user logged in twice on the same
        morning. On the UTC day this reads as two days and hands out a second
        increment; worse, an intervening gap resets a streak the user never broke.
        """
        first = datetime(2026, 7, 26, 23, 0, tzinfo=timezone.utc)   # 07:00 Taipei, 27th
        second = datetime(2026, 7, 27, 1, 0, tzinfo=timezone.utc)   # 09:00 Taipei, 27th

        assert compute_login_streak(first, 3, second) == (3, False)

    def test_a_new_taipei_day_advances_it_within_one_utc_day(self):
        """14:00 and 17:00 UTC are one UTC day, two Taipei days.

        2026-07-26 22:00 and 2026-07-27 01:00 in Taipei — the user came back after
        midnight. On the UTC day this looks like the same day and the streak stalls.
        """
        before_midnight = datetime(2026, 7, 26, 14, 0, tzinfo=timezone.utc)  # 22:00, 26th
        after_midnight = datetime(2026, 7, 26, 17, 0, tzinfo=timezone.utc)   # 01:00, 27th

        assert compute_login_streak(before_midnight, 3, after_midnight) == (4, True)

    def test_naive_timestamp_is_treated_as_utc(self):
        """Rows written before the column was tz-aware come back naive."""
        naive_yesterday = (self._now() - timedelta(days=1)).replace(tzinfo=None)
        assert compute_login_streak(naive_yesterday, 6, self._now()) == (7, True)

    def test_future_timestamp_leaves_streak_alone(self):
        """Clock skew must not reset or inflate an existing streak."""
        tomorrow = self._now() + timedelta(days=1)
        assert compute_login_streak(tomorrow, 4, self._now()) == (4, False)


# Integration test markers (intentionally omitted — async tests carry explicit @pytest.mark.asyncio)