"""An uploaded receipt must never put words in the user's mouth.

`AttachmentService._process_attachment` ran on EVERY image upload, not only in demo
mode, and was a placeholder. Its `confidence` was a hardcoded 0.85, always above its
own 0.8 gate, so whenever the transaction had no merchant yet it wrote
`merchant_name='Sample Store'` and a fabricated `receipt_data` onto the user's real
transaction, and "Merchant: Sample Store / Amount: $25.00" into the attachment's
`ocr_text`. Made-up money data in a personal finance ledger.

Replacing it with real tesseract OCR *here* was worse: `chi_tra+eng` on the
synchronous upload path of a Pi 4 with no timeout, ignoring `is_receipt`, and still
writing a guess — `_parse_receipt_text` scores confidence by how many fields it
found, not by whether they are right, so a Taiwan e-invoice headed `電子發票證明聯`
scores 0.85 and that header becomes the merchant.

The honest path already existed in the same file. `POST /scan-receipt` runs that OCR
and RETURNS the parse for the user to confirm. So uploading stores the file and reads
nothing, and these pin that split.
"""

import ast
import inspect
import pathlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, create_autospec

import pytest

from app.modules.transactions.attachment_service import AttachmentService
from app.modules.transactions.repositories import TransactionRepository

pytestmark = pytest.mark.unit

MODULE = pathlib.Path(
    __import__("app.modules.transactions.attachment_service", fromlist=["x"]).__file__
)


class TestUploadReadsNothingAndWritesNothing:
    def test_the_fabricating_stubs_are_gone(self):
        for name in ("_process_attachment", "_process_image_ocr", "_process_pdf_text"):
            assert not hasattr(AttachmentService, name), name

    def test_upload_does_not_touch_the_transaction_or_run_ocr(self):
        """Static, because upload_attachment is all file I/O and a commit.

        Asserting on a couple of mock names would not catch a write reintroduced
        through a different method, which is the failure mode here.
        """
        source = inspect.getsource(AttachmentService.upload_attachment)
        tree = ast.parse(source.lstrip())

        called = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                called.add(node.func.attr)
                if isinstance(node.func.value, ast.Attribute):
                    called.add(f"{node.func.value.attr}.{node.func.attr}")

        forbidden = {
            "transaction_repo.update",
            "_process_attachment",
            "_extract_from_image",
            "_extract_from_pdf",
            "_extract_receipt_data",
            "_ocr_image",
            "_ocr_pdf",
        }
        assert not (called & forbidden), sorted(called & forbidden)

    def test_no_placeholder_string_survives_as_a_value(self):
        """Docstrings may describe the old fabrication; no value may be it."""
        tree = ast.parse(MODULE.read_text())
        docstrings = set()
        for node in ast.walk(tree):
            if isinstance(
                node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
            ):
                doc = ast.get_docstring(node, clean=False)
                if doc:
                    docstrings.add(doc)

        offenders = [
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and node.value not in docstrings
            and ("Sample Store" in node.value or "amount_detected" in node.value)
        ]
        assert not offenders, offenders


class TestScanReceiptIsTheHonestPath:
    @staticmethod
    def _service(tmp_path):
        svc = AttachmentService.__new__(AttachmentService)
        svc.upload_path = tmp_path
        svc.db = MagicMock()
        svc.db.commit = AsyncMock()
        svc.db.add = MagicMock()
        svc.db.execute = AsyncMock()
        # Autospec: an unspecced repo would let a write through any other method name
        # and keep these green.
        svc.transaction_repo = create_autospec(TransactionRepository, instance=True)
        svc._validate_file = AsyncMock()
        svc._save_file = AsyncMock()
        return svc

    @pytest.mark.asyncio
    async def test_it_returns_the_parse_and_persists_nothing(self, tmp_path):
        svc = self._service(tmp_path)
        parsed = {
            "amount": 120.0,
            "merchant_name": "全家便利商店",
            "confidence": 0.85,
            "raw_text": "全家便利商店\n總計 120",
        }
        svc._extract_receipt_data = AsyncMock(return_value=parsed)
        upload = SimpleNamespace(filename="r.jpg", content_type="image/jpeg")

        result = await svc.scan_receipt(upload, "user-1")

        assert result == parsed
        # Nothing at all reached the repository or the session.
        assert svc.transaction_repo.mock_calls == []
        svc.db.add.assert_not_called()
        svc.db.commit.assert_not_awaited()
        svc.db.execute.assert_not_awaited()


class TestTheRemainingOcrIsBounded:
    """It is off the request path now, but still runs in a worker thread."""

    @pytest.mark.parametrize("fn", ["_ocr_image", "_ocr_pdf"])
    def test_a_timeout_is_not_reported_as_an_empty_receipt(self, fn):
        """pytesseract raises a bare RuntimeError for its own timeout.

        Left to the generic handler it becomes confidence 0.0 with every field None
        — which the user reads as "nothing on this receipt", with no hint to retry
        or shrink the photo. It has to come out as TimeoutError so the router can
        answer 504.
        """
        source = inspect.getsource(getattr(AttachmentService, fn))
        tree = ast.parse(source.lstrip())

        raises_timeout = any(
            isinstance(node, ast.Raise)
            and isinstance(node.exc, ast.Call)
            and getattr(node.exc.func, "id", None) == "TimeoutError"
            for node in ast.walk(tree)
        )
        assert raises_timeout, f"{fn} lets a tesseract timeout look like a blank scan"

    @pytest.mark.parametrize("fn", ["_ocr_image", "_ocr_pdf"])
    def test_tesseract_is_called_with_a_timeout(self, fn):
        source = inspect.getsource(getattr(AttachmentService, fn))
        tree = ast.parse(source.lstrip())

        calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "image_to_string"
        ]
        assert calls, f"{fn} no longer calls tesseract"
        for call in calls:
            kwargs = {k.arg for k in call.keywords}
            assert "timeout" in kwargs, (
                f"{fn}: a stuck tesseract would hold this thread indefinitely"
            )

    def test_a_photo_is_downscaled_before_ocr(self):
        """Full-resolution phone photos are what push this past 30s on a Pi 4."""
        source = inspect.getsource(AttachmentService._ocr_image)
        assert "thumbnail" in source
