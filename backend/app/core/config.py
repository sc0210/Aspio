"""
Application configuration management using Pydantic Settings.
Handles environment variables and configuration validation.

Env file priority (first found wins):
  ENVIRONMENT=production  → .env.production  → .env
  ENVIRONMENT=local/dev   → .env.local       → .env
"""

import os
from functools import lru_cache
from typing import List, Optional, Any
from urllib.parse import urlsplit
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _resolve_env_files() -> tuple[str, ...]:
    """Return ordered list of .env files to load based on ENVIRONMENT."""
    env = os.environ.get("ENVIRONMENT", "production").lower()
    if env in ("production", "prod"):
        return (".env.production", ".env")
    return (".env.local", ".env")


# One rule: a key that starts like any sample-file placeholder is refused. Add the
# prefix of a new sample value here.
PLACEHOLDER_SECRET_PREFIXES = (
    "dev-only-key",
    "change-me",
    "generate-with",
    "your-secret-key",
    "your-production-secret",
)
PLACEHOLDER_DB_PASSWORDS = {"aspiro_password"}
# Only true loopback counts as "clearly local dev"; compose service names such as
# `postgres` are also what a self-hosted production uses, so they get no pass.
LOOPBACK_DB_HOSTS = {"localhost", "127.0.0.1", "::1"}


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=_resolve_env_files(),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # Application
    APP_NAME: str = "Aspiro API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    # The timezone this app's DAYS are measured in — which calendar day a
    # transaction belongs to, when "this month" ends, whether a streak survived
    # the night. Nothing in the prod stack sets TZ, so the container runs UTC and
    # `date.today()` there is 8 hours behind the user. Read it through
    # app.utils.datetime_helpers.business_today(), never date.today().
    APP_TIMEZONE: str = "Asia/Taipei"

    @field_validator("APP_TIMEZONE")
    @classmethod
    def _timezone_must_exist(cls, v: str) -> str:
        """Fail at boot, not on every request.

        An unvalidated typo ("Asia/Taipe") loads fine and then raises
        ZoneInfoNotFoundError inside business_today(), turning dashboard,
        transaction, loan and reminder endpoints into 500s.
        """
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"APP_TIMEZONE {v!r} is not a known IANA timezone") from exc
        return v
    ENVIRONMENT: str = "production"

    # Password-less dev sign-in (see /auth/dev-login). Off by default. See
    # `dev_login_active` for the full set of conditions — the flag alone is
    # deliberately not enough to open it.
    DEV_LOGIN_ENABLED: bool = False
    # Shared secret for every developer-only route (dev sign-in, DB sync),
    # presented as X-Dev-Tools-Token. Required: with no value set, all of them
    # stay closed. This is what protects a deployment whose ENVIRONMENT says
    # "development" but which is actually serving real users — the self-hosted
    # Pi does exactly that, so ENVIRONMENT alone is not a safe gate.
    DEV_TOOLS_TOKEN: str = ""

    # Interactive API docs (/docs, /redoc, /openapi.json). Off unless a
    # deployment opts in, for the same reason as DEV_TOOLS_TOKEN: these used to
    # follow DEBUG, and DEBUG is true on every stack built from the base compose
    # file — including internet-facing ones. A published schema is a map of every
    # route and payload shape, so it is opt-in rather than environment-inferred.
    # docker-compose.yml sets this true for local development.
    ENABLE_API_DOCS: bool = False

    # Database
    DATABASE_URL: str
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20
    DATABASE_POOL_TIMEOUT: int = 30
    DATABASE_POOL_RECYCLE: int = 3600
    DATABASE_ECHO_SQL: bool = False
    DATABASE_SLOW_QUERY_THRESHOLD_MS: int = 500  # Log queries slower than 500ms
    # Force NullPool (a brand-new connection per request). Rarely needed — see the
    # database_use_nullpool property below. Leave false to let SQLAlchemy reuse
    # connections through the Supabase transaction pooler.
    DATABASE_USE_NULLPOOL: bool = False
    SKIP_DB_SCHEMA_INIT: bool = False  # Set true in production; use alembic for migrations

    # Security
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Google OAuth
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    GOOGLE_REDIRECT_URI: Optional[str] = None

    # LINE Bot (Messaging API channel)
    LINE_CHANNEL_SECRET: Optional[str] = None
    LINE_CHANNEL_ACCESS_TOKEN: Optional[str] = None
    # LINE Login channel + LIFF app (for the in-LINE web UI). LINE_LOGIN_CHANNEL_ID
    # is the audience used to verify LIFF ID tokens; LIFF_ID builds liff.line.me URLs.
    LINE_LOGIN_CHANNEL_ID: Optional[str] = None
    LIFF_ID: Optional[str] = None

    # External APIs
    EXCHANGE_RATES_API_KEY: Optional[str] = None

    # Market Data APIs
    FINLAB_API_TOKEN: Optional[str] = None
    # Kill switch for the FinLab whole-market fetch path (memory-heavy: full
    # TW-market OHLCV tables). When disabled, TW symbols use the per-symbol
    # Yahoo Finance fallback instead. Useful on memory-capped hosts.
    FINLAB_ENABLED: bool = True
    # Days of TW market history kept in RAM by the FinLab market cache.
    # Requests for longer lookbacks fall back to Yahoo Finance.
    FINLAB_WINDOW_DAYS: int = 400
    TRADINGVIEW_API_KEY: Optional[str] = None
    ENABLE_REAL_TIME_UPDATES: bool = False
    MARKET_DATA_CACHE_TTL: int = 300  # 5 minutes

    # In-process APScheduler that runs the routine price-refresh / historical-sync
    # jobs (see app/core/scheduler.py). These jobs load
    # pandas/numpy/finlab/yfinance into the web process and spike RAM, which OOMs
    # a memory-tight host. Keep it ON for local Docker dev (default True), and ON
    # for the Pi, which has the headroom to run the jobs in-process; set it OFF
    # wherever the web process is the only
    # service so the routine fetch only ever runs locally.
    ENABLE_SCHEDULER: bool = True

    # CORS — default allows localhost only.
    # IMPORTANT: set CORS_ORIGINS in Railway/production dashboard, e.g.:
    #   CORS_ORIGINS=["https://your-app.vercel.app"]
    # Without this, all browser requests from the production frontend will be
    # rejected with CORS 403. Set it via env (e.g. CORS_ORIGINS) rather than
    # hardcoding domains in source; for the Pi, docker-compose.pi.yml sets it to
    # ["https://${APP_DOMAIN:-home.aspiro.dev}"].
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
    ]
    # Extra origins from env (comma-separated) — add new deployment URLs here without
    # touching source code, e.g. EXTRA_CORS_ORIGINS=https://myapp.com
    EXTRA_CORS_ORIGINS: str = ""
    CORS_ALLOW_CREDENTIALS: bool = True
    CORS_ALLOW_METHODS: List[str] = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
    # Explicit header allowlist — do NOT use ["*"] here. cors.py reads this field
    # and passing wildcard with allow_credentials=True is rejected by browsers anyway.
    CORS_ALLOW_HEADERS: List[str] = [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Cache-Control",
        "Pragma",
        "ngrok-skip-browser-warning",
    ]
    # Trust any *.ngrok.io / *.ngrok-free.app origin, for tunnelling a local
    # backend to a phone or the LINE platform. Anyone can register an ngrok
    # subdomain, so this is a credentialed cross-origin allowance to strangers —
    # it used to follow DEBUG, which is true on the internet-facing Pi stack.
    # Turn it on for the duration of a tunnelling session; prefer listing the
    # exact tunnel URL in EXTRA_CORS_ORIGINS.
    CORS_ALLOW_NGROK: bool = False

    # Rate Limiting — production env sample sets 60/min; default here is generous for dev
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = 200
    RATE_LIMIT_BURST: int = 50
    # Multiplies the per-endpoint auth limits below (login 5/min, register 3/min).
    # React strict mode double-invokes effects, which trips the strict auth limits
    # during local development. This previously keyed off DEBUG, meaning the Pi
    # served real users with a 50/min login limit — 10x more password guesses.
    # docker-compose.yml sets 10 for local development.
    RATE_LIMIT_DEV_MULTIPLIER: int = 1

    # Proxy trust — number of trusted reverse-proxy hops in front of this service.
    # Used to select the correct IP from X-Forwarded-For instead of blindly trusting
    # the leftmost value (which can be spoofed by the client).
    # Set to 0 when running without a proxy (direct exposure), 1 behind one proxy, etc.
    # The real client IP is: xff_list[-(TRUSTED_PROXY_COUNT)] when the list has enough entries.
    TRUSTED_PROXY_COUNT: int = 1

    # Email Configuration
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    EMAIL_FROM: str = "noreply@aspiro.com"
    # Base URL of the Next.js frontend — used to build email links (verify, reset)
    FRONTEND_URL: Optional[str] = None

    # Self-hosted QuickChart endpoint — falls back to public SaaS if not set
    QUICKCHART_URL: str = "https://quickchart.io/chart"

    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"
    # Successful requests slower than this (ms) are logged at INFO, so
    # normal-but-slow endpoints (e.g. dashboard trends) are visible in prod logs
    # without switching to DEBUG. Requests over 10s still log as a louder WARNING.
    SLOW_REQUEST_MS: int = 1000

    # Explicit opt-out for the placeholder-secret startup check (see
    # check_insecure_defaults). Deliberately NOT derived from ENVIRONMENT/DEBUG:
    # the internet-facing Pi reports ENVIRONMENT=development.
    ALLOW_INSECURE_DEFAULTS: bool = False

    # File upload
    # Default is unchanged (relative to the working dir; /app/uploads/transactions
    # in the container). Mount a volume at /app/uploads to persist attachments.
    UPLOAD_PATH: str = "./uploads/transactions"
    MAX_FILE_SIZE_MB: int = 10
    ALLOWED_FILE_TYPES: List[str] = ["image/jpeg", "image/png", "image/webp"]

    # Portfolio settings
    MAX_PORTFOLIOS_PER_USER: int = 10
    SUPPORTED_CURRENCIES: List[str] = [
        "USD",
        "TWD",
        "EUR",
        "GBP",
        "JPY",
        "KRW",
        "SGD",
        "HKD",
        "CNY",
    ]

    # Supabase direct connection URL (used by dev db-sync tool)
    SUPABASE_DB_URL: Optional[str] = None

    # LAN peer DB URL for the dev db-sync tool (e.g. a Raspberry Pi self-host at
    # postgresql://user:pass@<pi-ip>:5433/aspiro_db). PEER_DB_LABEL is shown in the UI.
    PEER_DB_URL: Optional[str] = None
    PEER_DB_LABEL: str = "Peer"

    # Admin settings — must be set via ADMIN_EMAILS env var, no default email in source
    # Format: "email1:role1,email2:role2"  e.g. "admin@example.com:super_admin"
    ADMIN_EMAILS: str = ""

    @field_validator("SECRET_KEY", mode="before")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        """Reject known-weak placeholder keys."""
        WEAK_KEYS = {
            "your-secret-key-here-change-in-production",
            "aspiro-super-secret-jwt-key-change-in-production",
            "change-me-in-production",
            "secret",
            "changeme",
        }
        if v.lower() in WEAK_KEYS:
            raise ValueError(
                "SECRET_KEY is set to a known placeholder value. "
                "Generate a secure key with: python3 -c \"import secrets; print(secrets.token_hex(32))\""
            )
        if len(v) < 32:
            raise ValueError(
                "SECRET_KEY must be at least 32 characters. "
                "Generate one with: python3 -c \"import secrets; print(secrets.token_hex(32))\""
            )
        return v

    @model_validator(mode="after")
    def check_insecure_defaults(self) -> "Settings":
        """Refuse to start with known placeholder secrets.

        Never keyed off ENVIRONMENT/DEBUG (prod reports ENVIRONMENT=development);
        the only bypass is ALLOW_INSECURE_DEFAULTS=true.
        """
        if self.ALLOW_INSECURE_DEFAULTS:
            return self
        hint = (
            "Generate a value with: openssl rand -hex 32  "
            "(local development only: set ALLOW_INSECURE_DEFAULTS=true)"
        )
        key = self.SECRET_KEY.strip().lower()
        if key.startswith(PLACEHOLDER_SECRET_PREFIXES):
            raise ValueError(
                "SECRET_KEY is a known placeholder value and must not be used. " + hint
            )
        try:
            password = urlsplit(self.DATABASE_URL).password
        except ValueError:
            password = None
        if (
            password in PLACEHOLDER_DB_PASSWORDS
            and self.database_host not in LOOPBACK_DB_HOSTS
        ):
            raise ValueError(
                "DATABASE_URL uses the placeholder database password "
                f"'{password}'. Set POSTGRES_PASSWORD (and so DATABASE_URL) to a "
                "strong secret. " + hint
            )
        return self

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: str | List[str]) -> List[str]:
        """Parse CORS origins from string or list."""
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def assemble_db_connection(cls, v: Optional[str]) -> Any:
        """Validate and normalise database URL to the asyncpg scheme."""
        if not isinstance(v, str):
            raise ValueError("DATABASE_URL must be provided")
        # Railway/Supabase/Heroku may supply postgres:// or postgresql://.
        # create_async_engine requires postgresql+asyncpg://.
        for sync_prefix in ("postgresql://", "postgres://"):
            if v.startswith(sync_prefix):
                return "postgresql+asyncpg://" + v[len(sync_prefix):]
        return v

    @property
    def max_file_size_bytes(self) -> int:
        """Convert max file size to bytes."""
        return self.MAX_FILE_SIZE_MB * 1024 * 1024

    @property
    def is_development(self) -> bool:
        """Check if running in development mode."""
        return self.ENVIRONMENT.lower() in ("development", "dev", "local")

    @property
    def is_production(self) -> bool:
        """Check if running in production mode."""
        return self.ENVIRONMENT.lower() in ("production", "prod")

    @property
    def database_host(self) -> str:
        """Host portion of DATABASE_URL, lowercased ('' if unparseable)."""
        try:
            return (urlsplit(self.DATABASE_URL).hostname or "").lower()
        except ValueError:
            return ""

    @property
    def database_is_local(self) -> bool:
        """Whether DATABASE_URL points at a loopback or in-compose database.

        ``postgres``/``db`` are Docker Compose service names, so this cannot tell
        a laptop's compose stack from a self-hosted one — it exists to stop a
        development-shaped config that has been pointed at a *remote* database
        (Supabase, a peer host) from opening the dev-login route.
        """
        return self.database_host in {
            "localhost",
            "127.0.0.1",
            "::1",
            "postgres",
            "db",
            "aspiro-postgres",
        }

    @property
    def dev_tools_active(self) -> bool:
        """Whether developer-only routes may be exposed at all.

        These routes bypass authentication or mutate whole databases, so this
        requires every one of the following. No single stray env var opens them:

        * a development ``ENVIRONMENT``
        * a ``DEV_TOOLS_TOKEN`` secret configured, which callers must present
        * ``DATABASE_URL`` pointing at a local/in-compose database

        The token is the load-bearing one. ENVIRONMENT is deliberately *not*
        trusted on its own: every deployment that uses the project's compose
        file runs ``ENVIRONMENT=development``, including the self-hosted Pi that
        serves real users over the internet behind Caddy.
        """
        return (
            self.is_development
            and not self.is_production
            and bool(self.DEV_TOOLS_TOKEN)
            and self.database_is_local
        )

    @property
    def dev_login_active(self) -> bool:
        """Whether the password-less dev sign-in route may be exposed.

        Everything :attr:`dev_tools_active` requires, plus its own opt-in — this
        one hands out a token for *any* account with no password.
        """
        return self.DEV_LOGIN_ENABLED and self.dev_tools_active

    @property
    def effective_google_redirect_uri(self) -> Optional[str]:
        """Return GOOGLE_REDIRECT_URI if explicitly configured, otherwise None."""
        return self.GOOGLE_REDIRECT_URI or None

    @property
    def google_oauth_enabled(self) -> bool:
        """Check if Google OAuth is configured."""
        return all(
            [self.GOOGLE_CLIENT_ID, self.GOOGLE_CLIENT_SECRET, self.effective_google_redirect_uri]
        )

    @property
    def email_enabled(self) -> bool:
        """Check if email configuration is complete."""
        return all([self.SMTP_HOST, self.SMTP_USER, self.SMTP_PASSWORD])

    @property
    def database_use_ssl(self) -> bool:
        """True when the DATABASE_URL contains ?ssl=require or ?sslmode=require (Supabase)."""
        url = self.DATABASE_URL
        return "ssl=require" in url or "sslmode=require" in url

    @property
    def database_via_pooler(self) -> bool:
        """True when connecting through any Supabase pooler (Supavisor) endpoint.

        Covers both the transaction pooler (:6543) and the session pooler
        (pooler host on :5432). Used to enable pre-ping + a short recycle window,
        since the pooler reaps idle connections."""
        url = self.DATABASE_URL
        return "pooler.supabase.com" in url or ":6543/" in url or ":6543?" in url

    @property
    def database_session_mode_pooler(self) -> bool:
        """True when using the Supabase SESSION-mode pooler (pooler host on :5432).

        Session mode caps *total* clients at the pooler's configured pool size, so the
        SQLAlchemy pool (pool_size + max_overflow), times the replica count, plus any
        migration/admin connections, must stay well under that cap. The transaction
        pooler (:6543) does not have this limit and is the recommended runtime endpoint."""
        url = self.DATABASE_URL
        return "pooler.supabase.com" in url and (":5432/" in url or ":5432?" in url)

    @property
    def database_use_nullpool(self) -> bool:
        """Force NullPool (one fresh connection per request) only when explicitly asked.

        This previously auto-enabled NullPool for the Supabase transaction pooler
        (:6543) to avoid prepared-statement mismatches through PgBouncer. That is no
        longer necessary: we set statement_cache_size=0 (no named prepared
        statements), so a normal QueuePool is safe through the pooler — and it avoids
        a full TCP/TLS/auth handshake on every request, which was adding ~0.5-1.3s of
        latency to the first query of each request. Set DATABASE_USE_NULLPOOL=true to
        restore the old behaviour if a regression appears."""
        return self.DATABASE_USE_NULLPOOL

    @property
    def database_url_sync(self) -> str:
        """Synchronous database URL for Alembic migrations, on the psycopg2 driver.

        The driver is named explicitly: SQLAlchemy 2.1 changed what a bare
        ``postgresql://`` means from psycopg2 to psycopg 3, which is not installed,
        so the bare form made every `alembic` run in the production image fail.
        """
        url = self.DATABASE_URL
        for prefix in ("postgresql+asyncpg://", "postgresql://", "postgres://"):
            if url.startswith(prefix):
                url = "postgresql+psycopg2://" + url[len(prefix):]
                break
        # psycopg2 uses sslmode=require; asyncpg uses ssl=require — normalise for sync
        url = url.replace("ssl=require", "sslmode=require")
        return url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Get application settings instance (cached — same object reused across all modules)."""
    return Settings()


# Global settings instance
settings = get_settings()
