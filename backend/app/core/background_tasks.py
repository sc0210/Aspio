"""
Fire-and-forget background work for Aspiro backend.

Runs an expensive coroutine (an external price fetch, say) without blocking the
HTTP request that started it.
"""

import asyncio
import logging
from typing import Any, Callable, Set

logger = logging.getLogger(__name__)

# asyncio holds only weak references to tasks, so a pending one can be garbage
# collected mid-flight; keep each here until it finishes, then let it go.
_running: Set[asyncio.Task] = set()


async def run_in_background(
    task_func: Callable[..., Any],
    task_name: str = "background_task",
    *args,
    **kwargs,
) -> None:
    """Schedule ``task_func(*args, **kwargs)`` and return immediately; failures are logged."""

    async def _run() -> None:
        try:
            await task_func(*args, **kwargs)
            logger.info(f"Background task completed: {task_name}")
        except Exception as e:
            logger.error(f"Background task failed: {task_name} - {e}", exc_info=True)

    task = asyncio.create_task(_run(), name=task_name)
    _running.add(task)
    task.add_done_callback(_running.discard)
    logger.info(f"Background task submitted: {task_name}")


__all__ = ["run_in_background"]
