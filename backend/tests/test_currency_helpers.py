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


class TestConvert:
    def test_same_currency_only_rounds(self):
        assert c.convert_to_display_currency(1.234, "USD", "USD") == Decimal("1.23")

    def test_no_rates_returns_amount(self):
        assert c.convert_to_display_currency(10, "USD", "TWD") == Decimal("10.00")

    def test_via_usd_base(self):
        rates = {"TWD": 30.0, "JPY": 150.0}
        assert c.convert_to_display_currency(30, "TWD", "USD", rates) == Decimal("1.00")
        assert c.convert_to_display_currency(1, "USD", "TWD", rates) == Decimal("30.00")
        assert c.convert_to_display_currency(30, "TWD", "JPY", rates) == Decimal("150")


class TestParse:
    @pytest.mark.parametrize("raw,expected", [
        ("$1,234.56", "1234.56"),
        ("1,234", "1234.00"),
        ("USD 99", "99.00"),
    ])
    def test_parse(self, raw, expected):
        assert c.parse_currency_amount(raw, "USD") == Decimal(expected)

    @pytest.mark.xfail(strict=True, reason="comma is stripped before the decimal-separator logic runs")
    @pytest.mark.parametrize("raw,expected", [("1.234,56", "1234.56"), ("12,5", "12.50")])
    def test_comma_decimal_separator(self, raw, expected):
        assert c.parse_currency_amount(raw, "USD") == Decimal(expected)

    @pytest.mark.xfail(strict=True, reason="InvalidOperation escapes instead of the documented ValueError")
    def test_garbage_raises_value_error(self):
        with pytest.raises(ValueError):
            c.parse_currency_amount("abc", "USD")


def test_misc_helpers():
    assert "USD" in c.get_supported_currencies()
    assert c.is_major_asian_currency("twd") and not c.is_major_asian_currency("USD")
    assert c.format_percentage(12.3) == "12.30%"
    assert c.format_percentage(5, 0) == "5%"
    assert c.calculate_percentage_change(0, 0) == Decimal("0")
    assert c.calculate_percentage_change(0, 5) == Decimal("100")
    assert c.calculate_percentage_change(50, 75) == Decimal("50.00")
    assert c.create_exchange_rate_key("usd", "twd") == "exchange_rate:USD:TWD"
    assert c.validate_currency_code("sgd") and not c.validate_currency_code("XXX")
