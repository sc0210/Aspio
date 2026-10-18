"""Behaviour of app.utils.currency_helpers."""

from decimal import Decimal

import pytest

from app.utils import currency_helpers as c

pytestmark = pytest.mark.unit


def test_currency_info_known_and_unknown():
    assert c.get_currency_info("twd")["symbol"] == "NT$"
    unknown = c.get_currency_info("ZZZ")
    assert unknown["country"] == "Unknown" and unknown["decimal_places"] == 2
    assert c.get_currency_symbol("JPY") == "¥"
    assert c.get_decimal_places("IDR") == 0


def test_rounding_is_half_up_and_per_currency():
    assert c.round_currency(1.005, "USD") == Decimal("1.01")
    assert c.round_currency(10.5, "JPY") == Decimal("11")
    assert c.round_currency(3, "USD") == Decimal("3.00")


class TestFormatCurrency:
    def test_western(self):
        assert c.format_currency(1234.5, "USD") == "$1,234.50"
        assert c.format_currency(1234567, "JPY") == "¥1,234,567"

    def test_code_and_no_symbol(self):
        assert c.format_currency(5, "USD", show_symbol=False, show_code=True) == "5.00 USD"

    def test_asian_grouping_below_threshold(self):
        assert c.format_currency(999, "TWD", format_type="asian") == "NT$999.00"

    def test_asian_grouping_uses_korean_units_today(self):
        # Pins current behaviour for the grouping branch; see the xfail below.
        assert c.format_currency(12345, "TWD", format_type="asian") == "NT$1.2만"
        assert c.format_currency(250000000, "TWD", format_type="asian") == "NT$2.5억"

    @pytest.mark.xfail(strict=True, reason="Korean 만/억 are used for every currency, TWD should get 萬/億")
    def test_twd_uses_chinese_units(self):
        assert c.format_currency(12345, "TWD", format_type="asian") == "NT$1.2萬"

    def test_format_asian_number_below_threshold(self):
        assert c.format_asian_number(Decimal("5000")) == "5,000"
