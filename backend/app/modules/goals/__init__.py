"""
Goals Module

Financial goals tracking and management.
"""

from .models import Goal, GoalMilestone, GoalContribution
from .schemas import GoalCreate, GoalUpdate, GoalResponse, GoalSummary
from .service import GoalService, get_goal_service
from .router import router

__all__ = [
    "Goal",
    "GoalMilestone",
    "GoalContribution",
    "GoalCreate",
    "GoalUpdate",
    "GoalResponse",
    "GoalSummary",
    "GoalService",
    "get_goal_service",
    "router",
]
