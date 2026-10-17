"""
Centralized logging configuration for Aspiro backend.

This module provides standardized logging setup with structured output,
request tracing, and environment-specific configurations.
"""

import json
import logging
import logging.config
from datetime import datetime
from typing import Any, Dict, Optional

from .config import get_settings

settings = get_settings()


class JSONFormatter(logging.Formatter):
    """Custom JSON formatter for structured logging."""

    def format(self, record: logging.LogRecord) -> str:
        """Format log record as JSON."""
        log_entry = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }

        # Add request ID if available
        if hasattr(record, 'request_id'):
            log_entry["request_id"] = record.request_id

        # Add user ID if available
        if hasattr(record, 'user_id'):
            log_entry["user_id"] = record.user_id

        # Add extra data if provided
        if hasattr(record, 'extra_data'):
            log_entry["data"] = record.extra_data

        # Add exception info if present
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry, ensure_ascii=False)


class ContextFilter(logging.Filter):
    """Filter to add context information to log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        """Add context to log record."""
        # Add environment info
        record.environment = settings.ENVIRONMENT

        # Add application info
        record.app_name = "aspiro-backend"
        record.app_version = getattr(settings, 'VERSION', '1.0.0')

        return True


def setup_logging() -> None:
    """Setup logging configuration based on environment."""

    # Log level from settings (respects LOG_LEVEL env var)
    log_level = settings.LOG_LEVEL

    # Choose formatter based on environment
    if settings.is_development:
        formatter_config: dict = {
            "class": "logging.Formatter",
            "format": (
                "%(asctime)s - %(name)s - %(levelname)s - "
                "[%(module)s:%(funcName)s:%(lineno)d] - %(message)s"
            ),
        }
    else:
        # Pass class directly via "()" to avoid re-importing this module
        formatter_config = {"()": JSONFormatter}

    config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": formatter_config
        },
        "filters": {
            "context": {
                "class": "app.core.logger.ContextFilter",
            }
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "level": log_level,
                "formatter": "default",
                "filters": ["context"],
                "stream": "ext://sys.stdout",
            },
        },
        "loggers": {
            "app": {
                "level": log_level,
                "handlers": ["console"],
                "propagate": False,
            },
            "uvicorn": {
                "level": "INFO",
                "handlers": ["console"],
                "propagate": False,
            },
            "uvicorn.error": {
                "level": "INFO",
                "handlers": ["console"],
                "propagate": False,
            },
            "uvicorn.access": {
                "level": "WARNING",  # Reduce access log noise
                "handlers": ["console"],
                "propagate": False,
            },
            "sqlalchemy.engine": {
                "level": "WARNING",
                "handlers": ["console"],
                "propagate": False,
            },
            "alembic": {
                "level": "INFO",
                "handlers": ["console"],
                "propagate": False,
            },
            "yfinance": {
                "level": "ERROR",  # Only show errors from yfinance
                "handlers": ["console"],
                "propagate": False,
            },
            "finlab": {
                "level": "ERROR",  # Only show errors from finlab
                "handlers": ["console"],
                "propagate": False,
            },
            "finlab.utils": {
                "level": "ERROR",  # Only show errors from finlab utilities
                "handlers": ["console"],
                "propagate": False,
            },
        },
        "root": {
            "level": log_level,
            "handlers": ["console"],
        },
    }

    logging.config.dictConfig(config)


def get_logger(name: str) -> logging.Logger:
    """Get logger instance with proper configuration."""
    return logging.getLogger(f"app.{name}")


class LoggerAdapter(logging.LoggerAdapter):
    """Logger adapter for adding context to all log messages."""

    def __init__(self, logger: logging.Logger, extra: Optional[Dict[str, Any]] = None):
        super().__init__(logger, extra or {})

    def process(self, msg: str, kwargs: Dict[str, Any]) -> tuple[str, Dict[str, Any]]:
        """Add extra context to log messages."""
        # Add request_id and user_id if available in extra
        if self.extra:
            for key in ['request_id', 'user_id', 'extra_data']:
                if key in self.extra and key not in kwargs:
                    kwargs[key] = self.extra[key]

        return msg, kwargs

# Security and audit logging
def log_security_event(logger: logging.Logger, event: str, severity: str = "info",
                      user_id: Optional[str] = None, ip_address: Optional[str] = None,
                      user_agent: Optional[str] = None, request_id: Optional[str] = None,
                      extra_data: Optional[Dict[str, Any]] = None) -> None:
    """Log security events for monitoring and analysis."""
    level_map = {
        "debug": logging.DEBUG,
        "info": logging.INFO,
        "warning": logging.WARNING,
        "error": logging.ERROR,
        "critical": logging.CRITICAL,
    }

    adapter = LoggerAdapter(logger, {
        'request_id': request_id,
        'user_id': user_id,
        'extra_data': {
            'event': event,
            'severity': severity,
            'ip_address': ip_address,
            'user_agent': user_agent,
            **(extra_data or {})
        }
    })

    log_level = level_map.get(severity.lower(), logging.INFO)
    adapter.log(log_level, f"Security Event: {event}")


# Initialize logging when module is imported
setup_logging()