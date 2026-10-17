"""
Transaction models using SQLAlchemy 2.0 for the Aspiro personal finance application.
Supports Asian payment methods, multi-currency, and comprehensive transaction tracking.
"""

from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List, Dict, Any
from sqlalchemy import (
    String,
    Text,
    Numeric,
    DateTime,
    Date,
    Boolean,
    Integer,
    ForeignKey,
    Index,
    CheckConstraint,
    JSON,
    Enum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID
import enum
import uuid

from app.database.base import BaseModel


class TransactionType(str, enum.Enum):
    """Transaction type enumeration"""

    INCOME = "income"
    EXPENSE = "expense"
    TRANSFER = "transfer"  # Wallet-to-wallet transfers


class TransactionWalletType(str, enum.Enum):
    """Wallet type for transactions"""

    LIFE = "life"  # Daily living expenses and income
    EMERGENCY = "emergency"  # Emergency fund deposits/withdrawals


class PaymentMethod(str, enum.Enum):
    """Asian-focused payment methods"""

    CASH = "cash"
    CREDIT_CARD = "credit_card"
    DEBIT_CARD = "debit_card"
    BANK_TRANSFER = "bank_transfer"

    # QR-based payments
    WECHAT_PAY = "wechat_pay"
    ALIPAY = "alipay"
    LINE_PAY = "line_pay"
    SHOPEE_PAY = "shopee_pay"
    GRAB_PAY = "grab_pay"
    MOMO = "momo"
    QR_CODE = "qr_code"
    PAYNOW = "paynow"

    # E-wallets
    DIGITAL_WALLET = "digital_wallet"  # Generic e-wallet
    TOUCH_N_GO = "touch_n_go"
    BOOST = "boost"
    GCASH = "gcash"
    DANA = "dana"
    OVO = "ovo"
    GOPAY = "gopay"

    # Other
    CRYPTOCURRENCY = "cryptocurrency"
    CHEQUE = "cheque"
    OTHER = "other"


class RecurringFrequency(str, enum.Enum):
    """Recurring transaction frequencies"""

    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"


class CategoryType(str, enum.Enum):
    """Category types"""

    INCOME = "income"
    EXPENSE = "expense"


class TransactionStatus(str, enum.Enum):
    """Transaction processing status"""

    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TransactionCategory(BaseModel):
    """Transaction categories with hierarchical support"""

    __tablename__ = "transaction_categories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    name_en: Mapped[Optional[str]] = mapped_column(String(100))
    name_zh: Mapped[Optional[str]] = mapped_column(String(100))
    name_ms: Mapped[Optional[str]] = mapped_column(String(100))
    name_th: Mapped[Optional[str]] = mapped_column(String(100))

    type: Mapped[CategoryType] = mapped_column(Enum(CategoryType), nullable=False)
    color: Mapped[str] = mapped_column(String(7), default="#6B7280")  # Hex color
    icon: Mapped[str] = mapped_column(String(50), default="receipt")

    # Hierarchical categories
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transaction_categories.id"), nullable=True
    )
    parent: Mapped[Optional["TransactionCategory"]] = relationship(
        "TransactionCategory", remote_side=[id], back_populates="subcategories"
    )
    subcategories: Mapped[List["TransactionCategory"]] = relationship(
        "TransactionCategory", back_populates="parent"
    )

    # System flags
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)

    # Usage tracking
    usage_count: Mapped[int] = mapped_column(Integer, default=0)

    # Metadata
    description: Mapped[Optional[str]] = mapped_column(Text)
    keywords: Mapped[Optional[List[str]]] = mapped_column(
        JSON
    )  # For auto-categorization

    # Relationships
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction", back_populates="category_obj"
    )

    # Indexes
    __table_args__ = (
        Index("idx_transaction_categories_type", "type"),
        Index("idx_transaction_categories_parent", "parent_id"),
        Index("idx_transaction_categories_active", "is_active"),
        Index("idx_transaction_categories_usage", "usage_count"),
    )


class Currency(BaseModel):
    """Supported currencies with exchange rates"""

    __tablename__ = "currencies"

    code: Mapped[str] = mapped_column(String(3), primary_key=True)  # ISO 4217
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    symbol: Mapped[str] = mapped_column(String(10), nullable=False)

    # Exchange rates (base: USD)
    exchange_rate_usd: Mapped[Decimal] = mapped_column(
        Numeric(15, 8), nullable=False, default=1.0
    )

    # Regional information
    region: Mapped[Optional[str]] = mapped_column(String(50))
    is_major: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Update tracking
    last_updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now())

    # Relationships
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction", back_populates="currency_obj"
    )


