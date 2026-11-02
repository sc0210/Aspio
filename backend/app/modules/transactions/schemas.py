"""
Pydantic schemas for transaction endpoints in the Aspiro personal finance application.
Provides comprehensive validation and serialization for Asian market features.
"""

from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List, Dict, Any, Union
import uuid
from pydantic import BaseModel, Field, field_validator, ConfigDict

from .models import (
    TransactionType,
    TransactionWalletType,
    PaymentMethod,
    RecurringFrequency,
    CategoryType,
    TransactionStatus,
)


# Base schemas
class TimestampMixin(BaseModel):
    """Mixin for timestamp fields"""

    created_at: datetime
    updated_at: datetime


# Category schemas
class TransactionCategoryBase(BaseModel):
    """Base transaction category schema"""

    name: str = Field(..., min_length=1, max_length=100)
    name_en: Optional[str] = Field(None, max_length=100)
    name_zh: Optional[str] = Field(None, max_length=100)
    name_ms: Optional[str] = Field(None, max_length=100)
    name_th: Optional[str] = Field(None, max_length=100)
    type: CategoryType
    color: str = Field("#6B7280", pattern=r"^#[0-9A-Fa-f]{6}$")
    icon: str = Field("receipt", max_length=50)
    parent_id: Optional[str] = Field(None, max_length=36)
    description: Optional[str] = None
    keywords: Optional[List[str]] = None

    @field_validator("name", "name_en", "name_zh", "name_ms", "name_th")
    @classmethod
    def validate_category_name(cls, v):
        """Validate category names - trim whitespace, check for invalid characters"""
        if v is None:
            return v

        # Trim whitespace
        v = v.strip()

        # Check minimum length after trimming
        if len(v) < 1:
            raise ValueError("Category name cannot be empty or just whitespace")

        # Check for invalid characters (allow alphanumeric, spaces, common punctuation, and Asian characters)
        import re

        if not re.match(
            r"^[\w\s\-&\.,\'\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u0e00-\u0e7f]+$", v
        ):
            raise ValueError("Category name contains invalid characters")

        return v

    @field_validator("keywords")
    @classmethod
    def validate_keywords(cls, v):
        """Validate keywords list"""
        if v is None:
            return v

        # Limit number of keywords
        if len(v) > 50:
            raise ValueError("Maximum 50 keywords allowed per category")

        # Validate each keyword
        validated_keywords = []
        for keyword in v:
            keyword = keyword.strip()
            if len(keyword) > 0 and len(keyword) <= 100:
                validated_keywords.append(keyword)

        return validated_keywords if validated_keywords else None


class TransactionCategoryCreate(TransactionCategoryBase):
    """Schema for creating transaction categories"""

    pass


class TransactionCategoryUpdate(BaseModel):
    """Schema for updating transaction categories"""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    name_en: Optional[str] = Field(None, max_length=100)
    name_zh: Optional[str] = Field(None, max_length=100)
    name_ms: Optional[str] = Field(None, max_length=100)
    name_th: Optional[str] = Field(None, max_length=100)
    color: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    icon: Optional[str] = Field(None, max_length=50)
    parent_id: Optional[str] = Field(None, max_length=36)
    description: Optional[str] = None
    keywords: Optional[List[str]] = None
    is_active: Optional[bool] = None


class TransactionCategoryResponse(TransactionCategoryBase, TimestampMixin):
    """Schema for transaction category responses"""

    id: str
    usage_count: int
    is_default: bool
    is_active: bool
    is_system: bool
    subcategories: Optional[List["TransactionCategoryResponse"]] = None

    @field_validator("id", "parent_id", mode="before")
    @classmethod
    def serialize_uuid(cls, v):
        """Convert UUID to string"""
        if hasattr(v, "hex"):
            return str(v)
        return v

    model_config = ConfigDict(
        from_attributes=True,
        arbitrary_types_allowed=True,
    )


# Recurring transaction schemas
class RecurringTransactionBase(BaseModel):
    """Base recurring transaction schema"""

    type: TransactionType
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(..., min_length=3, max_length=3)
    category_id: str = Field(..., min_length=36, max_length=36)
    description: str = Field(..., min_length=1, max_length=500)
    payment_method: Optional[PaymentMethod] = None
    frequency: RecurringFrequency
    interval: int = Field(1, gt=0)
    start_date: date
    end_date: Optional[date] = None
    max_occurrences: Optional[int] = Field(None, gt=0)
    auto_create: bool = False
    requires_approval: bool = True
    tags: Optional[List[str]] = None
    notes: Optional[str] = Field(None, max_length=10000)

    @field_validator("end_date")
    @classmethod
    def validate_end_date(cls, v, info):
        if v and info.data.get("start_date") and v <= info.data["start_date"]:
            raise ValueError("end_date must be after start_date")
        return v


