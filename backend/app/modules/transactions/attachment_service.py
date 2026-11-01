"""
Attachment service for transaction receipts and documents in the Aspiro personal finance application.
Handles file upload, storage and attachment management. OCR lives behind
POST /scan-receipt (`scan_receipt`), which returns a parse for the user to
confirm — uploading a file never writes extracted data to a transaction.
"""

import asyncio
import re
import uuid
from datetime import date as date_cls, datetime, timezone
from decimal import Decimal
from typing import Optional, List, Dict, Any
from pathlib import Path
import logging
import aiofiles
import aiofiles.os
from fastapi import UploadFile, HTTPException

from .repositories import TransactionRepository
from .models import TransactionAttachment
from .schemas import TransactionAttachmentResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

# Receipt OCR: US Letter at 300 DPI is about 8.4M pixels.
MAX_PDF_PIXELS = 12_000_000
MIN_PDF_DPI = 72
# A 48MP phone photo is ~48M pixels; past that a few KB of PNG can decode to
# hundreds of MB. Checked from the header, before any pixel is decoded.
MAX_RECEIPT_IMAGE_PIXELS = 40_000_000


class ReceiptImageTooLargeError(Exception):
    """The image declares more pixels than a receipt scan will decode."""

# CSV import bounds. Bytes reuse the attachment limit; failed rows are counted
# but only the first few are kept, without their contents.
MAX_IMPORT_ROWS = 5000
MAX_IMPORT_ERRORS = 100

logger = logging.getLogger(__name__)


