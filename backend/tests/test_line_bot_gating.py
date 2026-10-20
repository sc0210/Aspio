"""The LINE bot is an optional add-on, on only when its channel is configured.

A self-hoster who never created a LINE channel should get no /line-bot routes,
and /features must say so, since the frontend hides every LINE surface off it.
"""

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings

BASE_SETTINGS = dict(
    DATABASE_URL="postgresql+asyncpg://user:pass@localhost/db",
    SECRET_KEY="x" * 32,
)


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **{**BASE_SETTINGS, **overrides})


class TestLineBotEnabled:
    @pytest.mark.parametrize(
        "secret, token, expected",
        [
            (None, None, False),
            ("s", None, False),
            (None, "t", False),
            ("", "", False),
            ("s", "t", True),
        ],
    )
    def test_needs_both_credentials(self, secret, token, expected):
        settings = _settings(LINE_CHANNEL_SECRET=secret, LINE_CHANNEL_ACCESS_TOKEN=token)
        assert settings.line_bot_enabled is expected


class TestLineBotRouteMounting:
    @staticmethod
    def _app_with(monkeypatch, *, enabled: bool):
        import app.main as main_module

        monkeypatch.setattr(
            type(main_module.settings),
            "line_bot_enabled",
            property(lambda self: enabled),
        )
        return main_module.create_app()

    def test_routes_absent_when_unconfigured(self, monkeypatch):
        app = self._app_with(monkeypatch, enabled=False)
        assert not any(r.path.startswith("/api/v1/line-bot") for r in app.routes)
        assert TestClient(app).post("/api/v1/line-bot/webhook", content=b"{}").status_code == 404

    def test_routes_present_when_configured(self, monkeypatch):
        app = self._app_with(monkeypatch, enabled=True)
        # The webhook is include_in_schema=False, so read the route table.
        assert "/api/v1/line-bot/webhook" in {r.path for r in app.routes}

    @pytest.mark.parametrize("enabled", [True, False])
    def test_features_reports_flag_without_auth(self, monkeypatch, enabled):
        res = TestClient(self._app_with(monkeypatch, enabled=enabled)).get("/api/v1/features")
        assert res.status_code == 200
        assert res.json()["data"] == {"line_bot": enabled}
