"""Security posture must not be inferred from ENVIRONMENT or DEBUG.

Every stack built from `docker-compose.yml` runs `ENVIRONMENT=development` and
`DEBUG=true`, including the self-hosted Pi that serves real users over the
internet behind Caddy. Anything that got *weaker* on those two values was
therefore weakest exactly where it mattered most.

Each setting below is now an explicit opt-in that defaults to the safe value, so
a deployment nobody deliberately configured exposes nothing. These tests assert
the defaults, since the whole point is what happens when no one sets anything.
"""

import os
from unittest import mock

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings

BASE_SETTINGS = dict(
    DATABASE_URL="postgresql+asyncpg://user:pass@localhost/db",
    SECRET_KEY="x" * 32,
)

# Every name Settings would accept from the environment.
_SETTINGS_ENV_KEYS = {name.upper() for name in Settings.model_fields}


def _settings(**overrides) -> Settings:
    """Build Settings from the shipped defaults alone.

    Hermetic on BOTH axes, which matters because they are separate mechanisms:

    - ``_env_file=None`` silences the .env *file*.
    - Stripping the process environment silences real environment *variables*,
      which pydantic-settings reads regardless of ``_env_file``.

    Only the first was handled before, so inside the dev container — where
    docker-compose.yml exports ENABLE_API_DOCS=true and
    RATE_LIMIT_DEV_MULTIPLIER=10 — these tests measured the container's env
    instead of the defaults they mean to assert, and failed. They passed in CI,
    which sets none of it. A suite that is red only on developer machines gets
    ignored, which defeats the point of asserting a security posture at all.

    Unrelated variables are left in place; only Settings-shaped keys are removed.
    """
    without_settings_vars = {
        key: value
        for key, value in os.environ.items()
        if key.upper() not in _SETTINGS_ENV_KEYS
    }
    with mock.patch.dict(os.environ, without_settings_vars, clear=True):
        return Settings(_env_file=None, **{**BASE_SETTINGS, **overrides})


class TestDefaultsAreSafeUnderDevelopmentEnv:
    """A development-shaped environment must not soften anything by itself."""

    @pytest.mark.parametrize("environment", ["development", "dev", "local"])
    def test_docs_stay_closed(self, environment):
        assert _settings(ENVIRONMENT=environment, DEBUG=True).ENABLE_API_DOCS is False

    @pytest.mark.parametrize("environment", ["development", "dev", "local"])
    def test_ngrok_origins_stay_untrusted(self, environment):
        assert _settings(ENVIRONMENT=environment, DEBUG=True).CORS_ALLOW_NGROK is False

    @pytest.mark.parametrize("environment", ["development", "dev", "local"])
    def test_auth_rate_limits_stay_strict(self, environment):
        settings = _settings(ENVIRONMENT=environment, DEBUG=True)
        assert settings.RATE_LIMIT_DEV_MULTIPLIER == 1


class TestApiDocsExposure:
    """`/docs`, `/redoc` and `/openapi.json` map every route and payload shape."""

    @staticmethod
    def _app_with(monkeypatch, *, enabled: bool):
        import app.main as main_module

        monkeypatch.setattr(main_module.settings, "ENABLE_API_DOCS", enabled)
        return main_module.create_app()

    @pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
    def test_absent_by_default(self, monkeypatch, path):
        client = TestClient(self._app_with(monkeypatch, enabled=False))
        assert client.get(path).status_code == 404

    @pytest.mark.parametrize("path", ["/docs", "/openapi.json"])
    def test_present_when_opted_in(self, monkeypatch, path):
        client = TestClient(self._app_with(monkeypatch, enabled=True))
        assert client.get(path).status_code == 200

    def test_debug_alone_does_not_open_them(self, monkeypatch):
        """The regression this file exists for: DEBUG used to be the gate."""
        import app.main as main_module

        monkeypatch.setattr(main_module.settings, "DEBUG", True)
        monkeypatch.setattr(main_module.settings, "ENVIRONMENT", "development")
        monkeypatch.setattr(main_module.settings, "ENABLE_API_DOCS", False)

        client = TestClient(main_module.create_app())
        assert client.get("/openapi.json").status_code == 404


class TestCorsNgrokTrust:
    """Anyone can register an ngrok subdomain, so the wildcard trusts strangers."""

    @staticmethod
    def _origin_regex(monkeypatch, **overrides):
        """Capture the `allow_origin_regex` that `setup_cors` would install."""
        import app.middleware.cors as cors_module

        captured = {}

        class _App:
            def add_middleware(self, _cls, **kwargs):
                captured.update(kwargs)

        for key, value in overrides.items():
            monkeypatch.setattr(cors_module.settings, key, value)

        cors_module.setup_cors(_App())
        return captured["allow_origin_regex"]

    def test_no_wildcard_by_default_even_with_debug(self, monkeypatch):
        assert self._origin_regex(
            monkeypatch, DEBUG=True, ENVIRONMENT="development", CORS_ALLOW_NGROK=False
        ) is None

    def test_wildcard_only_on_explicit_opt_in(self, monkeypatch):
        assert self._origin_regex(monkeypatch, CORS_ALLOW_NGROK=True) is not None