class RecurringTransaction(BaseModel):
    """Recurring transaction rules"""

    __tablename__ = "recurring_transactions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )  # FK to users

    # Basic transaction details
    type: Mapped[TransactionType] = mapped_column(Enum(TransactionType), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transaction_categories.id"), nullable=False
    )
    category: Mapped[TransactionCategory] = relationship("TransactionCategory")

    description: Mapped[str] = mapped_column(String(500), nullable=False)
    payment_method: Mapped[Optional[PaymentMethod]] = mapped_column(Enum(PaymentMethod))

    # Recurring rules
    frequency: Mapped[RecurringFrequency] = mapped_column(
        Enum(RecurringFrequency), nullable=False
    )
    interval: Mapped[int] = mapped_column(Integer, default=1)  # Every N periods

    # Schedule
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    max_occurrences: Mapped[Optional[int]] = mapped_column(Integer)

    # Tracking
    next_occurrence: Mapped[date] = mapped_column(Date, nullable=False)
    occurrence_count: Mapped[int] = mapped_column(Integer, default=0)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_paused: Mapped[bool] = mapped_column(Boolean, default=False)

    # Auto-processing
    auto_create: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True)

    # Metadata
    tags: Mapped[Optional[List[str]]] = mapped_column(JSON)
    notes: Mapped[Optional[str]] = mapped_column(Text)

    # Relationships
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction", back_populates="recurring_transaction"
    )

    # Indexes
    __table_args__ = (
        Index("idx_recurring_user", "user_id"),
        Index("idx_recurring_next_occurrence", "next_occurrence"),
        Index("idx_recurring_active", "is_active"),
        Index("idx_recurring_frequency", "frequency"),
        CheckConstraint("amount > 0", name="check_positive_amount"),
        CheckConstraint("interval > 0", name="check_positive_interval"),
    )


class Transaction(BaseModel):
    """Main transaction model with comprehensive tracking"""

    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )  # FK to users

    # Core transaction data
    type: Mapped[TransactionType] = mapped_column(Enum(TransactionType), nullable=False)
    wallet_type: Mapped[TransactionWalletType] = mapped_column(
        Enum(
            TransactionWalletType,
            name="transaction_wallet_type",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=TransactionWalletType.LIFE,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), ForeignKey("currencies.code"), nullable=False, default="TWD"
    )
    currency_obj: Mapped[Currency] = relationship(
        "Currency", back_populates="transactions"
    )

    # Amount in base currency (USD) for analytics
    amount_usd: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 2))
    exchange_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 8))

    # Transaction details
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Categorization
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transaction_categories.id"), nullable=False
    )
    category_obj: Mapped[TransactionCategory] = relationship(
        "TransactionCategory", back_populates="transactions"
    )
    subcategory: Mapped[Optional[str]] = mapped_column(String(100))

    # Payment information
    payment_method: Mapped[Optional[PaymentMethod]] = mapped_column(Enum(PaymentMethod))
    payment_account: Mapped[Optional[str]] = mapped_column(
        String(100)
    )  # Account/card identifier

    # Location and merchant
    merchant_name: Mapped[Optional[str]] = mapped_column(String(200))
    location: Mapped[Optional[str]] = mapped_column(String(500))
    latitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 8))
    longitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(11, 8))

    # Transaction metadata
    reference_id: Mapped[Optional[str]] = mapped_column(
        String(100)
    )  # External reference

    # Links the two legs (debit + credit) created by create_transfer() so a
    # wallet-to-wallet transfer can be edited/deleted as one unit instead of
    # two orphaned rows. Null for regular income/expense transactions.
    transfer_group_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    receipt_url: Mapped[Optional[str]] = mapped_column(String(500))
    receipt_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)

    # Status and processing
    status: Mapped[TransactionStatus] = mapped_column(
        Enum(TransactionStatus), default=TransactionStatus.COMPLETED
    )
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Tags and notes
    tags: Mapped[Optional[List[str]]] = mapped_column(JSON)
    notes: Mapped[Optional[str]] = mapped_column(Text)

    # Recurring transaction reference
    recurring_transaction_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recurring_transactions.id")
    )
    recurring_transaction: Mapped[Optional[RecurringTransaction]] = relationship(
        "RecurringTransaction", back_populates="transactions"
    )

    # User relationship
    user: Mapped["User"] = relationship("User")

    # Portfolio purchase tracking (optional — only set on the Life Wallet expense
    # that add_holding creates to pay for a holding). Without this link there was
    # no way to find the purchase entry again, so editing a holding's quantity or
    # cost left the ledger untouched and deleting one left the cash spent with no
    # asset to show for it. SET NULL rather than CASCADE: if a holding row is ever
    # hard-deleted the money still moved, so the entry must survive.
    holding_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("portfolio_holdings.id", ondelete="SET NULL"), nullable=True
    )

    # Loan repayment tracking (optional — only set when this transaction is a loan payment)
    loan_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("debt_accounts.id", ondelete="SET NULL"), nullable=True
    )
    principal_portion: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(15, 2), nullable=True, comment="Amount that reduces the loan balance"
    )
    interest_portion: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(15, 2), nullable=True, comment="Interest cost component of this payment"
    )
    loan: Mapped[Optional["DebtAccount"]] = relationship(  # type: ignore[name-defined]
        "DebtAccount",
        primaryjoin="Transaction.loan_id == DebtAccount.id",
        back_populates="payments",
        foreign_keys="[Transaction.loan_id]",
    )

    # Import tracking
    import_source: Mapped[Optional[str]] = mapped_column(
        String(100)
    )  # bank, manual, csv, etc.
    import_batch_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("transaction_import_batches.id", ondelete="SET NULL")
    )

    # Categorization metadata
    auto_categorized: Mapped[bool] = mapped_column(Boolean, default=False)
    categorization_confidence: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(3, 2)
    )  # 0.00-1.00
    reviewed_by_user: Mapped[bool] = mapped_column(Boolean, default=False)

    # Asian-specific features
    qr_payment_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON
    )  # QR payment details
    tax_deductible: Mapped[bool] = mapped_column(Boolean, default=False)
    business_expense: Mapped[bool] = mapped_column(Boolean, default=False)

    # The user's own order inside one day (1 = first), set by dragging rows in the
    # list (PUT /transactions/day-order). NULL until a day is reordered, and such
    # rows keep entry order after the positioned ones — see the list's sort in
    # TransactionRepository.get_all.
    day_position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Soft delete
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Indexes for performance
    __table_args__ = (
        Index("idx_transactions_user_date", "user_id", "transaction_date"),
        Index("idx_transactions_user_type", "user_id", "type"),
        Index("idx_transactions_category", "category_id"),
        Index("idx_transactions_amount", "amount"),
        Index("idx_transactions_currency", "currency"),
        Index("idx_transactions_status", "status"),
        Index("idx_transactions_import", "import_source", "import_batch_id"),
        Index("idx_transactions_location", "latitude", "longitude"),
        Index("idx_transactions_merchant", "merchant_name"),
        Index("idx_transactions_recurring", "recurring_transaction_id"),
        Index("idx_transactions_transfer_group", "transfer_group_id"),
        # Looked up on every holding edit/delete to find that holding's purchase entry.
        Index("idx_transactions_holding", "holding_id"),
        # Composite indexes for dashboard queries
        Index(
            "idx_transactions_user_status_deleted", "user_id", "status", "is_deleted"
        ),
        Index(
            "idx_transactions_user_date_type_status",
            "user_id",
            "transaction_date",
            "type",
            "status",
            "is_deleted",
        ),
        Index("idx_transactions_category_date", "category_id", "transaction_date"),
        # Optimized for category breakdown queries
        Index(
            "idx_transactions_breakdown",
            "user_id",
            "category_id",
            "type",
            "status",
            "is_deleted",
            "transaction_date",
        ),
        Index("idx_transactions_soft_delete", "is_deleted"),
        Index("idx_transactions_payment_method", "payment_method"),
        Index("idx_transactions_auto_categorized", "auto_categorized"),
        CheckConstraint("amount > 0", name="check_positive_amount"),
        CheckConstraint(
            "categorization_confidence >= 0 AND categorization_confidence <= 1",
            name="check_confidence_range",
        ),
    )