class RecurringTransactionCreate(RecurringTransactionBase):
    """Schema for creating recurring transactions"""

    pass


class RecurringTransactionUpdate(BaseModel):
    """Schema for updating recurring transactions"""

    amount: Optional[Decimal] = Field(None, gt=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    category_id: Optional[str] = Field(None, min_length=36, max_length=36)
    description: Optional[str] = Field(None, min_length=1, max_length=500)
    payment_method: Optional[PaymentMethod] = None
    frequency: Optional[RecurringFrequency] = None
    interval: Optional[int] = Field(None, gt=0)
    end_date: Optional[date] = None
    max_occurrences: Optional[int] = Field(None, gt=0)
    auto_create: Optional[bool] = None
    requires_approval: Optional[bool] = None
    is_active: Optional[bool] = None
    is_paused: Optional[bool] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = Field(None, max_length=10000)


class RecurringTransactionResponse(RecurringTransactionBase, TimestampMixin):
    """Schema for recurring transaction responses"""

    id: str
    user_id: str
    next_occurrence: date
    occurrence_count: int
    is_active: bool
    is_paused: bool
    category: Optional[TransactionCategoryResponse] = None
    model_config = ConfigDict(from_attributes=True)


# Transaction schemas
class TransactionBase(BaseModel):
    """Base transaction schema"""

    type: TransactionType
    wallet_type: Optional[TransactionWalletType] = Field(
        TransactionWalletType.LIFE,
        description="Wallet type: life or emergency",
        serialization_alias="walletType",
    )
    amount: Decimal = Field(..., gt=0)
    currency: str = Field("TWD", min_length=3, max_length=3)
    description: str = Field(..., min_length=1, max_length=500)
    transaction_date: date
    # ⚠️ Make category_id optional to support category_name fallback
    category_id: Optional[str] = Field(None, min_length=36, max_length=36)
    # ✅ Add category_name field for frontend to send category by name
    category_name: Optional[str] = Field(None, max_length=100)
    subcategory: Optional[str] = Field(None, max_length=100)
    payment_method: Optional[PaymentMethod] = None
    payment_account: Optional[str] = Field(None, max_length=100)
    merchant_name: Optional[str] = Field(None, max_length=200)
    location: Optional[str] = Field(None, max_length=500)
    latitude: Optional[Decimal] = Field(None, ge=-90, le=90)
    longitude: Optional[Decimal] = Field(None, ge=-180, le=180)
    reference_id: Optional[str] = Field(None, max_length=100)
    tags: Optional[List[str]] = None
    notes: Optional[str] = Field(None, max_length=10000)
    tax_deductible: bool = False
    business_expense: bool = False

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        if v and len(v) > 20:
            raise ValueError("Maximum 20 tags allowed")
        return v


class TransactionCreate(TransactionBase):
    """Schema for creating transactions"""

    recurring_transaction_id: Optional[str] = Field(None, min_length=36, max_length=36)
    qr_payment_data: Optional[Dict[str, Any]] = None
    loan_id: Optional[str] = Field(
        None,
        min_length=36,
        max_length=36,
        description="Link this expense to a loan; the loan balance will be reduced automatically",
    )
    principal_portion: Optional[Decimal] = Field(
        None,
        gt=0,
        description="Portion that reduces the loan principal; defaults to the full amount",
    )


class TransactionUpdate(BaseModel):
    """Schema for updating transactions"""

    wallet_type: Optional[TransactionWalletType] = Field(
        None,
        description="Wallet type: life or emergency",
        serialization_alias="walletType",
    )
    amount: Optional[Decimal] = Field(None, gt=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    description: Optional[str] = Field(None, min_length=1, max_length=500)
    transaction_date: Optional[date] = None
    category_id: Optional[str] = Field(None, min_length=36, max_length=36)
    # ✅ Add category_name for update operations (same as create)
    category_name: Optional[str] = Field(None, max_length=100)
    subcategory: Optional[str] = Field(None, max_length=100)
    payment_method: Optional[PaymentMethod] = None
    payment_account: Optional[str] = Field(None, max_length=100)
    merchant_name: Optional[str] = Field(None, max_length=200)
    location: Optional[str] = Field(None, max_length=500)
    latitude: Optional[Decimal] = Field(None, ge=-90, le=90)
    longitude: Optional[Decimal] = Field(None, ge=-180, le=180)
    reference_id: Optional[str] = Field(None, max_length=100)
    tags: Optional[List[str]] = None
    notes: Optional[str] = Field(None, max_length=10000)
    tax_deductible: Optional[bool] = None
    business_expense: Optional[bool] = None
    reviewed_by_user: Optional[bool] = None
    # Link/unlink this expense to a loan. Changing it (or the amount) re-syncs the
    # loan balance in update_transaction. Empty string is treated as "unlink".
    loan_id: Optional[str] = Field(
        None,
        max_length=36,
        description="Link this expense to a loan (reduces its balance); '' unlinks and restores it",
    )

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        if v and len(v) > 20:
            raise ValueError("Maximum 20 tags allowed")
        return v


class TransactionResponse(TransactionBase, TimestampMixin):
    """Schema for transaction responses"""

    id: str
    user_id: str
    amount_usd: Optional[Decimal] = None
    exchange_rate: Optional[Decimal] = None
    status: TransactionStatus
    processed_at: Optional[datetime] = None
    auto_categorized: bool
    categorization_confidence: Optional[Decimal] = None
    reviewed_by_user: bool
    import_source: Optional[str] = None
    import_batch_id: Optional[str] = None
    qr_payment_data: Optional[Dict[str, Any]] = None
    receipt_url: Optional[str] = None
    receipt_data: Optional[Dict[str, Any]] = None
    category_obj: Optional[TransactionCategoryResponse] = None
    recurring_transaction_id: Optional[str] = None
    transfer_group_id: Optional[str] = Field(
        None,
        description="Links both legs of a wallet transfer; null for regular income/expense rows",
    )
    loan_id: Optional[str] = Field(
        None,
        description="The loan this expense is applied to (reduces its balance); null otherwise",
    )
    holding_id: Optional[str] = Field(
        None,
        description="The portfolio holding this row is the cash leg of; null otherwise",
    )
    holding_sole_purchase: Optional[bool] = Field(
        None,
        description=(
            "Single-transaction reads only: true when this row is its holding's only "
            "purchase leg, so editing the holding rewrites it; null when unlinked"
        ),
    )

    @field_validator(
        "id",
        "user_id",
        "category_id",
        "recurring_transaction_id",
        "transfer_group_id",
        "loan_id",
        "holding_id",
        mode="before",
    )
    @classmethod
    def serialize_uuid(cls, v):
        """Convert UUID to string"""
        if hasattr(v, "hex"):
            return str(v)
        return v

    model_config = ConfigDict(from_attributes=True, ser_json_by_alias=True)


# Bulk operations
class DayOrderRequest(BaseModel):
    """The rows of one day in the order the user dragged them into (#478).

    `ids` may be all of the day or only the rows the client could see; the rest
    keep their places (see TransactionRepository.set_day_order).
    """

    date: date
    ids: List[str] = Field(..., min_length=1, max_length=500)


class DayOrderResponse(BaseModel):
    date: date
    # The whole day in its new order, including rows the request did not name.
    ids: List[str]


class BulkTransactionCreate(BaseModel):
    """Schema for bulk transaction creation"""

    transactions: List[TransactionCreate] = Field(..., max_length=1000)
    skip_duplicates: bool = True
    auto_categorize: bool = True


class BulkTransactionResponse(BaseModel):
    """Schema for bulk transaction operation results"""

    total_requested: int
    successful: int
    failed: int
    skipped: int
    created_transactions: List[TransactionResponse]
    errors: List[Dict[str, Any]]


# Search and filtering schemas
class TransactionFilter(BaseModel):
    """Schema for transaction filtering"""

    type: Optional[TransactionType] = None
    category_ids: Optional[List[str]] = Field(None, max_length=50)
    payment_methods: Optional[List[PaymentMethod]] = Field(None, max_length=20)
    currencies: Optional[List[str]] = Field(None, max_length=10)
    wallet_type: Optional[TransactionWalletType] = None
    status: Optional[TransactionStatus] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    amount_min: Optional[Decimal] = Field(None, ge=0)
    amount_max: Optional[Decimal] = Field(None, ge=0)
    merchant_name: Optional[str] = Field(None, max_length=200)
    location: Optional[str] = Field(None, max_length=500)
    tags: Optional[List[str]] = Field(None, max_length=10)
    auto_categorized: Optional[bool] = None
    reviewed_by_user: Optional[bool] = None
    has_attachments: Optional[bool] = None
    is_recurring: Optional[bool] = None
    search: Optional[str] = Field(None, max_length=200)
    exclude_transfers: bool = Field(
        False,
        description=(
            "Leave both legs of a wallet transfer out. A transfer is one move stored "
            "as a matching income and expense row, so counting it inflates the income "
            "and spending totals by the same amount while the net stays right."
        ),
    )

    @field_validator("date_to")
    @classmethod
    def validate_date_range(cls, v, info):
        if v and info.data.get("date_from") and v < info.data["date_from"]:
            raise ValueError("date_to must be after date_from")
        return v

    @field_validator("amount_max")
    @classmethod
    def validate_amount_range(cls, v, info):
        if v and info.data.get("amount_min") and v < info.data["amount_min"]:
            raise ValueError("amount_max must be greater than amount_min")
        return v


# Analytics schemas
class TransactionSummary(BaseModel):
    """Schema for transaction summary analytics"""

    total_income: Decimal
    total_expenses: Decimal
    net_amount: Decimal
    transaction_count: int
    period_start: date
    period_end: date
    currency: str


class CategorySpending(BaseModel):
    """Schema for category-wise spending analytics"""

    category_id: str
    category_name: str
    category_type: CategoryType
    amount: Decimal
    percentage: Decimal
    transaction_count: int
    currency: str


class MonthlyTrend(BaseModel):
    """Schema for monthly spending trends"""

    month: str  # YYYY-MM format
    income: Decimal
    expenses: Decimal
    net_amount: Decimal
    transaction_count: int


class PaymentMethodAnalytics(BaseModel):
    """Schema for payment method usage analytics"""

    payment_method: PaymentMethod
    amount: Decimal
    percentage: Decimal
    transaction_count: int


class TransactionAnalytics(BaseModel):
    """Schema for comprehensive transaction analytics"""

    summary: TransactionSummary
    category_breakdown: List[CategorySpending]
    monthly_trends: List[MonthlyTrend]
    payment_method_breakdown: List[PaymentMethodAnalytics]
    top_merchants: List[Dict[str, Union[str, Decimal, int]]]
    currency_breakdown: List[Dict[str, Union[str, Decimal, int]]]


# QR Payment specific schemas
class QRPaymentData(BaseModel):
    """Schema for QR payment data"""

    qr_code: str = Field(..., max_length=500)
    payment_provider: PaymentMethod = Field(..., alias="payment_method")
    merchant_id: Optional[str] = Field(None, max_length=100)
    merchant_name: Optional[str] = Field(None, max_length=200)
    terminal_id: Optional[str] = Field(None, max_length=50)
    transaction_ref: Optional[str] = Field(None, max_length=100)

    model_config = ConfigDict(populate_by_name=True)


class QRPaymentTransaction(TransactionCreate):
    """Schema for QR payment transactions"""

    qr_payment_data: QRPaymentData


# Attachment schemas
class TransactionAttachmentBase(BaseModel):
    """Base transaction attachment schema"""

    filename: str = Field(..., max_length=255)
    file_size: int = Field(..., gt=0)
    mime_type: str = Field(..., max_length=100)
    is_receipt: bool = True


class TransactionAttachmentResponse(TransactionAttachmentBase, TimestampMixin):
    """Schema for transaction attachment responses"""

    # UUIDs, as the model stores them (str rejected every row); JSON is unchanged.
    id: uuid.UUID
    transaction_id: uuid.UUID
    original_filename: str
    file_path: str
    storage_provider: str
    ocr_text: Optional[str] = None
    processed: bool
    processing_error: Optional[str] = None
    uploaded_by: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


# Categorization schemas
class CategorizationSuggestion(BaseModel):
    """Schema for automatic categorization suggestions"""

    category_id: uuid.UUID
    category_name: str
    confidence: Decimal = Field(..., ge=0, le=1)
    reasons: List[str]


class AutoCategorizationRequest(BaseModel):
    """Schema for auto-categorization requests"""

    description: str = Field(..., min_length=1, max_length=500)
    amount: Optional[Decimal] = Field(None, gt=0)
    merchant_name: Optional[str] = Field(None, max_length=200)
    payment_method: Optional[PaymentMethod] = None


class AutoCategorizationResponse(BaseModel):
    """Schema for auto-categorization responses"""

    suggestions: List[CategorizationSuggestion]
    primary_suggestion: Optional[CategorizationSuggestion] = None


# Update TransactionCategoryResponse to handle circular reference
TransactionCategoryResponse.model_rebuild()