class TestAuthRateLimitMultiplier:
    """The login limit is a password-guessing budget, not a dev convenience."""

    @staticmethod
    def _login_limit(monkeypatch, multiplier):
        import app.middleware.rate_limit as rate_limit_module

        monkeypatch.setattr(
            rate_limit_module.settings, "RATE_LIMIT_DEV_MULTIPLIER", multiplier
        )
        middleware = rate_limit_module.RateLimitMiddleware(app=None)
        return middleware.rate_limits["/api/v1/auth/login"]["requests"]

    def test_strict_by_default(self, monkeypatch):
        assert self._login_limit(monkeypatch, 1) == 5

    def test_opt_in_loosens_it(self, monkeypatch):
        assert self._login_limit(monkeypatch, 10) == 50

    @pytest.mark.parametrize("bogus", [0, -5])
    def test_never_tightens_below_the_configured_limit(self, monkeypatch, bogus):
        """A zero or negative multiplier must not lock everyone out."""
        assert self._login_limit(monkeypatch, bogus) == 5


class TestRateLimitClientIp:
    """Behind Cloudflare + Caddy (TRUSTED_PROXY_COUNT=2) each appends one entry."""

    @staticmethod
    def _client_id(monkeypatch, forwarded_for, trusted=2):
        from types import SimpleNamespace
        import app.middleware.rate_limit as rate_limit_module
        from app.core.config import get_settings

        monkeypatch.setattr(get_settings(), "TRUSTED_PROXY_COUNT", trusted)
        middleware = rate_limit_module.RateLimitMiddleware(app=None)
        request = SimpleNamespace(
            state=SimpleNamespace(),
            headers={"x-forwarded-for": forwarded_for},
            client=SimpleNamespace(host="172.18.0.1"),
        )
        return middleware._get_client_id(request)

    def test_reads_the_ip_cloudflare_saw(self, monkeypatch):
        assert self._client_id(monkeypatch, "203.0.113.7, 172.18.0.1") == "ip:203.0.113.7"

    def test_a_faked_header_does_not_change_the_bucket(self, monkeypatch):
        """Rotating a fake X-Forwarded-For used to buy unlimited login attempts."""
        spoofed = self._client_id(monkeypatch, "6.6.6.6, 203.0.113.7, 172.18.0.1")
        assert spoofed == "ip:203.0.113.7"

    def test_login_audit_and_auth_limiter_use_the_same_rule(self, monkeypatch):
        """users.dependencies.get_client_ip had its own copy with the same off-by-one."""
        from types import SimpleNamespace
        from app.core.config import get_settings
        from app.modules.users.dependencies import get_client_ip

        monkeypatch.setattr(get_settings(), "TRUSTED_PROXY_COUNT", 2)
        request = SimpleNamespace(
            headers={"x-forwarded-for": "6.6.6.6, 203.0.113.7, 172.18.0.1"},
            client=SimpleNamespace(host="172.18.0.1"),
        )
        assert get_client_ip(request) == "203.0.113.7"

    def test_fewer_hops_than_configured_uses_the_first(self, monkeypatch):
        """A LAN request straight to Caddy carries only Caddy's entry."""
        assert self._client_id(monkeypatch, "192.168.0.12") == "ip:192.168.0.12"


class TestContentSecurityPolicy:
    """CSP used to be production-only, i.e. absent on the exposed deployment."""

    @staticmethod
    def _client(monkeypatch, *, environment, enable_docs=False):
        import app.main as main_module

        monkeypatch.setattr(main_module.settings, "ENVIRONMENT", environment)
        monkeypatch.setattr(main_module.settings, "ENABLE_API_DOCS", enable_docs)
        return TestClient(main_module.create_app())

    @pytest.mark.parametrize("environment", ["development", "production", "staging"])
    def test_sent_in_every_environment(self, monkeypatch, environment):
        response = self._client(monkeypatch, environment=environment).get("/health")
        assert "default-src 'none'" in response.headers["Content-Security-Policy"]

    def test_exempts_swagger_ui_so_it_still_renders(self, monkeypatch):
        """Swagger loads its bundle from a CDN; the strict policy would blank it."""
        client = self._client(
            monkeypatch, environment="development", enable_docs=True
        )
        response = client.get("/docs")

        assert response.status_code == 200
        assert "Content-Security-Policy" not in response.headers

    def test_exemption_does_not_leak_to_api_routes(self, monkeypatch):
        client = self._client(
            monkeypatch, environment="development", enable_docs=True
        )
        assert "Content-Security-Policy" in client.get("/health").headers
