"""Single source of truth for the achievement catalogue.

Title, description, icon, category, rarity, point value and completion
requirement for every :class:`AchievementType` live here.

This used to be spread across three maps that drifted out of sync — progress
definitions in ``gamification_repository``, plus ``_get_achievement_reward`` and
``_get_achievement_metadata`` in ``gamification_service``. A type present in one
map but missing from another rendered as "Achievement: financial_literacy" with
a progress bar frozen at 0%. Adding a new achievement now means adding one entry
here (and a counter in the repository if it needs one).
"""

from dataclasses import dataclass, field
from typing import Dict, Tuple

from .models import AchievementRarity, AchievementType


@dataclass(frozen=True)
class AchievementDefinition:
    """Static description of a single achievement."""

    title: str
    description: str
    category: str
    icon: str
    rarity: AchievementRarity
    points: int
    required_progress: int
    tips: Tuple[str, ...] = field(default_factory=tuple)
    #: False when no feature emits a signal for this achievement yet, so its
    #: progress can never move. Untracked entries are hidden from the progress
    #: feed rather than shown as a permanently-empty bar.
    tracked: bool = True


ACHIEVEMENT_CATALOGUE: Dict[AchievementType, AchievementDefinition] = {
    # ----- Financial milestones -------------------------------------------
    AchievementType.FIRST_TRANSACTION: AchievementDefinition(
        title="First Steps",
        description="Record your first transaction",
        category="financial",
        icon="📝",
        rarity=AchievementRarity.COMMON,
        points=100,
        required_progress=1,
        tips=(
            "Add any expense or income to get started",
            "Try categorizing your transaction for better tracking",
        ),
    ),
    AchievementType.HUNDRED_TRANSACTIONS: AchievementDefinition(
        title="Transaction Master",
        description="Record 100 transactions",
        category="financial",
        icon="💯",
        rarity=AchievementRarity.RARE,
        points=500,
        required_progress=100,
        tips=(
            "Keep tracking your daily expenses",
            "Don't forget to log both income and expenses",
            "Use the LINE bot for quick transaction entry",
        ),
    ),
    AchievementType.THOUSAND_TRANSACTIONS: AchievementDefinition(
        title="Ledger Legend",
        description="Record 1,000 transactions",
        category="financial",
        icon="📚",
        rarity=AchievementRarity.EPIC,
        points=2000,
        required_progress=1000,
        tips=("Consistency beats intensity — log a little every day",),
    ),
    AchievementType.FIRST_GOAL: AchievementDefinition(
        title="Goal Setter",
        description="Create your first financial goal",
        category="planning",
        icon="🎯",
        rarity=AchievementRarity.COMMON,
        points=150,
        required_progress=1,
        tips=(
            "Set a realistic short-term savings goal",
            "Choose a specific target amount and date",
            "Emergency fund goals are great for beginners",
        ),
    ),
    AchievementType.GOAL_COMPLETED: AchievementDefinition(
        title="Goal Achiever",
        description="Complete your first financial goal",
        category="planning",
        icon="🏁",
        rarity=AchievementRarity.COMMON,
        points=200,
        required_progress=1,
        tips=("Break a large goal into milestones to keep momentum",),
    ),
    AchievementType.FIVE_GOALS_COMPLETED: AchievementDefinition(
        title="Goal Champion",
        description="Complete 5 financial goals",
        category="planning",
        icon="🏆",
        rarity=AchievementRarity.RARE,
        points=750,
        required_progress=5,
        tips=("Retire a finished goal and start the next one straight away",),
    ),
    # ----- Savings & investing --------------------------------------------
    AchievementType.FIRST_SAVINGS_MILESTONE: AchievementDefinition(
        title="Milestone Maker",
        description="Reach your first savings milestone",
        category="savings",
        icon="🪜",
        rarity=AchievementRarity.COMMON,
        points=150,
        required_progress=1,
        tips=("Add milestones to a goal so progress feels achievable",),
    ),
    AchievementType.EMERGENCY_FUND_BUILT: AchievementDefinition(
        title="Safety Net",
        description="Complete an emergency fund goal",
        category="savings",
        icon="🛟",
        rarity=AchievementRarity.RARE,
        points=600,
        required_progress=1,
        tips=(
            "Aim for 3–6 months of essential expenses",
            "Keep it in the Emergency wallet so it stays separate",
        ),
    ),
    AchievementType.INVESTMENT_STARTER: AchievementDefinition(
        title="Investor Onboard",
        description="Add your first portfolio holding",
        category="investing",
        icon="📈",
        rarity=AchievementRarity.COMMON,
        points=200,
        required_progress=1,
        tips=("Record an existing holding to see your real net worth",),
    ),
    AchievementType.DIVERSIFIED_PORTFOLIO: AchievementDefinition(
        title="Well Diversified",
        description="Hold 3 different asset types",
        category="investing",
        icon="🧺",
        rarity=AchievementRarity.RARE,
        points=500,
        required_progress=3,
        tips=(
            "Mixing stocks, ETFs and bonds spreads risk",
            "Check the rebalancing page for allocation drift",
        ),
    ),
    # ----- Engagement ------------------------------------------------------
    AchievementType.DAILY_LOGIN_STREAK_7: AchievementDefinition(
        title="Weekly Warrior",
        description="Log in for 7 consecutive days",
        category="engagement",
        icon="🔥",
        rarity=AchievementRarity.COMMON,
        points=200,
        required_progress=7,
        tips=(
            "Check your finances daily for better habits",
            "Set a daily reminder to open the app",
            "Even a quick check counts as a login",
        ),
    ),
    AchievementType.DAILY_LOGIN_STREAK_30: AchievementDefinition(
        title="Monthly Master",
        description="Log in for 30 consecutive days",
        category="engagement",
        icon="⭐",
        rarity=AchievementRarity.EPIC,
        points=1000,
        required_progress=30,
        tips=("Missing a single day resets the streak — keep it short and daily",),
    ),
    AchievementType.DAILY_LOGIN_STREAK_100: AchievementDefinition(
        title="Centurion",
        description="Log in for 100 consecutive days",
        category="engagement",
        icon="💎",
        rarity=AchievementRarity.LEGENDARY,
        points=5000,
        required_progress=100,
        tips=("Three months of daily check-ins — habit, not effort",),
    ),
    AchievementType.EXPENSE_TRACKER: AchievementDefinition(
        title="Diligent Tracker",
        description="Record an expense on 30 different days",
        category="engagement",
        icon="🗓️",
        rarity=AchievementRarity.RARE,
        points=400,
        required_progress=30,
        tips=("Log expenses as they happen so nothing gets missed",),
    ),
    AchievementType.EARLY_ADOPTER: AchievementDefinition(
        title="Rising Star",
        description="Reach level 5",
        category="engagement",
        icon="🌟",
        rarity=AchievementRarity.RARE,
        points=250,
        required_progress=5,
        tips=("Every login, transaction and goal earns XP",),
    ),
    # ----- Regional (Asian markets) ---------------------------------------
    AchievementType.QR_PAYMENT_MASTER: AchievementDefinition(
        title="QR Payment Pro",
        description="Use QR payments 10 times",
        category="regional",
        icon="📱",
        rarity=AchievementRarity.RARE,
        points=300,
        required_progress=10,
        tips=(
            "Use QR payments for small purchases",
            "Look for QR payment options at local merchants",
            "Set the payment method when you log the expense",
        ),
    ),
    AchievementType.DIGITAL_WALLET_USER: AchievementDefinition(
        title="Cashless Native",
        description="Pay with an e-wallet 5 times",
        category="regional",
        icon="👛",
        rarity=AchievementRarity.COMMON,
        points=200,
        required_progress=5,
        tips=("Tag e-wallet spending so it counts towards this badge",),
    ),
    AchievementType.LOCAL_INVESTMENT_EXPLORER: AchievementDefinition(
        title="Local Explorer",
        description="Hold a regional asset (CPF, gold savings or a regional fund)",
        category="regional",
        icon="🏯",
        rarity=AchievementRarity.RARE,
        points=350,
        required_progress=1,
        tips=("Regional instruments often carry different tax treatment",),
    ),
    AchievementType.MULTI_CURRENCY_TRACKER: AchievementDefinition(
        title="Global Tracker",
        description="Track expenses in 3 different currencies",
        category="regional",
        icon="🌏",
        rarity=AchievementRarity.RARE,
        points=400,
        required_progress=3,
        tips=(
            "Track expenses when traveling",
            "Add transactions in their original currency",
        ),
    ),
    # ----- Social ----------------------------------------------------------
    AchievementType.REFERRAL_CHAMPION: AchievementDefinition(
        title="Referral Champion",
        description="Invite 3 friends to Aspiro",
        category="social",
        icon="🤝",
        rarity=AchievementRarity.EPIC,
        points=800,
        required_progress=3,
        tips=("Share your referral code from the settings page",),
    ),
    # ----- Not yet tracked -------------------------------------------------
    # These have no feature emitting a signal, so they stay hidden until one
    # exists. Definitions are kept so an already-awarded badge still renders
    # with a real title instead of a raw enum value.
    AchievementType.FAMILY_SAVER: AchievementDefinition(
        title="Family Saver",
        description="Save towards a family goal",
        category="social",
        icon="👨‍👩‍👧",
        rarity=AchievementRarity.RARE,
        points=400,
        required_progress=1,
        tracked=False,
    ),
    AchievementType.LUNAR_NEW_YEAR_SAVER: AchievementDefinition(
        title="Lunar New Year Saver",
        description="Save towards a Lunar New Year goal",
        category="regional",
        icon="🧧",
        rarity=AchievementRarity.RARE,
        points=400,
        required_progress=1,
        tracked=False,
    ),
    AchievementType.COMMUNITY_HELPER: AchievementDefinition(
        title="Community Helper",
        description="Help others in the Aspiro community",
        category="social",
        icon="💬",
        rarity=AchievementRarity.RARE,
        points=400,
        required_progress=1,
        tracked=False,
    ),
    AchievementType.FINANCIAL_LITERACY: AchievementDefinition(
        title="Financial Literacy",
        description="Complete the financial literacy basics",
        category="education",
        icon="🎓",
        rarity=AchievementRarity.RARE,
        points=400,
        required_progress=1,
        tracked=False,
    ),
    AchievementType.RISK_ASSESSMENT_COMPLETE: AchievementDefinition(
        title="Know Your Risk",
        description="Complete a risk assessment",
        category="education",
        icon="🧭",
        rarity=AchievementRarity.COMMON,
        points=200,
        required_progress=1,
        tracked=False,
    ),
    AchievementType.INVESTMENT_COURSE_COMPLETE: AchievementDefinition(
        title="Course Graduate",
        description="Complete an investing course",
        category="education",
        icon="📖",
        rarity=AchievementRarity.RARE,
        points=500,
        required_progress=1,
        tracked=False,
    ),
}


