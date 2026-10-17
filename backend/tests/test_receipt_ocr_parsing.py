"""Receipt OCR text -> transaction fields.

The parser is the risky half of receipt scanning: whatever it returns gets
pre-filled into a money field, so a confidently wrong number is worse than no
number. These tests pin the conservative behaviour — most importantly that an
amount is only reported when a line actually names a total.

The OCR step itself (tesseract) is not exercised here; it is a binary in the
image, and testing it would test tesseract rather than our code.
"""

import pytest
from unittest.mock import MagicMock

from app.modules.transactions.attachment_service import AttachmentService


@pytest.fixture
def svc():
    return AttachmentService(MagicMock(), MagicMock())


class TestAmount:
    @pytest.mark.unit
    def test_reads_total_from_a_labelled_line(self, svc):
        text = "\n".join(["7-ELEVEN", "咖啡 45", "麵包 30", "總計 75"])
        assert svc._parse_receipt_text(text)["amount"] == 75.0

    @pytest.mark.unit
    def test_takes_the_largest_of_subtotal_tax_and_total(self, svc):
        # Receipts print all three in one block; the payable figure is the
        # biggest, and all three lines match a total keyword.
        text = "\n".join(["全聯", "小計 200", "合計 210"])
        assert svc._parse_receipt_text(text)["amount"] == 210.0

    @pytest.mark.unit
    def test_handles_thousands_separators_and_decimals(self, svc):
        assert svc._parse_receipt_text("應付金額 1,234.50")["amount"] == 1234.50

    @pytest.mark.unit
    def test_english_receipts(self, svc):
        assert svc._parse_receipt_text("Starbucks\nTOTAL $12.75")["amount"] == 12.75

    @pytest.mark.unit
    def test_no_total_line_yields_no_amount(self, svc):
        """The single most important case.

        Plenty of numbers here — a phone number, a tax id, item prices — and
        none of them is the payable total. Returning the largest number on the
        receipt would confidently pre-fill 91234567.
        """
        text = "\n".join(["小北百貨", "TEL 0912345678", "統編 12345678", "鉛筆 25"])
        assert svc._parse_receipt_text(text)["amount"] is None

    @pytest.mark.unit
    def test_blank_input(self, svc):
        parsed = svc._parse_receipt_text("   \n  \n")
        assert parsed["amount"] is None
        assert parsed["confidence"] == 0.0


class TestDate:
    @pytest.mark.unit
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("日期 2026-08-15", "2026-08-15"),
            ("2026/8/5 14:22", "2026-08-05"),
            # Republic-of-China year: 115 + 1911 = 2026.
            ("115/08/15", "2026-08-15"),
        ],
    )
    def test_normalises_to_iso(self, svc, raw, expected):
        assert svc._parse_receipt_text(raw)["date"] == expected

    @pytest.mark.unit
    def test_impossible_date_is_rejected_not_clamped(self, svc):
        assert svc._parse_receipt_text("2026-13-45")["date"] is None

    @pytest.mark.unit
    def test_no_date_present(self, svc):
        assert svc._parse_receipt_text("總計 75")["date"] is None


class TestMerchant:
    @pytest.mark.unit
    def test_takes_the_name_at_the_top(self, svc):
        text = "\n".join(["星巴克咖啡", "台北市信義區", "總計 120"])
        assert svc._parse_receipt_text(text)["merchant_name"] == "星巴克咖啡"

    @pytest.mark.unit
    def test_skips_leading_numeric_noise(self, svc):
        text = "\n".join(["2026-08-15", "0912345678", "全家便利商店", "總計 60"])
        assert svc._parse_receipt_text(text)["merchant_name"] == "全家便利商店"


class TestConfidence:
    @pytest.mark.unit
    def test_rises_with_how_much_was_recovered(self, svc):
        none_found = svc._parse_receipt_text("?????")
        all_found = svc._parse_receipt_text("星巴克\n2026-08-15\n總計 120")
        assert none_found["confidence"] == 0.0
        assert all_found["confidence"] == 0.85

    @pytest.mark.unit
    def test_category_is_never_guessed(self, svc):
        """Miscategorised spending is silently wrong in every report."""
        assert svc._parse_receipt_text("星巴克\n總計 120")["category"] is None
