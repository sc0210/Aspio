"""run_in_background: runs the work, swallows and logs a failure, and keeps no task once it is done."""
import asyncio
from unittest.mock import patch

import pytest

from app.core import background_tasks
from app.core.background_tasks import run_in_background


@pytest.mark.asyncio
async def test_runs_the_work_and_releases_the_task():
    done = asyncio.Event()

    async def work(value, *, flag):
        assert (value, flag) == (1, True)
        done.set()

    await run_in_background(work, "work", 1, flag=True)
    await asyncio.wait_for(done.wait(), timeout=1)
    await asyncio.sleep(0)  # let the done-callback run

    assert background_tasks._running == set()


@pytest.mark.asyncio
async def test_a_failure_is_logged_not_raised():
    async def boom():
        raise RuntimeError("feed down")

    # The app logger does not propagate to the root, so caplog cannot see it.
    with patch.object(background_tasks, "logger") as log:
        await run_in_background(boom, "fetch_price_X")
        for _ in range(5):
            await asyncio.sleep(0)

    log.error.assert_called_once()
    assert "Background task failed: fetch_price_X - feed down" in log.error.call_args.args[0]
    assert background_tasks._running == set()