class TransactionAttachment(BaseModel):
    """File attachments for transactions (receipts, invoices, etc.)"""

    __tablename__ = "transaction_attachments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
    )

    # File information
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)

    # Storage information
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    storage_provider: Mapped[str] = mapped_column(
        String(50), default="local"
    )  # local, s3, etc.

    # OCR and processing
    ocr_text: Mapped[Optional[str]] = mapped_column(Text)
    processed: Mapped[bool] = mapped_column(Boolean, default=False)
    processing_error: Mapped[Optional[str]] = mapped_column(Text)

    # Metadata
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )  # user_id
    is_receipt: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    transaction: Mapped[Transaction] = relationship("Transaction")

    # Indexes
    __table_args__ = (
        Index("idx_attachments_transaction", "transaction_id"),
        Index("idx_attachments_uploaded_by", "uploaded_by"),
        Index("idx_attachments_processed", "processed"),
    )


class TransactionImportBatch(BaseModel):
    """Batch import tracking for bulk transaction imports"""

    __tablename__ = "transaction_import_batches"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    # Import details
    source: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # csv, bank_api, etc.
    filename: Mapped[Optional[str]] = mapped_column(String(255))

    # Processing status
    status: Mapped[str] = mapped_column(
        String(50), default="processing"
    )  # processing, completed, failed
    total_records: Mapped[int] = mapped_column(Integer, default=0)
    processed_records: Mapped[int] = mapped_column(Integer, default=0)
    successful_imports: Mapped[int] = mapped_column(Integer, default=0)
    failed_imports: Mapped[int] = mapped_column(Integer, default=0)

    # Results
    errors: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSON)
    warnings: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSON)

    # Processing metadata
    processing_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    processing_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Configuration
    import_settings: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)

    # Indexes
    __table_args__ = (
        Index("idx_import_batches_user", "user_id"),
        Index("idx_import_batches_status", "status"),
        Index("idx_import_batches_created", "created_at"),
    )
