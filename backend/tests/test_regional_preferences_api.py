"""
PUT /users/me/regional-preferences — the account's currency, language and
timezone, plus display preferences kept in the preferences JSON.

UserService.update_user_data coerces the string codes to the DB enums; before
that it 500'd on every currency change. Its only earlier test mocked it out.
"""

import pytest

pytestmark = pytest.mark.asyncio
URL = "/api/v1/users/me/regional-preferences"


def _me(client):
    r = client.get("/api/v1/users/me")
    assert r.status_code == 200, r.text
    return r.json()


async def test_currency_language_and_timezone_persist(authenticated_client):
    client = authenticated_client
    r = client.put(URL, json={"preferred_currency": "TWD", "preferred_language": "zh-TW",
                              "timezone": "Asia/Taipei"})
    assert r.status_code == 200, r.text

    me = _me(client)
    assert me["preferred_currency"] == "TWD"
    assert me["preferred_language"] == "zh-TW"
    assert me["timezone"] == "Asia/Taipei"


async def test_display_preferences_merge_into_the_json(authenticated_client):
    client = authenticated_client
    assert client.put(URL, json={"date_format": "roc"}).status_code == 200
    assert client.put(URL, json={"number_format": "asian"}).status_code == 200

    prefs = _me(client)["preferences"]
    assert prefs["date_format"] == "roc"
    assert prefs["number_format"] == "asian"


@pytest.mark.parametrize(
    "body",
    [{"preferred_currency": "XXX"}, {"preferred_currency": "JPY"}, {"preferred_language": "fr"},
     {"date_format": "julian"}],
    ids=["unknown-currency", "legacy-currency", "unknown-language", "unknown-date-format"],
)
async def test_unsupported_values_are_rejected_and_nothing_changes(authenticated_client, body):
    client = authenticated_client
    before = _me(client)
    assert client.put(URL, json=body).status_code == 422
    after = _me(client)
    assert after["preferred_currency"] == before["preferred_currency"]
    assert after["preferred_language"] == before["preferred_language"]


async def test_requires_a_signed_in_user(client):
    assert client.put(URL, json={"preferred_currency": "TWD"}).status_code in (401, 403)
