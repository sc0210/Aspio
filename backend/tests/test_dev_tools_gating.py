"""Gating tests for the password-less development sign-in route.

`/auth/dev-login` hands out a valid token pair for any local account without a
password. The only thing standing between that and a production incident is the
`Settings.dev_login_active` gate plus the conditional `include_router` in
`create_app`, so both are asserted here directly.
"""

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings

BASE_SETTINGS = dict(
    DATABASE_URL="postgresql+asyncpg://user:pass@localhost/db",
    SECRET_KEY="x" * 32,
    DEV_TOOLS_TOKEN="dev-secret",
)


def _settings(**overrides) -> Settings:
    # _env_file=None keeps these hermetic: the dev container both exports
    # DEV_LOGIN_ENABLED and ships a .env that sets it, so a non-isolated
    # Settings() would assert the developer's machine rather than the defaults.
    # Overrides are merged (not splatted alongside) so a test can replace a
    # BASE_SETTINGS key such as DATABASE_URL.
    return Settings(_env_file=None, **{**BASE_SETTINGS, **overrides})


class TestDevLoginGate:
    """`dev_login_active` must require every condition, not just the flag."""

    @pytest.mark.parametrize(
        "environment,flag,expected",
        [
            # The dangerous combination: someone copies the flag into prod.
            ("production", True, False),
            ("prod", True, False),
            ("production", False, False),
            # Anything that isn't explicitly a dev environment stays closed,
            # including environments the helpers don't recognise.
            ("staging", True, False),
            ("test", True, False),
            ("", True, False),
            # Dev environments still need the explicit opt-in.
            ("development", False, False),
            ("dev", False, False),
            ("local", False, False),
            # Only these open the gate.
            ("development", True, True),
            ("dev", True, True),
            ("local", True, True),
            ("LOCAL", True, True),
        ],
    )
    def test_gate_matrix(self, environment, flag, expected):
        settings = _settings(ENVIRONMENT=environment, DEV_LOGIN_ENABLED=flag)
        assert settings.dev_login_active is expected

    def test_disabled_by_default(self, monkeypatch):
        """A config that never mentions the flag must not enable the bypass.

        Isolated from the ambient environment on purpose — the dev container
        exports DEV_LOGIN_ENABLED, and this asserts the *default*, not what the
        current shell happens to say.
        """
        monkeypatch.delenv("DEV_LOGIN_ENABLED", raising=False)
        monkeypatch.delenv("DEV_TOOLS_TOKEN", raising=False)

        # Built without BASE_SETTINGS' test token, so this really is the default.
        bare = Settings(
            _env_file=None,
            DATABASE_URL="postgresql+asyncpg://user:pass@localhost/db",
            SECRET_KEY="x" * 32,
        )
        assert bare.DEV_LOGIN_ENABLED is False
        assert bare.DEV_TOOLS_TOKEN == ""
        assert bare.dev_login_active is False
        assert _settings(ENVIRONMENT="development").dev_login_active is False

    def test_requires_a_configured_token(self):
        """Without a shared secret the route stays shut.

        This is the condition that protects a deployment whose ENVIRONMENT says
        "development" while it serves real users over the internet — which is
        exactly what the self-hosted Pi does.
        """
        assert _settings(
            ENVIRONMENT="development", DEV_LOGIN_ENABLED=True, DEV_TOOLS_TOKEN=""
        ).dev_login_active is False

    @pytest.mark.parametrize(
        "database_url,expected",
        [
            ("postgresql+asyncpg://u:p@localhost/db", True),
            ("postgresql+asyncpg://u:p@127.0.0.1:5432/db", True),
            ("postgresql+asyncpg://u:p@postgres:5432/db", True),
            # A dev-shaped config pointed at a remote database must not open it.
            ("postgresql+asyncpg://u:p@db.abcdef.supabase.co:6543/postgres", False),
            ("postgresql+asyncpg://u:p@192.168.0.176:5433/aspiro_db", False),
            ("postgresql+asyncpg://u:p@10.0.0.5/db", False),
        ],
    )
    def test_requires_local_database(self, database_url, expected):
        settings = _settings(
            ENVIRONMENT="development",
            DEV_LOGIN_ENABLED=True,
            DATABASE_URL=database_url,
        )
        assert settings.dev_login_active is expected


class TestDevLoginRouteMounting:
    """The routes must not exist at all when the gate is closed."""

    @staticmethod
    def _app_with(monkeypatch, *, active: bool):
        """Build a fresh app with `dev_login_active` forced to `active`."""
        import app.main as main_module

        monkeypatch.setattr(
            type(main_module.settings),
            "dev_login_active",
            property(lambda self: active),
        )
        return main_module.create_app()

    def test_routes_absent_when_disabled(self, monkeypatch):
        client = TestClient(self._app_with(monkeypatch, active=False))

        # 404, not 401/403 — a closed gate shouldn't advertise the route.
        assert client.post(
            "/api/v1/auth/dev-login", json={"email": "demo@aspiro.dev"}
        ).status_code == 404

    def test_routes_absent_from_openapi_when_disabled(self, monkeypatch):
        app = self._app_with(monkeypatch, active=False)
        paths = app.openapi().get("paths", {})
        assert "/api/v1/auth/dev-login" not in paths

    def test_routes_registered_when_enabled(self, monkeypatch):
        app = self._app_with(monkeypatch, active=True)
        paths = app.openapi().get("paths", {})
        assert "/api/v1/auth/dev-login" in paths
        # No account-listing endpoint: it leaked every email and role.
        assert "/api/v1/auth/dev-users" not in paths

    def test_handler_refuses_even_if_mounted_while_disabled(self, monkeypatch):
        """Defence in depth: the handler re-checks the gate itself.

        Guards against a future refactor that mounts the router unconditionally.
        """
        import app.modules.auth.dev_router as dev_router

        monkeypatch.setattr(
            type(dev_router.settings),
            "dev_login_active",
            property(lambda self: False),
        )
        with pytest.raises(Exception) as excinfo:
            dev_router._assert_enabled()
        assert getattr(excinfo.value, "status_code", None) == 404


