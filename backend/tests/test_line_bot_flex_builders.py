"""Pure LINE message builders, parsers and signature check (no DB, no network)."""

import base64
import hashlib
import hmac
import json
import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.modules.line_bot import service as svc
from app.modules.line_bot.schemas import BalanceEntry

pytestmark = pytest.mark.unit

D = Decimal


def texts(node):
    """Every string under a "text"/"label" key, in document order."""
    out = []
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ("text", "label") and isinstance(v, str):
                out.append(v)
            else:
                out.extend(texts(v))
    elif isinstance(node, list):
        for v in node:
            out.extend(texts(v))
    return out


def blob(flex):
    return " | ".join(texts(flex))


A, B = uuid.uuid4(), uuid.uuid4()

# One zero-arg factory per builder so a new builder only needs a line here.
BUILDERS = {
    "expense_confirm": lambda: svc._flex_expense_confirm("Dinner", D("1200"), "TWD", "Sam", "split 3 ways"),
    "balance": lambda: svc._flex_balance([BalanceEntry(owed_by=A, owed_to=B, amount=D("50"), currency="TWD")], "TWD", {str(A): "Ann"}),
    "not_linked_dm": lambda: svc._flex_not_linked("dm"),
    "not_linked_group": lambda: svc._flex_not_linked("group"),
    "link_prompt": lambda: svc._flex_link_prompt("https://x/y", 10),
    "settle_confirm": lambda: svc._flex_settle_confirm("Bob", "TWD", D("300")),
    "undo_confirm": lambda: svc._flex_undo_confirm("Coffee", "TWD", D("90")),
    "all_settled": svc._flex_all_settled,
    "welcome_new": lambda: svc._flex_welcome_new("https://x/y", 10),
    "welcome_back": lambda: svc._flex_welcome_back("Sam"),
    "group_join_liff": lambda: svc._flex_group_join_liff("https://liff.line.me/1"),
    "group_join_welcome": svc._flex_group_join_welcome,
    "goals": lambda: svc._flex_goals([{"name": "Trip", "current_amount": 50, "target_amount": 100, "days_left": 5}]),
    "portfolio": lambda: svc._flex_portfolio([{"symbol": "0050", "name": "ETF", "total_value": 100, "gain_loss_percentage": -2}], 100.0, -2.0),
    "txn_confirm": lambda: svc._flex_txn_confirm("Lunch", D("150"), "TWD", "food"),
    "help_dm": lambda: svc._flex_help(False),
    "help_group": lambda: svc._flex_help(True),
    "group_summary": lambda: svc._flex_group_summary("2026-10", "TWD", D("1000"), 4, {"u1": D("600"), "u2": D("400")}, {"u1": "Ann"}),
    "main_menu_dm": lambda: svc._flex_main_menu(False),
    "main_menu_group": lambda: svc._flex_main_menu(True),
    "history": lambda: svc._flex_history("Recent", [{"date": "2026-10-03", "description": "Taxi", "amount": 250, "currency": "TWD", "type": "expense", "category": "transport"}]),
    "history_empty": lambda: svc._flex_history("Recent", []),
    "dm_balance": lambda: svc._flex_dm_balance("2026-10", {"total_income": D("1000"), "total_expenses": D("400"), "net_amount": D("600"), "transaction_count": 7}),
    "dm_summary": lambda: svc._flex_dm_summary("2026-10", [{"category_name": "food", "total_amount": 300, "pct": 60}, {"category_name": "fun", "total_amount": 200, "pct": 40}]),
    "rate": lambda: svc._flex_rate("USD", {"USD": 1.0, "TWD": 32.5, "EUR": 0.92}),
    "add_amount_picker": svc._flex_add_amount_picker,
    "add_desc_picker": lambda: svc._flex_add_desc_picker("100"),
    "txn_category_picker": svc._flex_txn_category_picker,
    "txn_amount_picker": lambda: svc._flex_txn_amount_picker("food"),
    "txn_desc_picker": lambda: svc._flex_txn_desc_picker("food", "100"),
}


@pytest.mark.parametrize("name", sorted(BUILDERS))
def test_every_builder_emits_serialisable_flex(name):
    flex = BUILDERS[name]()
    assert flex["type"] in ("bubble", "carousel")
    json.dumps(flex)  # LINE rejects anything that is not plain JSON
    assert texts(flex), "a message with no text is blank on the phone"


def test_balance_names_known_members_and_truncates_unknown_ids():
    out = blob(svc._flex_balance(
        [BalanceEntry(owed_by=A, owed_to=B, amount=D("50"), currency="TWD")], "TWD", {str(A): "Ann"}))
    assert "Ann" in out and str(B)[:8] in out


def test_balance_empty_means_settled():
    assert "All settled up" in blob(svc._flex_balance([], "TWD", {}))


