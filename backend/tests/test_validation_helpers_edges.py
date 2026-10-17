"""Behaviour of the pure input validators in app.utils.validation_helpers."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.utils import validation_helpers as v

pytestmark = pytest.mark.unit

UTC = timezone.utc


class TestEmail:
    @pytest.mark.parametrize("email", ["", "   ", None])
    def test_blank_is_required(self, email):
        assert v.validate_email(email) == (False, "Email is required")

    def test_too_long(self):
        assert v.validate_email("a" * 250 + "@x.com") == (False, "Email address is too long")

    @pytest.mark.parametrize("email", ["plain", "a@b", "a b@c.com", "@c.com"])
    def test_bad_format(self, email):
        assert v.validate_email(email) == (False, "Invalid email format")

    def test_local_part_too_long(self):
        assert v.validate_email("a" * 65 + "@example.com") == (
            False, "Email local part must be 1-64 characters")

    def test_valid_is_trimmed_and_case_insensitive(self):
        assert v.validate_email("  User@Example.COM ") == (True, None)


class TestPassword:
    def test_empty(self):
        assert v.validate_password("") == (False, ["Password is required"])

    def test_strong_password_passes(self):
        assert v.validate_password("Zx9!kLm2") == (True, [])

    def test_short_and_missing_classes_are_all_reported(self):
        ok, errors = v.validate_password("abc")
        assert not ok
        assert "Password must be at least 8 characters long" in errors
        assert "Password must contain at least one uppercase letter" in errors
        assert "Password must contain at least one digit" in errors
        assert "Password must contain at least one special character" in errors

    def test_too_long(self):
        ok, errors = v.validate_password("Aa1!" * 40)
        assert "Password cannot exceed 128 characters" in errors

    def test_missing_lowercase(self):
        _, errors = v.validate_password("ZX9!KLM2")
        assert "Password must contain at least one lowercase letter" in errors

    @pytest.mark.parametrize("pw", ["Aaaa1!xyz", "Qwert1!xY", "Xpassword1!"])
    def test_weak_patterns_flagged_once(self, pw):
        _, errors = v.validate_password(pw)
        assert errors.count("Password contains common weak patterns") == 1


class TestPhone:
    def test_required(self):
        assert v.validate_phone_number("") == (False, "Phone number is required")

    def test_letters_rejected(self):
        ok, _ = v.validate_phone_number("12345abc")
        assert not ok

    @pytest.mark.parametrize("phone", ["123456", "1" * 16])
    def test_length_bounds(self, phone):
        assert v.validate_phone_number(phone) == (False, "Phone number must be 7-15 digits long")

    def test_formatting_chars_are_stripped(self):
        assert v.validate_phone_number("+65 (8123) 4567") == (True, None)

    def test_country_pattern_mismatch(self):
        assert v.validate_phone_number("71234567", "sg") == (False, "Invalid sg phone number format")

    def test_country_pattern_match(self):
        assert v.validate_phone_number("81234567", "SG") == (True, None)

    def test_unknown_country_is_not_checked(self):
        assert v.validate_phone_number("71234567", "ZZ") == (True, None)


class TestCurrencyAmount:
    def test_decimal_ok(self):
        assert v.validate_currency_amount(Decimal("10"), "USD") == (True, None)

    def test_float_ok(self):
        assert v.validate_currency_amount(12.5, "USD") == (True, None)

    def test_string_is_parsed(self):
        assert v.validate_currency_amount("$1,234.56", "USD") == (True, None)

    def test_unparseable_string(self):
        assert v.validate_currency_amount("abc", "USD") == (False, "Invalid amount format")

    def test_unsupported_type(self):
        assert v.validate_currency_amount([1], "USD") == (False, "Invalid amount format")

    def test_negative(self):
        assert v.validate_currency_amount(Decimal("-1"), "USD") == (False, "Amount cannot be negative")

    def test_min_and_max(self):
        assert v.validate_currency_amount(Decimal("1"), "USD", min_amount=Decimal("5")) == (
            False, "Amount must be at least 5")
        assert v.validate_currency_amount(Decimal("9"), "USD", max_amount=Decimal("5")) == (
            False, "Amount cannot exceed 5")

    def test_per_currency_ceiling(self):
        assert v.validate_currency_amount(Decimal("10000001"), "USD") == (
            False, "Amount exceeds maximum allowed for USD")
        assert v.validate_currency_amount(Decimal("10000001"), "IDR") == (True, None)
        assert v.validate_currency_amount(Decimal("100000001"), "JPY")[0] is False


@pytest.mark.xfail(strict=True, reason="validate_currency_amount rejects plain int amounts")
def test_int_amount_is_accepted():
    assert v.validate_currency_amount(5, "USD") == (True, None)


class TestCurrencyCode:
    def test_required(self):
        assert v.validate_currency_code("") == (False, "Currency code is required")

    def test_length(self):
        assert v.validate_currency_code("US") == (False, "Currency code must be exactly 3 characters")

    def test_unsupported(self):
        assert v.validate_currency_code("XXX") == (False, "Currency XXX is not supported")

    def test_supported_is_case_insensitive(self):
        assert v.validate_currency_code(" twd ") == (True, None)


class TestUuid:
    def test_required(self):
        assert v.validate_uuid("", "User ID") == (False, "User ID is required")

    def test_invalid(self):
        assert v.validate_uuid("nope") == (False, "Invalid ID format")

    def test_valid(self):
        assert v.validate_uuid("12345678-1234-5678-1234-567812345678") == (True, None)


class TestDateRange:
    def test_missing_dates(self):
        assert v.validate_date_range(None, datetime.now(UTC)) == (False, "Start date is required")
        assert v.validate_date_range(datetime.now(UTC), None) == (False, "End date is required")

    def test_unparseable_strings(self):
        assert v.validate_date_range("garbage", datetime.now(UTC)) == (False, "Invalid start date format")
        assert v.validate_date_range(datetime.now(UTC), "garbage") == (False, "Invalid end date format")

    def test_end_must_follow_start(self):
        d = datetime(2026, 1, 1)
        assert v.validate_date_range(d, d) == (False, "End date must be after start date")

    def test_max_days(self):
        s = datetime(2026, 1, 1)
        assert v.validate_date_range(s, s + timedelta(days=11), max_days=10) == (
            False, "Date range cannot exceed 10 days")

    def test_too_far_in_future(self):
        s = datetime.now(UTC) + timedelta(days=4000)
        assert v.validate_date_range(s, s + timedelta(days=1)) == (
            False, "Dates cannot be more than 10 years in the future")

    def test_valid_with_iso_strings(self):
        assert v.validate_date_range("2026-01-01T00:00:00", "2026-02-01T00:00:00") == (True, None)


class TestFinancialGoal:
    future = datetime.now(UTC) + timedelta(days=365)

    def test_valid(self):
        assert v.validate_financial_goal(1000.0, 100.0, self.future, "USD") == (True, [])

    def test_current_above_target(self):
        _, errors = v.validate_financial_goal(100, 500, self.future, "USD")
        assert "Current amount cannot exceed target amount" in errors

    def test_past_and_far_dates(self):
        _, errors = v.validate_financial_goal(100, 0, datetime(2000, 1, 1), "USD")
        assert "Target date must be in the future" in errors
        _, errors = v.validate_financial_goal(
            100, 0, datetime.now(UTC) + timedelta(days=20000), "USD")
        assert "Target date cannot be more than 50 years in the future" in errors

    def test_bad_date_string(self):
        _, errors = v.validate_financial_goal(100, 0, "garbage", "USD")
        assert "Invalid target date format" in errors

    def test_bad_amounts_are_labelled(self):
        _, errors = v.validate_financial_goal(0, -1, self.future, "USD")
        assert any(e.startswith("Target amount:") for e in errors)
        assert any(e.startswith("Current amount:") for e in errors)


class TestTransactionData:
    def test_valid(self):
        assert v.validate_transaction_data(5.0, "expense", "Food", "USD", "lunch") == (True, [])

    def test_everything_wrong(self):
        ok, errors = v.validate_transaction_data(0, "gift", " ", "USD", "x" * 501)
        assert not ok
        assert len(errors) == 4

    def test_long_category(self):
        _, errors = v.validate_transaction_data(5.0, "income", "c" * 101, "USD")
        assert errors == ["Category name cannot exceed 100 characters"]


class TestSanitizeAndPagination:
    def test_sanitize(self):
        assert v.sanitize_string("") == ""
        assert v.sanitize_string('  <b>"hi"&\'</b> ') == "bhi/b"
        assert v.sanitize_string("abcdef", max_length=3) == "abc"

    @pytest.mark.parametrize("page,limit,expected", [
        (0, 10, (False, "Page must be at least 1")),
        (1, 0, (False, "Limit must be at least 1")),
        (1, 101, (False, "Limit cannot exceed 100")),
        (1, 100, (True, None)),
    ])
    def test_pagination(self, page, limit, expected):
        assert v.validate_pagination_params(page, limit) == expected