class AttachmentService:
    """Service for handling transaction attachments"""
    
    def __init__(self, db: AsyncSession, transaction_repo: TransactionRepository):
        self.db = db
        self.transaction_repo = transaction_repo
        self.upload_path = Path(get_settings().UPLOAD_PATH)
        # MAX_FILE_SIZE_MB, as the env samples document (was an undocumented MAX_FILE_SIZE).
        self.max_file_size = get_settings().max_file_size_bytes
        self.allowed_mime_types = {
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'text/plain', 'text/csv'
        }
        
        # Ensure upload directory exists
        self.upload_path.mkdir(parents=True, exist_ok=True)

    async def upload_attachment(
        self,
        transaction_id: str,
        user_id: str,
        file: UploadFile,
        is_receipt: bool = True
    ) -> TransactionAttachmentResponse:
        """Store a transaction attachment. Does not read it — see scan_receipt."""
        
        # Verify transaction exists and belongs to user
        transaction = await self.transaction_repo.get_by_id(transaction_id, user_id)
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        # Validate file
        await self._validate_file(file)
        
        # Generate unique filename
        file_ext = Path(file.filename or '').suffix
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        # str(): callers pass the user's UUID, and Path / UUID is a TypeError.
        file_path = self.upload_path / str(user_id) / unique_filename
        
        # Ensure user directory exists
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Save file
        await self._save_file(file, file_path)
        
        # Create attachment record
        attachment_data = {
            'transaction_id': transaction.id,
            'filename': unique_filename,
            'original_filename': file.filename or 'unknown',
            'file_size': file.size or 0,
            'mime_type': file.content_type or 'application/octet-stream',
            'file_path': str(file_path),
            'storage_provider': 'local',
            'uploaded_by': user_id,
            'is_receipt': is_receipt,
            'processed': False
        }
        
        attachment = TransactionAttachment(**attachment_data)
        self.db.add(attachment)
        await self.db.commit()
        await self.db.refresh(attachment)
        
        # Deliberately no processing here. This used to run a placeholder that
        # stamped "Sample Store" onto the user's transaction, and then, briefly, real
        # tesseract OCR on the request path of a Pi 4 with no timeout. The attachment
        # stays `processed=False`, which is honest: nothing has read it. Extraction is
        # POST /scan-receipt, which returns the parse for the user to confirm.

        logger.info(f"Attachment uploaded: {attachment.id} for transaction: {transaction_id}")
        
        return TransactionAttachmentResponse.model_validate(attachment)

    async def get_attachments(self, transaction_id: str, user_id: str) -> List[TransactionAttachmentResponse]:
        """Get all attachments for a transaction"""
        
        # Verify transaction exists and belongs to user
        transaction = await self.transaction_repo.get_by_id(transaction_id, user_id)
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        # Query attachments
        from sqlalchemy import select
        stmt = select(TransactionAttachment).where(
            TransactionAttachment.transaction_id == transaction.id
        ).order_by(TransactionAttachment.created_at.desc(), TransactionAttachment.id.desc())
        
        result = await self.db.execute(stmt)
        attachments = result.scalars().all()
        
        return [TransactionAttachmentResponse.model_validate(att) for att in attachments]

    async def delete_attachment(self, attachment_id: str, user_id: str) -> bool:
        """Delete an attachment"""
        
        # Get attachment
        from sqlalchemy import select, and_
        try:
            attachment_uuid = uuid.UUID(str(attachment_id))
        except ValueError:
            return False
        stmt = select(TransactionAttachment).where(
            and_(
                TransactionAttachment.id == attachment_uuid,
                TransactionAttachment.uploaded_by == user_id
            )
        )
        
        result = await self.db.execute(stmt)
        attachment = result.scalar_one_or_none()
        
        if not attachment:
            return False
        
        # Delete physical file
        try:
            file_path = Path(attachment.file_path)
            if file_path.exists():
                await aiofiles.os.remove(file_path)
        except Exception as e:
            logger.error(f"Failed to delete file {attachment.file_path}: {str(e)}")
        
        # Delete database record
        await self.db.delete(attachment)
        await self.db.commit()
        
        logger.info(f"Attachment deleted: {attachment_id}")
        
        return True

    async def scan_receipt(self, file: UploadFile, user_id: str) -> Dict[str, Any]:
        """Scan a receipt file and extract transaction data"""
        
        # Validate file
        await self._validate_file(file)
        
        # Generate temporary filename for processing
        file_ext = Path(file.filename or '').suffix
        temp_filename = f"receipt_{uuid.uuid4()}{file_ext}"
        temp_path = self.upload_path / "temp" / temp_filename
        
        # Ensure temp directory exists
        temp_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            # Save file temporarily
            await self._save_file(file, temp_path)
            
            # Process receipt using OCR
            receipt_data = await self._extract_receipt_data(temp_path, file.content_type or 'application/octet-stream')
            
            logger.info(f"Receipt scanned successfully: {file.filename}")
            
            return receipt_data
            
        finally:
            # Clean up temporary file
            try:
                if temp_path.exists():
                    await aiofiles.os.remove(temp_path)
            except Exception as e:
                logger.error(f"Failed to clean up temp file {temp_path}: {str(e)}")

    async def _extract_receipt_data(self, file_path: Path, mime_type: str) -> Dict[str, Any]:
        """Extract structured data from receipt image/PDF"""
        
        # Dispatch by mime type. tesseract does the reading (see _ocr_image
        # and _ocr_pdf); it is installed by backend/Dockerfile, chi_tra included.
        try:
            if mime_type.startswith('image/'):
                return await self._extract_from_image(file_path)
            elif mime_type == 'application/pdf':
                return await self._extract_from_pdf(file_path)
            else:
                raise ValueError(f"Unsupported file type: {mime_type}")

        except (NotImplementedError, TimeoutError, ReceiptImageTooLargeError):
            # All must reach the router. NotImplementedError becomes a 501: folding
            # it into the generic handler below would report "scan failed", implying
            # a transient problem worth retrying when no provider exists at all.
            # TimeoutError becomes a 504, which is retryable and actionable, and an
            # oversized image a 413 the user can fix with a smaller photo.
            raise
        except Exception as e:
            logger.error(f"Receipt data extraction failed: {str(e)}")
            return {
                "amount": None,
                "merchant_name": None,
                "date": None,
                "description": "Receipt scan failed",
                "category": None,
                "confidence": 0.0,
                "error": str(e)
            }

    async def _extract_from_image(self, file_path: Path) -> Dict[str, Any]:
        """OCR a receipt image with the locally installed tesseract."""
        text = await asyncio.to_thread(self._ocr_image, file_path)
        return self._parse_receipt_text(text)

    async def _extract_from_pdf(self, file_path: Path) -> Dict[str, Any]:
        """Rasterise the first page of a PDF receipt, then OCR it."""
        text = await asyncio.to_thread(self._ocr_pdf, file_path)
        return self._parse_receipt_text(text)

    # --- OCR plumbing -----------------------------------------------------

    def _ocr_image(self, file_path: Path) -> str:
        """Blocking: read one image through tesseract. Call via to_thread.

        chi_tra first, then eng — the app is zh-TW, and tesseract weights the
        earlier language when a glyph is ambiguous between scripts.
        """
        import pytesseract
        from PIL import Image

        try:
            with Image.open(file_path) as img:
                # Image.open reads only the header. Pillow's own bomb check warns
                # from 89M pixels and refuses only past 179M.
                if img.width * img.height > MAX_RECEIPT_IMAGE_PIXELS:
                    raise ReceiptImageTooLargeError(f"{img.width}x{img.height}")
                # Receipts are thermal prints: greyscale reads more reliably
                # than colour, and costs nothing to convert.
                # Downscale first: a full-resolution phone photo is what pushes
                # this past 30s on a Pi 4, and tesseract reads no better for the
                # extra pixels. timeout so a stuck binary cannot hold the thread.
                img.thumbnail((2000, 2000))
                return pytesseract.image_to_string(
                    img.convert("L"), lang="chi_tra+eng", timeout=30
                )
        except pytesseract.TesseractNotFoundError as exc:
            # The binary is installed by the Dockerfile. If it is missing the
            # deployment is wrong, and that must not look like an unreadable
            # receipt — surface it as "not available" instead.
            raise NotImplementedError(
                "tesseract binary is not installed in this image"
            ) from exc
        except RuntimeError as exc:
            # Same reasoning as _ocr_pdf: pytesseract reports its own timeout as a
            # bare RuntimeError, which the generic handler would turn into an empty
            # parse the user reads as "nothing on this receipt".
            if "timeout" in str(exc).lower():
                raise TimeoutError("OCR timed out") from exc
            raise

    def _ocr_pdf(self, file_path: Path) -> str:
        """Blocking: first page of a PDF through tesseract. Call via to_thread.

        Only the first page: a receipt is one page, and rasterising an
        arbitrarily long PDF at 300 DPI is an easy way to exhaust memory on a
        small host.
        """
        import pytesseract
        from pdf2image import convert_from_path, pdfinfo_from_path

        # The page size comes from the PDF itself, so a few hundred bytes can
        # declare a page that rasterises to gigabytes at 300 DPI. Read it first
        # and lower the DPI until width x height fits a fixed pixel budget; a
        # page too large even for MIN_PDF_DPI is not a receipt.
        try:
            info = pdfinfo_from_path(str(file_path), first_page=1, last_page=1, timeout=10)
            w_pt, h_pt = (float(v) for v in info["Page size"].split(" pts")[0].split(" x "))
        except Exception as exc:
            logger.warning("PDF inspection failed for %s: %s", file_path, exc)
            return ""
        if w_pt <= 0 or h_pt <= 0:
            return ""
        area_in2 = (w_pt / 72.0) * (h_pt / 72.0)
        dpi = min(300, int((MAX_PDF_PIXELS / area_in2) ** 0.5))
        if dpi < MIN_PDF_DPI:
            logger.warning("PDF page too large to OCR (%.0f x %.0f pt): %s", w_pt, h_pt, file_path)
            return ""

        try:
            pages = convert_from_path(
                str(file_path), dpi=dpi, first_page=1, last_page=1, timeout=30
            )
        except Exception as exc:
            logger.warning("PDF rasterisation failed for %s: %s", file_path, exc)
            return ""

        if not pages:
            return ""
        try:
            # timeout: as above — a stuck tesseract must not hold the thread.
            return pytesseract.image_to_string(
                pages[0].convert("L"), lang="chi_tra+eng", timeout=30
            )
        except pytesseract.TesseractNotFoundError as exc:
            raise NotImplementedError(
                "tesseract binary is not installed in this image"
            ) from exc
        except RuntimeError as exc:
            # pytesseract signals its own timeout as a bare RuntimeError. Left to the
            # generic handler it becomes confidence 0.0 and empty fields — which the
            # user reads as "nothing on this receipt", with no hint to try a smaller
            # photo. Re-raised as TimeoutError so the router can say so.
            if "timeout" in str(exc).lower():
                raise TimeoutError("OCR timed out") from exc
            raise

    # --- Text -> fields ---------------------------------------------------

    # Lines naming the payable total. Ordered by how strongly each implies the
    # final figure rather than a subtotal or an item price.
    _TOTAL_KEYWORDS = (
        "應付金額", "應收金額", "總金額", "總計", "合計", "小計",
        "grand total", "total amount", "amount due", "total", "金額",
    )
    # 1,234 / 1234.50 / $1,234
    _MONEY = re.compile(r"(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d])")

    def _parse_receipt_text(self, text: str) -> Dict[str, Any]:
        """Pull amount / merchant / date out of raw OCR text.

        Conservative on purpose. The caller pre-fills a money field from this,
        so a wrong number is worse than no number: the amount is only reported
        when a line actually names a total. Everything unfound stays None and
        the frontend falls back to manual entry.
        """
        if not text or not text.strip():
            return self._empty_receipt("No text could be read from this file")

        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        amount = self._find_total(lines)
        txn_date = self._find_date(text)
        merchant = self._find_merchant(lines)

        # Confidence describes how much was recovered, not how sure tesseract
        # was about the glyphs. The amount dominates because it is the only
        # field a user cannot easily eyeball on the photo.
        found = sum((amount is not None, txn_date is not None, merchant is not None))
        confidence = round({0: 0.0, 1: 0.35, 2: 0.6, 3: 0.85}[found], 2)

        return {
            "amount": amount,
            "merchant_name": merchant,
            "date": txn_date,
            "description": f"Receipt from {merchant}" if merchant else None,
            "category": None,  # never guessed — the user picks
            "confidence": confidence,
            "raw_text": text[:2000],
            "extracted_items": [],
        }

    def _empty_receipt(self, message: str) -> Dict[str, Any]:
        return {
            "amount": None,
            "merchant_name": None,
            "date": None,
            "description": None,
            "category": None,
            "confidence": 0.0,
            "raw_text": "",
            "extracted_items": [],
            "message": message,
        }

    def _money_on(self, line: str) -> List[float]:
        out = []
        for whole, frac in self._MONEY.findall(line):
            try:
                out.append(float(f"{whole.replace(',', '')}.{frac or '0'}"))
            except ValueError:
                continue
        return out

    def _find_total(self, lines: List[str]) -> Optional[float]:
        """The largest number on a line that names a total.

        Largest because receipts routinely print subtotal, tax and total in one
        block; the payable figure is the biggest of them. Lines that name no
        total are ignored entirely rather than mined for the largest number on
        the receipt — that would happily return a barcode or a phone number.
        """
        candidates: List[float] = []
        for line in lines:
            lowered = line.lower()
            if any(k in lowered for k in self._TOTAL_KEYWORDS):
                candidates.extend(v for v in self._money_on(line) if v > 0)
        return max(candidates) if candidates else None

    def _find_date(self, text: str) -> Optional[str]:
        """First plausible date, normalised to ISO. Handles ROC years."""
        # 2026-08-15 / 2026/8/15
        m = re.search(r"(20\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})", text)
        if m:
            y, mo, d = (int(g) for g in m.groups())
            return self._iso(y, mo, d)

        # Republic-of-China year: 115/08/15 -> 2026-08-15. Bounded to 100-199
        # so it cannot swallow a 3-digit item code.
        m = re.search(r"(?<!\d)(1\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})(?!\d)", text)
        if m:
            roc, mo, d = (int(g) for g in m.groups())
            return self._iso(roc + 1911, mo, d)
        return None

    @staticmethod
    def _iso(year: int, month: int, day: int) -> Optional[str]:
        try:
            return date_cls(year, month, day).isoformat()
        except ValueError:
            return None

    def _find_merchant(self, lines: List[str]) -> Optional[str]:
        """Best guess at the shop name: the first line that reads like one.

        Receipts put the merchant at the top, so only the first few lines are
        considered — searching the whole receipt tends to surface an address or
        an item instead.
        """
        for line in lines[:5]:
            if len(line) < 2 or len(line) > 40:
                continue
            # Skip lines that are mostly digits/punctuation (dates, tax ids,
            # phone numbers, barcodes).
            letters = sum(ch.isalpha() or "一" <= ch <= "鿿" for ch in line)
            if letters >= max(2, len(line) // 2):
                return line
        return None

    async def _validate_file(self, file: UploadFile):
        """Validate uploaded file"""
        
        # Check file size
        if file.size and file.size > self.max_file_size:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {self.max_file_size // (1024*1024)}MB"
            )
        
        # Check mime type
        if file.content_type not in self.allowed_mime_types:
            raise HTTPException(
                status_code=400,
                detail=f"File type {file.content_type} not allowed"
            )
        
        # Check filename
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required")

    async def _save_file(self, file: UploadFile, file_path: Path):
        """Save uploaded file to disk"""
        
        try:
            async with aiofiles.open(file_path, 'wb') as f:
                content = await file.read()
                await f.write(content)
        except Exception as e:
            logger.error(f"Failed to save file {file_path}: {str(e)}")
            raise HTTPException(status_code=500, detail="Failed to save file")

class ImportExportService:
    """Service for importing and exporting transaction data"""
    
    def __init__(self, db: AsyncSession, transaction_service):
        self.db = db
        self.transaction_service = transaction_service

    async def import_csv(
        self,
        user_id: str,
        file: UploadFile,
        import_settings: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Import transactions from CSV file"""
        
        import csv
        from io import StringIO
        from .models import TransactionImportBatch
        from .schemas import TransactionCreate, BulkTransactionCreate

        max_bytes = get_settings().max_file_size_bytes
        content = await file.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise HTTPException(status_code=413, detail="File too large")
        try:
            rows = list(csv.DictReader(StringIO(content.decode('utf-8'))))
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="CSV must be UTF-8")
        if len(rows) > MAX_IMPORT_ROWS:
            raise HTTPException(status_code=413, detail=f"Too many rows (max {MAX_IMPORT_ROWS})")

        # Create import batch
        batch = TransactionImportBatch(
            user_id=user_id,
            source='csv',
            filename=file.filename,
            status='processing',
            import_settings=import_settings,
            processing_started_at=datetime.now(timezone.utc)
        )
        
        self.db.add(batch)
        await self.db.commit()
        await self.db.refresh(batch)
        
        try:
            # Parse transactions
            transactions = []
            errors = []
            failed_rows = 0
            row_number = 1

            for row in rows:
                row_number += 1
                try:
                    transaction_data = self._parse_csv_row(row, import_settings)
                    transactions.append(TransactionCreate(**transaction_data))
                except Exception as e:
                    # Count every failure, keep a few: the list is persisted, and
                    # storing each bad row verbatim grew the database ~5x the upload.
                    failed_rows += 1
                    if len(errors) < MAX_IMPORT_ERRORS:
                        errors.append({'row': row_number, 'error': str(e)[:200]})

            # Update batch statistics
            batch.total_records = len(transactions) + failed_rows
            batch.processed_records = len(transactions)
            
            # Bulk create transactions
            if transactions:
                bulk_data = BulkTransactionCreate(
                    transactions=transactions,
                    skip_duplicates=import_settings.get('skip_duplicates', True),
                    auto_categorize=import_settings.get('auto_categorize', True)
                )
                
                result = await self.transaction_service.bulk_create_transactions(bulk_data, user_id)
                batch.successful_imports = result.successful
                batch.failed_imports = result.failed
                errors.extend(result.errors[: max(0, MAX_IMPORT_ERRORS - len(errors))])
            
            # Finalize batch
            batch.status = 'completed'
            batch.errors = errors
            batch.processing_completed_at = datetime.now(timezone.utc)
            
            await self.db.commit()
            
            return {
                'batch_id': batch.id,
                'total_records': batch.total_records,
                'successful': batch.successful_imports,
                'failed': batch.failed_imports,
                'errors': errors[:10]  # Return first 10 errors
            }
            
        except Exception as e:
            batch.status = 'failed'
            batch.errors = [{'error': str(e)}]
            batch.processing_completed_at = datetime.now(timezone.utc)
            await self.db.commit()
            
            logger.error(f"CSV import failed for batch {batch.id}: {str(e)}")
            raise HTTPException(status_code=500, detail="Import failed")

    def _parse_csv_row(self, row: Dict[str, str], settings: Dict[str, Any]) -> Dict[str, Any]:
        """Parse a CSV row into transaction data"""
        
        # Get column mappings from settings
        mappings = settings.get('column_mappings', {})
        
        # Default column mappings
        default_mappings = {
            'date': ['date', 'transaction_date', 'Date'],
            'amount': ['amount', 'Amount'],
            'description': ['description', 'Description', 'memo', 'Memo'],
            'type': ['type', 'Type'],
            'category': ['category', 'Category'],
            'merchant': ['merchant', 'Merchant', 'payee', 'Payee'],
            'currency': ['currency', 'Currency'],
        }
        
        # Find values using mappings
        def find_value(field_name: str) -> Optional[str]:
            # Try custom mapping first
            if field_name in mappings:
                return row.get(mappings[field_name])
            
            # Try default mappings
            for possible_column in default_mappings.get(field_name, []):
                if possible_column in row:
                    return row[possible_column]
            
            return None
        
        # Parse transaction data
        from datetime import datetime as dt
        from decimal import Decimal
        
        date_str = find_value('date')
        if not date_str:
            raise ValueError("Date field is required")
        
        # Parse date
        date_formats = ['%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y', '%Y-%m-%d %H:%M:%S']
        transaction_date = None
        
        for fmt in date_formats:
            try:
                transaction_date = dt.strptime(date_str, fmt).date()
                break
            except ValueError:
                continue
        
        if not transaction_date:
            raise ValueError(f"Could not parse date: {date_str}")
        
        # Parse amount
        amount_str = find_value('amount')
        if not amount_str:
            raise ValueError("Amount field is required")
        
        # Clean amount (remove currency symbols, commas)
        amount_clean = amount_str.replace('$', '').replace(',', '').replace(' ', '')
        
        try:
            amount = Decimal(amount_clean)
        except Exception:
            raise ValueError(f"Could not parse amount: {amount_str}")
        
        # Determine transaction type. TransactionCreate validates this against
        # TransactionType's *values* ('income'/'expense'), not the Python
        # enum member names — uppercase here made every single row fail
        # validation and get silently dropped into the batch's error list.
        type_str = find_value('type')
        if type_str:
            if type_str.lower() in ['income', 'credit', 'deposit']:
                transaction_type = 'income'
            else:
                transaction_type = 'expense'
        else:
            # Infer from amount (negative = expense)
            transaction_type = 'expense' if amount < 0 else 'income'
            amount = abs(amount)
        
        # A per-row Currency column (e.g. from a file this app itself
        # exported) always wins; default_currency is only the fallback for
        # rows/files that don't have one.
        currency_str = find_value('currency')
        currency = currency_str.strip().upper() if currency_str else settings.get('default_currency', 'TWD')

        # A per-row Category column (name, not id — e.g. "Shopping" from a
        # file this app itself exported) resolves via the same category_name
        # fallback create_transaction already uses; default_category_id is
        # only used when the row has no category at all. Previously neither
        # was ever read, so every imported row failed with "Unable to
        # determine transaction category".
        category_str = find_value('category')

        # Build transaction data
        transaction_data = {
            'type': transaction_type,
            'amount': amount,
            'currency': currency,
            'description': find_value('description') or 'Imported transaction',
            'transaction_date': transaction_date,
            'category_id': None if category_str else settings.get('default_category_id'),
            'category_name': category_str or None,
            'merchant_name': find_value('merchant'),
            'import_source': 'csv'
        }
        
        return transaction_data

    async def export_csv(
        self,
        user_id: str,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None
    ) -> str:
        """Export transactions to CSV format"""
        
        import csv
        from io import StringIO
        from .schemas import TransactionFilter
        
        # Get transactions
        filter_params = TransactionFilter(
            date_from=date_from.date() if date_from else None,
            date_to=date_to.date() if date_to else None
        )
        
        transactions, _ = await self.transaction_service.transaction_repo.get_all(
            user_id=user_id,
            filter_params=filter_params,
            limit=10000  # Large limit for export
        )
        
        # Generate CSV
        output = StringIO()
        writer = csv.writer(output)
        
        # Write headers
        headers = [
            'Date', 'Type', 'Amount', 'Currency', 'Description',
            'Category', 'Merchant', 'Payment Method', 'Tags', 'Notes'
        ]
        writer.writerow(headers)
        
        # Write data
        for transaction in transactions:
            writer.writerow([
                transaction.transaction_date.strftime('%Y-%m-%d'),
                transaction.type.value,
                str(transaction.amount),
                transaction.currency,
                transaction.description,
                transaction.category_obj.name if transaction.category_obj else '',
                transaction.merchant_name or '',
                transaction.payment_method.value if transaction.payment_method else '',
                ','.join(transaction.tags) if transaction.tags else '',
                transaction.notes or ''
            ])
        
        return output.getvalue()

    async def export_excel(
        self,
        user_id: str,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> bytes:
        """Export transactions to Excel (.xlsx) format using openpyxl."""
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment
        from io import BytesIO
        from .schemas import TransactionFilter

        filter_params = TransactionFilter(
            date_from=date_from.date() if date_from else None,
            date_to=date_to.date() if date_to else None,
        )
        transactions, _ = await self.transaction_service.transaction_repo.get_all(
            user_id=user_id,
            filter_params=filter_params,
            limit=10000,
        )

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Transactions"

        headers = [
            "Date", "Type", "Amount", "Currency", "Description",
            "Category", "Merchant", "Payment Method", "Tags", "Notes",
        ]

        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(fill_type="solid", fgColor="4472C4")
        for col, header in enumerate(headers, start=1):
            cell = ws.cell(row=1, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")

        for row_idx, txn in enumerate(transactions, start=2):
            ws.cell(row=row_idx, column=1, value=txn.transaction_date.strftime("%Y-%m-%d"))
            ws.cell(row=row_idx, column=2, value=txn.type.value)
            ws.cell(row=row_idx, column=3, value=float(txn.amount))
            ws.cell(row=row_idx, column=4, value=txn.currency)
            ws.cell(row=row_idx, column=5, value=txn.description)
            ws.cell(row=row_idx, column=6, value=txn.category_obj.name if txn.category_obj else "")
            ws.cell(row=row_idx, column=7, value=txn.merchant_name or "")
            ws.cell(row=row_idx, column=8, value=txn.payment_method.value if txn.payment_method else "")
            ws.cell(row=row_idx, column=9, value=",".join(txn.tags) if txn.tags else "")
            ws.cell(row=row_idx, column=10, value=txn.notes or "")

        # Auto-fit column widths
        for col in ws.columns:
            max_len = max((len(str(c.value)) for c in col if c.value), default=10)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 40)

        buf = BytesIO()
        wb.save(buf)
        return buf.getvalue()