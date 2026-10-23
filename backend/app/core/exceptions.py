"""
Custom exception handlers for Aspiro FastAPI backend.

This module defines custom exceptions and their handlers for
consistent error responses across the application.
"""

import logging
import time
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

logger = logging.getLogger(__name__)


# Custom Exception Classes
class AspiroException(Exception):
    """Base exception class for Aspiro application"""

    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        error_code: str = "INTERNAL_ERROR",
        details: Dict[str, Any] = None,
    ):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.details = details or {}
        super().__init__(message)


class ValidationException(AspiroException):
    """Exception for validation errors"""

    def __init__(self, message: str, details: Dict[str, Any] = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            error_code="VALIDATION_ERROR",
            details=details,
        )


class AuthorizationException(AspiroException):
    """Exception for authorization errors"""

    def __init__(self, message: str = "Insufficient permissions"):
        super().__init__(
            message=message,
            status_code=status.HTTP_403_FORBIDDEN,
            error_code="AUTHORIZATION_ERROR",
        )


class NotFoundException(AspiroException):
    """Exception for resource not found errors"""

    def __init__(self, resource: str, identifier: str = None):
        message = f"{resource} not found"
        if identifier:
            message += f" with identifier: {identifier}"

        super().__init__(
            message=message,
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="NOT_FOUND",
        )


class BusinessLogicException(AspiroException):
    """Exception for business logic violations"""

    def __init__(self, message: str, details: Dict[str, Any] = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="BUSINESS_LOGIC_ERROR",
            details=details,
        )


class RateLimitException(AspiroException):
    """Exception for rate limit violations"""

    def __init__(self, message: str = "Rate limit exceeded"):
        super().__init__(
            message=message,
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            error_code="RATE_LIMIT_ERROR",
        )


# Portfolio-specific exceptions
# Exception Handlers
async def aspiro_exception_handler(
    request: Request, exc: AspiroException
) -> JSONResponse:
    """Handler for custom Aspiro exceptions"""

    # Use WARNING for expected exceptions like rate limits, ERROR for unexpected
    log_level = logger.warning if isinstance(exc, RateLimitException) else logger.error

    log_level(
        f"AspiroException: {exc.error_code} - {exc.message}",
        extra={
            "error_code": exc.error_code,
            "status_code": exc.status_code,
            "details": exc.details,
            "path": str(request.url),
            "method": request.method,
        },
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {
                "code": exc.error_code,
                "message": exc.message,
                "details": exc.details,
            },
            "timestamp": time.time(),
            "path": str(request.url.path),
        },
    )


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Handler for FastAPI HTTP exceptions"""

    logger.warning(
        f"HTTPException: {exc.status_code} - {exc.detail}",
        extra={
            "status_code": exc.status_code,
            "detail": exc.detail,
            "path": str(request.url),
            "method": request.method,
        },
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {"code": "HTTP_ERROR", "message": exc.detail, "details": {}},
            "timestamp": time.time(),
            "path": str(request.url.path),
        },
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Handler for request validation errors"""

    # The rejected input is left out of both the log and the response: it is
    # whatever the caller sent, of any size, and may be a password typed into the
    # wrong field. Logging it turned one oversized request into a log line larger
    # than the request, and the response repeated it three times.
    formatted_errors = []
    for error in exc.errors():
        loc = " -> ".join(str(x) for x in error["loc"])
        formatted_errors.append(
            {
                "field": loc,
                "message": error["msg"],
                "type": error["type"],
            }
        )

    logger.warning(
        "ValidationError on %s %s: %s",
        request.method,
        request.url.path,
        [{"field": e["field"], "type": e["type"]} for e in formatted_errors],
    )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "success": False,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": {"errors": formatted_errors},
            },
            # Provide top-level detail for clients/tests expecting default FastAPI shape
            "detail": formatted_errors,
            "errors": formatted_errors,
            "timestamp": time.time(),
            "path": str(request.url.path),
        },
    )


async def database_exception_handler(
    request: Request, exc: SQLAlchemyError
) -> JSONResponse:
    """Handler for database errors"""

    logger.error(
        f"Database error: {str(exc)}",
        extra={
            "exception_type": type(exc).__name__,
            "path": str(request.url),
            "method": request.method,
        },
        exc_info=True,
    )

    # Handle specific database errors
    if isinstance(exc, IntegrityError):
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "success": False,
                "error": {
                    "code": "INTEGRITY_ERROR",
                    "message": "Data integrity violation",
                    "details": {},
                },
                "timestamp": time.time(),
                "path": str(request.url.path),
            },
        )

    # Generic database error
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": {
                "code": "DATABASE_ERROR",
                "message": "Database operation failed",
                "details": {},
            },
            "timestamp": time.time(),
            "path": str(request.url.path),
        },
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handler for unhandled exceptions"""

    logger.error(
        f"Unhandled exception: {type(exc).__name__} - {str(exc)}",
        extra={
            "exception_type": type(exc).__name__,
            "path": str(request.url),
            "method": request.method,
        },
    )

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred",
                "details": {},
            },
            "timestamp": time.time(),
            "path": str(request.url.path),
        },
    )


def setup_exception_handlers(app: FastAPI) -> None:
    """Setup all exception handlers for the FastAPI application"""

    # Custom exception handlers
    app.add_exception_handler(AspiroException, aspiro_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(SQLAlchemyError, database_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)

    logger.info("Exception handlers configured")


# Export commonly used exceptions and functions
__all__ = [
    "AspiroException",
    "ValidationException",
    "AuthorizationException",
    "NotFoundException",
    "BusinessLogicException",
    "RateLimitException",
    "setup_exception_handlers",
]