class TestDevToolsToken:
    """The shared secret is the boundary, since the port is reachable.

    Guards `require_dev_tools_token`, which every developer-only route depends
    on — password-less sign-in and the DB-sync endpoints alike.
    """

    @staticmethod
    def _configure(monkeypatch, *, token: str, active: bool = True):
        import app.core.dev_tools as dev_tools

        settings = dev_tools.get_settings()
        # DEV_TOOLS_TOKEN is a pydantic field, so patch the settings *instance*;
        # replacing it with a class-level property raises, because the field
        # already occupies that name. dev_tools_active is a real property, so it
        # has to be patched on the class.
        monkeypatch.setattr(settings, "DEV_TOOLS_TOKEN", token)
        monkeypatch.setattr(
            type(settings), "dev_tools_active", property(lambda self: active)
        )
        return dev_tools

    @pytest.mark.parametrize(
        "provided",
        [None, "", "wrong", "dev-secre", "dev-secrett", "DEV-SECRET"],
    )
    def test_rejects_missing_or_wrong_token(self, monkeypatch, provided):
        dev_tools = self._configure(monkeypatch, token="dev-secret")
        with pytest.raises(Exception) as excinfo:
            dev_tools.require_dev_tools_token(provided)
        # 404 so a probe can't distinguish "wrong secret" from "no such route".
        assert getattr(excinfo.value, "status_code", None) == 404

    def test_accepts_correct_token(self, monkeypatch):
        dev_tools = self._configure(monkeypatch, token="dev-secret")
        dev_tools.require_dev_tools_token("dev-secret")  # must not raise

    def test_unset_token_rejects_everything(self, monkeypatch):
        """An empty configured secret must never match, including empty input."""
        dev_tools = self._configure(monkeypatch, token="")
        for candidate in (None, "", "anything"):
            with pytest.raises(Exception):
                dev_tools.require_dev_tools_token(candidate)

    def test_rejects_correct_token_when_gate_closed(self, monkeypatch):
        """Knowing the secret is not enough if dev tools aren't active."""
        dev_tools = self._configure(monkeypatch, token="dev-secret", active=False)
        with pytest.raises(Exception) as excinfo:
            dev_tools.require_dev_tools_token("dev-secret")
        assert getattr(excinfo.value, "status_code", None) == 404


class TestDevDbSyncGating:
    """`/dev/db-sync/*` TRUNCATEs whole databases and has no user auth.

    It used to be mounted on `is_development` alone, which is true on the
    self-hosted Pi — making `POST /dev/db-sync/pull` an unauthenticated,
    internet-reachable "replace this database" button.
    """

    @staticmethod
    def _app_with(monkeypatch, *, active: bool):
        import app.main as main_module

        monkeypatch.setattr(
            type(main_module.settings),
            "dev_tools_active",
            property(lambda self: active),
        )
        monkeypatch.setattr(
            type(main_module.settings),
            "dev_login_active",
            property(lambda self: False),
        )
        return main_module.create_app()

    DB_SYNC_PATHS = (
        "/api/v1/dev/db-sync/status",
        "/api/v1/dev/db-sync/push",
        "/api/v1/dev/db-sync/pull",
        "/api/v1/dev/db-sync/status-pi",
        "/api/v1/dev/db-sync/push-pi",
        "/api/v1/dev/db-sync/pull-pi",
    )

    def test_not_mounted_when_dev_tools_inactive(self, monkeypatch):
        app = self._app_with(monkeypatch, active=False)
        paths = app.openapi().get("paths", {})
        for path in self.DB_SYNC_PATHS:
            assert path not in paths, f"{path} must not exist without dev tools"

    def test_destructive_routes_unreachable_when_inactive(self, monkeypatch):
        client = TestClient(self._app_with(monkeypatch, active=False))
        assert client.get("/api/v1/dev/db-sync/status").status_code == 404
        assert client.post("/api/v1/dev/db-sync/pull").status_code == 404
        assert client.post("/api/v1/dev/db-sync/pull-pi").status_code == 404

    def test_mounted_but_token_gated_when_active(self, monkeypatch):
        app = self._app_with(monkeypatch, active=True)
        paths = app.openapi().get("paths", {})
        for path in self.DB_SYNC_PATHS:
            assert path in paths

        # Mounted is not the same as open: the router-level dependency still
        # demands the secret, and the real settings have none configured.
        client = TestClient(app)
        assert client.get("/api/v1/dev/db-sync/status").status_code == 404
        assert client.post("/api/v1/dev/db-sync/pull").status_code == 404
