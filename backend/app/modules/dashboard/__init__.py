"""
Dashboard module for Aspiro FastAPI backend.

This module provides high-performance dashboard APIs with:
- Async database operations
- Redis caching for sub-500ms response times
- Comprehensive financial analytics
- Support for both demo and authenticated users
"""

from .router import router

__all__ = ["router"]
