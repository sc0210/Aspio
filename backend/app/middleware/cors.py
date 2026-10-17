"""
CORS middleware configuration for Aspiro FastAPI backend.

This module configures Cross-Origin Resource Sharing (CORS) settings
to allow frontend applications to communicate with the API.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..core.config import get_settings

settings = get_settings()


def setup_cors(app: FastAPI) -> None:
    """
    Configure CORS middleware for the FastAPI application.

    Args:
        app: FastAPI application instance
    """

    # For development, allow localhost with various ports
    if settings.DEBUG or settings.ENVIRONMENT == "development":
        allowed_origins = [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
        ]
        # Add ngrok origins from CORS_ORIGINS config if present
        # This allows ngrok URLs to be added via environment variable
        for origin in settings.CORS_ORIGINS:
            if origin not in allowed_origins:
                allowed_origins.append(origin)
        # Also allow any ngrok.io or ngrok-free.app domains in development
        # These will be validated at runtime
    else:
        allowed_origins = list(settings.CORS_ORIGINS)
        if settings.EXTRA_CORS_ORIGINS:
            for origin in settings.EXTRA_CORS_ORIGINS.split(","):
                origin = origin.strip()
                if origin and origin not in allowed_origins:
                    allowed_origins.append(origin)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        # Opt-in only (CORS_ALLOW_NGROK), never inferred from DEBUG: ngrok
        # subdomains are handed out to anyone, so this trusts strangers with
        # credentialed requests.
        allow_origin_regex=(
            r"https://.*\.(ngrok\.io|ngrok-free\.app)$"
            if settings.CORS_ALLOW_NGROK
            else None
        ),
        allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
        allow_methods=settings.CORS_ALLOW_METHODS,
        # Use the config-driven explicit header allowlist instead of a hardcoded copy.
        # NEVER pass ["*"] here when allow_credentials=True — browsers will reject it
        # (CORS spec forbids the wildcard header with credentialed requests).
        allow_headers=settings.CORS_ALLOW_HEADERS,
        expose_headers=[
            "X-Total-Count",
            "X-Page-Count",
            "X-Current-Page",
            "X-RateLimit-Remaining",
            "X-RateLimit-Reset",
            "X-RateLimit-Limit",
            "X-Request-ID",
        ],
        max_age=3600,  # 1 hour for preflight cache
    )
