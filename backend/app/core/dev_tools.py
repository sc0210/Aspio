"""Shared guard for developer-only routes.

Routes that bypass authentication (``/auth/dev-login``) must never be
reachable on a deployment serving real users. Network reachability is not a
usable boundary here: the project's compose file publishes the API port to the
host, and the lan/Pi overlays republish it on ``0.0.0.0`` behind a public HTTPS
domain.

So every such route requires a shared secret, ``DEV_TOOLS_TOKEN``, presented as
``X-Dev-Tools-Token``. Deployments that don't set it — which includes every
deployment nobody has deliberately opted in — expose nothing, even though they
report ``ENVIRONMENT=development``.
"""

import logging
import secrets
from typing import Optional

from fastapi import Header, HTTPException, status

from .config import get_settings

logger = logging.getLogger(__name__)

# 404 everywhere rather than 401/403: a probe should not be able to tell a wrong
# secret from a route that isn't mounted.
_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND, detail="Not found"
)


def require_dev_tools_token(
    x_dev_tools_token: Optional[str] = Header(default=None),
) -> None:
    """FastAPI dependency enforcing the dev-tools gate and shared secret."""
    settings = get_settings()

    if not settings.dev_tools_active:
        raise _NOT_FOUND

    expected = settings.DEV_TOOLS_TOKEN
    if (
        not expected
        or not x_dev_tools_token
        or not secrets.compare_digest(x_dev_tools_token, expected)
    ):
        logger.warning(
            "Rejected dev-tools request: missing or incorrect X-Dev-Tools-Token"
        )
        raise _NOT_FOUND