#: Fallback for an achievement type with no catalogue entry. Should never be
#: needed — ``test_achievement_catalogue_covers_every_type`` guards against it —
#: but keeps the API responding rather than raising on an unmapped type.
DEFAULT_DEFINITION = AchievementDefinition(
    title="Achievement",
    description="Keep using the app to unlock this achievement",
    category="general",
    icon="🏆",
    rarity=AchievementRarity.COMMON,
    points=100,
    required_progress=1,
)

DEFAULT_TIPS: Tuple[str, ...] = (
    "Keep using the app to unlock this achievement!",
)

#: Achievement types with no progress signal yet — hidden from the progress feed
#: unless the account already holds one.
UNTRACKED_ACHIEVEMENTS = frozenset(
    achievement_type
    for achievement_type, definition in ACHIEVEMENT_CATALOGUE.items()
    if not definition.tracked
)


def get_definition(achievement_type: AchievementType) -> AchievementDefinition:
    """Return the catalogue entry for ``achievement_type``.

    Falls back to a generic definition titled from the enum name so an unmapped
    type degrades to something readable instead of raising.
    """
    definition = ACHIEVEMENT_CATALOGUE.get(achievement_type)
    if definition is not None:
        return definition

    return AchievementDefinition(
        title=achievement_type.value.replace("_", " ").title(),
        description=DEFAULT_DEFINITION.description,
        category=DEFAULT_DEFINITION.category,
        icon=DEFAULT_DEFINITION.icon,
        rarity=DEFAULT_DEFINITION.rarity,
        points=DEFAULT_DEFINITION.points,
        required_progress=DEFAULT_DEFINITION.required_progress,
    )
