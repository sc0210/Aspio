"""
Pure ASGI Middleware for Aspiro Backend

This module provides Pure ASGI middleware implementations that avoid
the issues with Starlette's BaseHTTPMiddleware, particularly the
"Unexpected message received: http.request" error when reading request bodies.

Key Benefits of Pure ASGI:
- No issues with request body consumption
- Better performance (no middleware wrapping overhead)
- More reliable in production
- Recommended by FastAPI documentation
"""

import time
import uuid
import logging
from typing import Callable, Dict
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.datastructures import MutableHeaders
from starlette.responses import Response, PlainTextResponse

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class RequestIDMiddleware:
    """
    Pure ASGI middleware for generating and tracking request IDs.

    Adds a unique UUID to each request for:
    - Request tracking across services
    - Log correlation
    - Debugging distributed systems
    - Error tracking
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Generate unique request ID
        request_id = str(uuid.uuid4())

        # Store in scope state for access by other middleware and routes
        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["request_id"] = request_id

        async def send_with_request_id(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.append("X-Request-ID", request_id)
            await send(message)

        await self.app(scope, receive, send_with_request_id)


class SecurityHeadersMiddleware:
    """
    Pure ASGI middleware for adding security headers to all responses.

    Follows OWASP recommendations for web application security:
    - Prevent MIME type sniffing
    - Prevent clickjacking
    - XSS protection
    - Force HTTPS
    - Control resource loading
    """

    def __init__(self, app: ASGIApp):
        self.app = app
        self.settings = get_settings()

    # Swagger UI and ReDoc pull their bundles from a CDN and run an inline
    # bootstrap script, so the strict policy below would blank those pages out.
    # They are exempt rather than the policy being weakened for every route.
    _CSP_EXEMPT_PATHS = frozenset({"/docs", "/docs/oauth2-redirect", "/redoc"})

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        send_csp = scope.get("path") not in self._CSP_EXEMPT_PATHS

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)

                # Security headers (always apply)
                headers.append("X-Content-Type-Options", "nosniff")
                headers.append("X-Frame-Options", "DENY")
                headers.append("X-XSS-Protection", "1; mode=block")
                headers.append(
                    "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
                )
                headers.append("Referrer-Policy", "strict-origin-when-cross-origin")
                headers.append(
                    "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
                )

                # Content Security Policy — sent in every environment. It used to
                # be production-only, which meant the deployment most exposed to
                # the internet (the self-hosted Pi, ENVIRONMENT=development on the
                # base compose stack) was the one running without it.
                # 'unsafe-inline' and 'unsafe-eval' are intentionally excluded:
                # they defeat XSS protection. The frontend (Next.js) must use
                # nonce-based or hash-based script allowlisting if inline scripts
                # are needed. This CSP is on the API server so script-src primarily
                # protects error pages and auto-generated HTML from FastAPI/Starlette.
                if send_csp:
                    headers.append(
                        "Content-Security-Policy",
                        "default-src 'none'; "
                        "script-src 'self'; "
                        "style-src 'self'; "
                        "img-src 'self' data:; "
                        "font-src 'self'; "
                        "connect-src 'self'; "
                        "frame-ancestors 'none'; "
                        "base-uri 'self'; "
                        "form-action 'self'; "
                        "upgrade-insecure-requests;",
                    )

            await send(message)

        await self.app(scope, receive, send_with_headers)


class LoggingMiddleware:
    """
    Pure ASGI middleware for logging HTTP requests and responses.

    Features:
    - Request/response logging
    - Performance tracking
    - Error logging
    - Request correlation via request ID

    IMPORTANT: Does NOT read request body to avoid ASGI channel issues.
    """

    def __init__(self, app: ASGIApp):
        self.app = app
        self.settings = get_settings()

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start_time = time.time()
        request_id = scope.get("state", {}).get("request_id", "unknown")
        method = scope["method"]
        path = scope["path"]

        # Log request (only in DEBUG mode to reduce noise)
        if self.settings.LOG_LEVEL == "DEBUG":
            client = scope.get("client")
            client_ip = client[0] if client else "unknown"
            logger.debug(f"Request {request_id}: {method} {path} from {client_ip}")

        status_code = 500
        response_started = False

        async def send_with_logging(message):
            nonlocal status_code, response_started

            if message["type"] == "http.response.start":
                status_code = message["status"]
                response_started = True

            elif message["type"] == "http.response.body":
                # Only log when response is complete
                if not message.get("more_body", False):
                    duration_ms = (time.time() - start_time) * 1000

                    # Log based on status code and duration
                    if status_code >= 500:
                        logger.error(
                            f"Response {request_id}: {status_code} {method} {path} in {duration_ms:.2f}ms"
                        )
                    elif status_code >= 400:
                        logger.warning(
                            f"Response {request_id}: {status_code} {method} {path} in {duration_ms:.2f}ms"
                        )
                    elif duration_ms > 10000:  # Very slow requests (>10s)
                        logger.warning(
                            f"Slow response {request_id}: {status_code} {method} {path} in {duration_ms:.2f}ms"
                        )
                    elif duration_ms > self.settings.SLOW_REQUEST_MS:
                        # Visible at INFO (prod default) so normal-but-slow
                        # endpoints surface in logs without dropping to DEBUG.
                        logger.info(
                            f"Slow response {request_id}: {status_code} {method} {path} in {duration_ms:.2f}ms"
                        )
                    elif self.settings.LOG_LEVEL == "DEBUG":
                        logger.debug(
                            f"Response {request_id}: {status_code} {method} {path} in {duration_ms:.2f}ms"
                        )

            await send(message)

        try:
            await self.app(scope, receive, send_with_logging)
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            logger.error(
                f"Error {request_id}: {method} {path} - {str(e)} after {duration_ms:.2f}ms",
                exc_info=True,
            )
            raise


class InputValidationMiddleware:
    """
    Pure ASGI middleware for basic input validation.

    Validates URL patterns for suspicious content without reading request body.
    This is a lightweight validation layer; main validation happens via:
    - SQLAlchemy ORM (SQL injection protection)
    - Pydantic schemas (input validation)
    - Output encoding (XSS protection)
    """

    SUSPICIOUS_PATTERNS = [
        "../",  # Path traversal
        "script>",  # XSS attempts in URLs
        "javascript:",  # JavaScript protocol
        "union+select",  # SQL injection patterns
        "drop+table",  # SQL DROP statements
    ]

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Check URL path and query string for suspicious patterns
        path = scope.get("path", "")
        query_string = scope.get("query_string", b"").decode("utf-8", errors="ignore")
        full_url = f"{path}?{query_string}" if query_string else path
        full_url_lower = full_url.lower()

        for pattern in self.SUSPICIOUS_PATTERNS:
            if pattern in full_url_lower:
                client = scope.get("client")
                client_ip = client[0] if client else "unknown"
                logger.warning(
                    f"Suspicious pattern '{pattern}' detected in URL from {client_ip}: {full_url[:100]}"
                )

                # Return 400 Bad Request
                response = PlainTextResponse("Invalid request format", status_code=400)
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)


class _BodyTooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    """
    Pure ASGI middleware that caps request body size before the app buffers it.

    Nothing else in the stack does: Caddy, uvicorn and Starlette all accept a body
    of any size, and the webhook and auth routes read it whole before checking
    anything. A declared Content-Length over the limit is refused outright, and a
    streamed body is counted as it is read, so a missing or false header does not
    get around it. Credential and webhook routes need a few KB; uploads get the
    configured file limit plus room for multipart framing.
    """

    SMALL_LIMIT = 64 * 1024
    SMALL_PREFIXES = (
        "/api/v1/auth/",
        "/api/v1/users/register",
        "/api/v1/line-bot/webhook",
    )

    def __init__(self, app: ASGIApp):
        self.app = app
        from app.core.config import get_settings

        self.default_limit = get_settings().max_file_size_bytes + 1024 * 1024

    def _limit_for(self, path: str) -> int:
        return self.SMALL_LIMIT if path.startswith(self.SMALL_PREFIXES) else self.default_limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self._limit_for(scope.get("path", ""))
        too_large = PlainTextResponse("Request body too large", status_code=413)

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = limit + 1
                if declared > limit:
                    await too_large(scope, receive, send)
                    return

        received = 0
        started = False
        overflowed = False
        replaced = False

        async def counted_receive():
            nonlocal received, overflowed
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    overflowed = True
                    raise _BodyTooLarge()
            return message

        async def tracked_send(message):
            nonlocal started, replaced
            if replaced:
                return
            if message["type"] == "http.response.start":
                started = True
                if overflowed:
                    # FastAPI catches the cut-off body and answers 400; say what happened instead.
                    replaced = True
                    await too_large(scope, receive, send)
                    return
            await send(message)

        try:
            await self.app(scope, counted_receive, tracked_send)
        except _BodyTooLarge:
            if not started:
                await too_large(scope, receive, send)


def setup_pure_asgi_middleware(app):
    """
    Setup Pure ASGI middleware for the FastAPI application.

    Middleware order (bottom to top execution for requests):
    1. RequestIDMiddleware - Generate unique ID first
    2. SecurityHeadersMiddleware - Add security headers
    3. LoggingMiddleware - Log requests/responses
    4. InputValidationMiddleware - Basic URL validation
    5. BodySizeLimitMiddleware - Refuse oversized request bodies

    Args:
        app: FastAPI application instance
    """
    # Add middleware in reverse order (last added = first executed)
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(InputValidationMiddleware)
    app.add_middleware(LoggingMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIDMiddleware)

    logger.info("Pure ASGI middleware stack configured")