class TestGoals:
    def test_empty(self):
        assert "No Active Goals" in blob(svc._flex_goals([]))

    def test_caps_at_four_and_labels_deadline(self):
        goals = [{"name": f"G{i}", "current_amount": 10, "target_amount": 100} for i in range(6)]
        out = blob(svc._flex_goals(goals))
        assert "G3" in out and "G4" not in out and "No deadline" in out

    def test_zero_target_does_not_divide_by_zero(self):
        svc._flex_goals([{"name": "x", "current_amount": 5, "target_amount": 0, "days_left": 3}])


class TestPortfolio:
    def test_gain_sign_and_native_currency(self):
        out = blob(svc._flex_portfolio(
            [{"symbol": "VT", "total_value": 10, "currency": "USD", "gain_loss_percentage": 3}], 10.0, 3.0))
        assert "+3" in out and "USD" in out

    def test_caps_at_five_rows(self):
        hs = [{"symbol": f"S{i}", "total_value": 1} for i in range(8)]
        out = blob(svc._flex_portfolio(hs, 8.0, 0.0))
        assert "S4" in out and "S5" not in out


def test_group_summary_ignores_zero_total():
    svc._flex_group_summary("2026-10", "TWD", D("0"), 0, {"u": D("0")}, {})


def test_dm_balance_negative_net_has_no_plus_and_zero_income_is_safe():
    flex = svc._flex_dm_balance("2026-10", {"total_income": D("0"), "total_expenses": D("50"), "net_amount": D("-50")})
    assert "-50" in blob(flex) and "+-" not in blob(flex)


def test_history_income_is_signed_plus():
    out = blob(svc._flex_history("T", [{"date": "2026-10-03", "description": "Pay", "amount": 1000, "currency": "TWD", "type": "income"}]))
    assert "+TWD 1,000" in out and "10-03" in out
    assert "No transactions yet" in blob(svc._flex_history("T", []))


def test_rate_skips_base_and_picks_precision():
    out = blob(svc._flex_rate("USD", {"USD": 1.0, "TWD": 32.5, "EUR": 0.92, "XYZ": 5}))
    assert "32.50" in out and "0.9200" in out and "🌐 XYZ" in out and "🇺🇸" not in out


def test_help_differs_between_dm_and_group():
    assert blob(svc._flex_help(True)) != blob(svc._flex_help(False))


class TestParseTxn:
    def test_with_category(self):
        assert svc._parse_txn("/txn 150 Food coffee beans") == (D("150"), "food", "coffee beans")

    def test_without_category_defaults_to_other_after_first_word_swallowed(self):
        # Two words after the amount are read as "<category> <description>".
        assert svc._parse_txn("/txn 150 coffee") == (D("150"), "other", "coffee")

    def test_decimal_and_case(self):
        assert svc._parse_txn("/TXN 12.5 fun movie")[0] == D("12.5")

    @pytest.mark.parametrize("text", ["/txn", "/txn abc", "/txn -5 food x", "hello"])
    def test_rejects(self, text):
        assert svc._parse_txn(text) is None


class TestSignature:
    body = b'{"events":[]}'

    def sign(self, secret):
        return base64.b64encode(hmac.new(secret.encode(), self.body, hashlib.sha256).digest()).decode()

    def test_valid_invalid_and_unconfigured(self):
        with patch.object(svc.settings, "LINE_CHANNEL_SECRET", "s3cret"):
            assert svc.verify_line_signature(self.body, self.sign("s3cret"))
            assert not svc.verify_line_signature(self.body, self.sign("other"))
            assert not svc.verify_line_signature(self.body + b" ", self.sign("s3cret"))
        with patch.object(svc.settings, "LINE_CHANNEL_SECRET", ""):
            assert not svc.verify_line_signature(self.body, self.sign(""))


def test_liff_url():
    with patch.object(svc.settings, "LIFF_ID", ""):
        assert svc._liff_url("g") is None
    with patch.object(svc.settings, "LIFF_ID", "123-abc"):
        assert svc._liff_url() == "https://liff.line.me/123-abc"
        assert svc._liff_url("g1") == "https://liff.line.me/123-abc?gid=g1"


def test_category_pie_url_is_short_https_and_carries_labels(monkeypatch):
    # The shipped chart endpoint, not the environment's: the dev stack points
    # QUICKCHART_URL at a local http container, which LINE could not fetch anyway.
    from app.core.config import Settings
    monkeypatch.setattr(svc.settings, "QUICKCHART_URL", Settings.model_fields["QUICKCHART_URL"].default)
    rows = [{"category_name": f"cat{i}", "total_amount": 100 + i} for i in range(8)]
    url = svc._category_pie_url(rows)
    assert url.startswith("https://") and len(url) < 2000
    assert "cat0" in url
