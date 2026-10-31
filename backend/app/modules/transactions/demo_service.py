"""
Demo transaction service for unauthenticated users in the Aspiro personal finance application.
Provides demo transactions data and temporary storage for demo mode operations.
"""

import asyncio
from datetime import datetime, date, timedelta
from decimal import Decimal
from typing import Optional, List, Dict, Any, Tuple
import uuid
import logging

from .models import TransactionType, PaymentMethod, TransactionStatus, CategoryType
from .repositories import TransactionRepository
from .schemas import (
    TransactionCreate,
    TransactionUpdate,
    TransactionFilter,
    TransactionResponse,
    TransactionAnalytics,
    TransactionSummary,
    CategorySpending,
    MonthlyTrend,
    PaymentMethodAnalytics,
    TransactionCategoryResponse,
    BulkTransactionCreate,
    BulkTransactionResponse,
)
from app.utils.datetime_helpers import business_today
from app.utils.datetime_helpers import utc_now

logger = logging.getLogger(__name__)

# Anonymous demo writes land in this process-wide list, shared by every visitor
# and kept until restart. Keep only the newest few so unauthenticated callers
# cannot grow backend memory without bound.
MAX_DEMO_WRITES = 100


class DemoTransactionService:
    """Service for demo transaction operations without database persistence"""

    def __init__(self):
        self.demo_transactions = []
        self.demo_categories = []
        self._initialize_demo_data()
        self._seed_count = len(self.demo_transactions)

    def _initialize_demo_data(self):
        """Initialize demo transactions and categories"""

        # Demo categories
        self.demo_categories = [
            {
                "id": "550e8400-e29b-41d4-a716-446655440001",
                "name": "Food & Dining",
                "name_en": "Food & Dining",
                "type": CategoryType.EXPENSE,
                "color": "#F59E0B",
                "icon": "utensils",
                "parent_id": None,
                "description": "Restaurants, cafes, food delivery",
                "keywords": ["restaurant", "cafe", "food", "dining"],
                "usage_count": 15,
                "is_default": True,
                "is_active": True,
                "is_system": True,
                "subcategories": None,
                "created_at": utc_now() - timedelta(days=30),
                "updated_at": utc_now(),
            },
            {
                "id": "550e8400-e29b-41d4-a716-446655440002",
                "name": "Groceries",
                "name_en": "Groceries",
                "type": CategoryType.EXPENSE,
                "color": "#10B981",
                "icon": "shopping-cart",
                "parent_id": None,
                "description": "Supermarket, grocery shopping",
                "keywords": ["grocery", "supermarket", "food"],
                "usage_count": 12,
                "is_default": True,
                "is_active": True,
                "is_system": True,
                "subcategories": None,
                "created_at": utc_now() - timedelta(days=30),
                "updated_at": utc_now(),
            },
            {
                "id": "550e8400-e29b-41d4-a716-446655440003",
                "name": "Transportation",
                "name_en": "Transportation",
                "type": CategoryType.EXPENSE,
                "color": "#3B82F6",
                "icon": "car",
                "parent_id": None,
                "description": "Public transport, ride-sharing, fuel",
                "keywords": ["transport", "taxi", "bus", "mrt"],
                "usage_count": 10,
                "is_default": True,
                "is_active": True,
                "is_system": True,
                "subcategories": None,
                "created_at": utc_now() - timedelta(days=30),
                "updated_at": utc_now(),
            },
            {
                "id": "550e8400-e29b-41d4-a716-446655440004",
                "name": "Shopping",
                "name_en": "Shopping",
                "type": CategoryType.EXPENSE,
                "color": "#EC4899",
                "icon": "shopping-bag",
                "parent_id": None,
                "description": "Clothing, electronics, online shopping",
                "keywords": ["shopping", "clothes", "electronics"],
                "usage_count": 8,
                "is_default": True,
                "is_active": True,
                "is_system": True,
                "subcategories": None,
                "created_at": utc_now() - timedelta(days=30),
                "updated_at": utc_now(),
            },
            {
                "id": "550e8400-e29b-41d4-a716-446655440010",
                "name": "Others",
                "name_en": "Others",
                "type": CategoryType.EXPENSE,
                "color": "#9CA3AF",
                "icon": "ellipsis-horizontal",
                "parent_id": None,
                "description": "Other expenses",
                "keywords": ["other", "expense", "misc"],
                "usage_count": 2,
                "is_default": True,
                "is_active": True,
                "is_system": True,
                "subcategories": None,
                "created_at": utc_now() - timedelta(days=30),
                "updated_at": utc_now(),
            },
            {
                "id": "550e8400-e29b-41d4-a716-446655440005",
                "name": "Salary",
                "name_en": "Salary",
                "type": CategoryType.INCOME,
                "color": "#059669",
                "icon": "dollar-sign",
                "parent_id": None,
                "description": "Monthly salary income",
                "keywords": ["salary", "income", "wage"],
                "usage_count": 3,
                "is_default": True,
                "is_active": True,
                "is_system": True,
                "subcategories": None,
                "created_at": utc_now() - timedelta(days=30),
                "updated_at": utc_now(),
            },
            {
                "id": "550e8400-e29b-41d4-a716-446655440006",
                "name": "Others",
                "name_en": "Others",
                "type": CategoryType.INCOME,
                "color": "#8B5CF6",
                "icon": "star",
                "parent_id": None,
                "description": "Other income sources",
                "keywords": ["other", "income", "misc"],
                "usage_count": 1,
                "is_default": True,
                "is_active": True,
                "is_system": True,
                "subcategories": None,
                "created_at": utc_now() - timedelta(days=30),
                "updated_at": utc_now(),
            },
        ]

        # Demo transactions
        today = business_today()
        self.demo_transactions = [
            # Recent transactions
            {
                "id": "demo-tx-001",
                "user_id": "demo-user",
                "type": TransactionType.EXPENSE,
                "amount": Decimal("15.50"),
                "currency": "SGD",
                "description": "Lunch at Hawker Center",
                "transaction_date": today - timedelta(days=1),
                "category_id": "550e8400-e29b-41d4-a716-446655440001",
                "payment_method": PaymentMethod.GRAB_PAY,
                "merchant_name": "Hong Lim Food Centre",
                "location": "Hong Lim Market & Food Centre, Singapore",
                "status": TransactionStatus.COMPLETED,
                "auto_categorized": True,
                "categorization_confidence": Decimal("0.85"),
                "reviewed_by_user": False,
                "tags": ["lunch", "hawker"],
                "amount_usd": Decimal("11.63"),
                "exchange_rate": Decimal("0.75"),
                "processed_at": utc_now() - timedelta(days=1),
                "created_at": utc_now() - timedelta(days=1),
                "updated_at": utc_now() - timedelta(days=1),
                "category_obj": None,
                "qr_payment_data": None,
                "receipt_url": None,
                "receipt_data": None,
                "notes": None,
                "tax_deductible": False,
                "business_expense": False,
                "import_source": None,
                "import_batch_id": None,
                "recurring_transaction_id": None,
            },
            {
                "id": "demo-tx-002",
                "user_id": "demo-user",
                "type": TransactionType.EXPENSE,
                "amount": Decimal("8.50"),
                "currency": "SGD",
                "description": "Coffee at Starbucks",
                "transaction_date": today - timedelta(days=2),
                "category_id": "550e8400-e29b-41d4-a716-446655440001",
                "payment_method": PaymentMethod.CREDIT_CARD,
                "merchant_name": "Starbucks",
                "location": "Marina Bay Sands, Singapore",
                "status": TransactionStatus.COMPLETED,
                "auto_categorized": True,
                "categorization_confidence": Decimal("0.92"),
                "reviewed_by_user": False,
                "tags": ["coffee", "morning"],
                "amount_usd": Decimal("6.38"),
                "exchange_rate": Decimal("0.75"),
                "processed_at": utc_now() - timedelta(days=2),
                "created_at": utc_now() - timedelta(days=2),
                "updated_at": utc_now() - timedelta(days=2),
                "category_obj": None,
                "qr_payment_data": None,
                "receipt_url": None,
                "receipt_data": None,
                "notes": None,
                "tax_deductible": False,
                "business_expense": False,
                "import_source": None,
                "import_batch_id": None,
                "recurring_transaction_id": None,
            },
            {
                "id": "demo-tx-003",
                "user_id": "demo-user",
                "type": TransactionType.EXPENSE,
                "amount": Decimal("45.80"),
                "currency": "SGD",
                "description": "Grocery shopping",
                "transaction_date": today - timedelta(days=3),
                "category_id": "550e8400-e29b-41d4-a716-446655440002",
                "payment_method": PaymentMethod.DEBIT_CARD,
                "merchant_name": "FairPrice Xtra",
                "location": "FairPrice Xtra Jurong Point, Singapore",
                "status": TransactionStatus.COMPLETED,
                "auto_categorized": True,
                "categorization_confidence": Decimal("0.95"),
                "reviewed_by_user": False,
                "tags": ["groceries", "weekly"],
                "amount_usd": Decimal("34.35"),
                "exchange_rate": Decimal("0.75"),
                "processed_at": utc_now() - timedelta(days=3),
                "created_at": utc_now() - timedelta(days=3),
                "updated_at": utc_now() - timedelta(days=3),
                "category_obj": None,
                "qr_payment_data": None,
                "receipt_url": None,
                "receipt_data": None,
                "notes": None,
                "tax_deductible": False,
                "business_expense": False,
                "import_source": None,
                "import_batch_id": None,
                "recurring_transaction_id": None,
            },
            {
                "id": "demo-tx-004",
                "user_id": "demo-user",
                "type": TransactionType.EXPENSE,
                "amount": Decimal("12.00"),
                "currency": "SGD",
                "description": "Grab ride to office",
                "transaction_date": today - timedelta(days=4),
                "category_id": "550e8400-e29b-41d4-a716-446655440003",
                "payment_method": PaymentMethod.GRAB_PAY,
                "merchant_name": "Grab",
                "location": "From: Home to CBD, Singapore",
                "status": TransactionStatus.COMPLETED,
                "auto_categorized": True,
                "categorization_confidence": Decimal("0.88"),
                "reviewed_by_user": False,
                "tags": ["commute", "work"],
                "amount_usd": Decimal("9.00"),
                "exchange_rate": Decimal("0.75"),
                "processed_at": utc_now() - timedelta(days=4),
                "created_at": utc_now() - timedelta(days=4),
                "updated_at": utc_now() - timedelta(days=4),
                "category_obj": None,
                "qr_payment_data": None,
                "receipt_url": None,
                "receipt_data": None,
                "notes": None,
                "tax_deductible": False,
                "business_expense": False,
                "import_source": None,
                "import_batch_id": None,
                "recurring_transaction_id": None,
            },
            {
                "id": "demo-tx-005",
                "user_id": "demo-user",
                "type": TransactionType.EXPENSE,
                "amount": Decimal("89.99"),
                "currency": "SGD",
                "description": "Online shopping - Electronics",
                "transaction_date": today - timedelta(days=5),
                "category_id": "550e8400-e29b-41d4-a716-446655440004",
                "payment_method": PaymentMethod.CREDIT_CARD,
                "merchant_name": "Shopee",
                "location": "Online",
                "status": TransactionStatus.COMPLETED,
                "auto_categorized": True,
                "categorization_confidence": Decimal("0.78"),
                "reviewed_by_user": False,
                "tags": ["online", "electronics"],
                "amount_usd": Decimal("67.49"),
                "exchange_rate": Decimal("0.75"),
                "processed_at": utc_now() - timedelta(days=5),
                "created_at": utc_now() - timedelta(days=5),
                "updated_at": utc_now() - timedelta(days=5),
                "category_obj": None,
                "qr_payment_data": None,
                "receipt_url": None,
                "receipt_data": None,
                "notes": None,
                "tax_deductible": False,
                "business_expense": False,
                "import_source": None,
                "import_batch_id": None,
                "recurring_transaction_id": None,
            },
            {
                "id": "demo-tx-006",
                "user_id": "demo-user",
                "type": TransactionType.EXPENSE,
                "amount": Decimal("15.75"),
                "currency": "SGD",
                "description": "Miscellaneous expense",
                "transaction_date": today - timedelta(days=6),
                "category_id": "550e8400-e29b-41d4-a716-446655440010",
                "payment_method": PaymentMethod.CASH,
                "merchant_name": "Unknown",
                "location": "Various",
                "status": TransactionStatus.COMPLETED,
                "auto_categorized": False,
                "categorization_confidence": Decimal("0.0"),
                "reviewed_by_user": False,
                "tags": ["misc"],
                "amount_usd": Decimal("11.81"),
                "exchange_rate": Decimal("0.75"),
                "processed_at": utc_now() - timedelta(days=6),
                "created_at": utc_now() - timedelta(days=6),
                "updated_at": utc_now() - timedelta(days=6),
                "category_obj": None,
                "qr_payment_data": None,
                "receipt_url": None,
                "receipt_data": None,
                "notes": None,
                "tax_deductible": False,
                "business_expense": False,
                "import_source": None,
                "import_batch_id": None,
                "recurring_transaction_id": None,
            },
            {
                "id": "demo-tx-006b",
                "user_id": "demo-user",
                "type": TransactionType.INCOME,
                "amount": Decimal("4500.00"),
                "currency": "SGD",
                "description": "Monthly Salary",
                "transaction_date": today.replace(day=1),
                "category_id": "550e8400-e29b-41d4-a716-446655440005",
                "payment_method": PaymentMethod.BANK_TRANSFER,
                "merchant_name": "ABC Tech Pte Ltd",
                "location": "Singapore",
                "status": TransactionStatus.COMPLETED,
                "auto_categorized": True,
                "categorization_confidence": Decimal("0.98"),
                "reviewed_by_user": False,
                "tags": ["salary", "monthly"],
                "amount_usd": Decimal("3375.00"),
                "exchange_rate": Decimal("0.75"),
                "processed_at": utc_now() - timedelta(days=10),
                "created_at": utc_now() - timedelta(days=10),
                "updated_at": utc_now() - timedelta(days=10),
                "category_obj": None,
                "qr_payment_data": None,
                "receipt_url": None,
                "receipt_data": None,
                "notes": None,
                "tax_deductible": False,
                "business_expense": False,
                "import_source": None,
                "import_batch_id": None,
                "recurring_transaction_id": None,
            },
            {
                "id": "demo-tx-007",
                "user_id": "demo-user",
                "type": TransactionType.INCOME,
                "amount": Decimal("250.00"),
                "currency": "SGD",
                "description": "Bonus from side project",
                "transaction_date": today - timedelta(days=7),
                "category_id": "550e8400-e29b-41d4-a716-446655440006",
                "payment_method": PaymentMethod.BANK_TRANSFER,
                "merchant_name": "Freelance Client",
                "location": "Online",
                "status": TransactionStatus.COMPLETED,
                "auto_categorized": False,
                "categorization_confidence": Decimal("0.0"),
                "reviewed_by_user": True,
                "tags": ["bonus", "other"],
                "amount_usd": Decimal("187.50"),
                "exchange_rate": Decimal("0.75"),
                "processed_at": utc_now() - timedelta(days=7),
                "created_at": utc_now() - timedelta(days=7),
                "updated_at": utc_now() - timedelta(days=7),
                "category_obj": None,
                "qr_payment_data": None,
                "receipt_url": None,
                "receipt_data": None,
                "notes": "Other income source",
                "tax_deductible": False,
                "business_expense": False,
                "import_source": None,
                "import_batch_id": None,
                "recurring_transaction_id": None,
            },
        ]

        # Add category objects to transactions
        category_map = {cat["id"]: cat for cat in self.demo_categories}
        for tx in self.demo_transactions:
            if tx["category_id"] in category_map:
                tx["category_obj"] = TransactionCategoryResponse(
                    **category_map[tx["category_id"]]
                )

    async def create_transaction(
        self, transaction_data: TransactionCreate
    ) -> Dict[str, Any]:
        """Create a demo transaction (stored temporarily in memory)"""

        # Generate demo transaction
        tx_id = f"demo-tx-{str(uuid.uuid4())[:8]}"
        now = utc_now()

        transaction_dict = {
            "id": tx_id,
            "user_id": "demo-user",
            **transaction_data.model_dump(),
            "status": TransactionStatus.COMPLETED,
            "processed_at": now,
            "auto_categorized": False,
            "categorization_confidence": None,
            "reviewed_by_user": True,
            "amount_usd": transaction_data.amount
            * Decimal("0.75"),  # Demo exchange rate
            "exchange_rate": Decimal("0.75"),
            "created_at": now,
            "updated_at": now,
            "category_obj": None,
            "qr_payment_data": transaction_data.qr_payment_data,
            "receipt_url": None,
            "receipt_data": None,
            "import_source": None,
            "import_batch_id": None,
            "recurring_transaction_id": transaction_data.recurring_transaction_id,
        }

        # Add category object if exists
        category = next(
            (
                cat
                for cat in self.demo_categories
                if cat["id"] == transaction_data.category_id
            ),
            None,
        )
        if category:
            transaction_dict["category_obj"] = TransactionCategoryResponse(**category)

        # Add to demo transactions (at beginning for chronological order)
        self.demo_transactions.insert(0, transaction_dict)
        written = len(self.demo_transactions) - self._seed_count
        if written > MAX_DEMO_WRITES:
            # New writes sit in front of the seed rows; drop the oldest of them.
            del self.demo_transactions[MAX_DEMO_WRITES:written]

        logger.info(f"Demo transaction created: {tx_id}")

        return {
            "transaction": TransactionResponse(**transaction_dict),
            "auto_categorized": False,
            "categorization_confidence": None,
        }

    async def get_transaction(
        self, transaction_id: str
    ) -> Optional[TransactionResponse]:
        """Get a demo transaction by ID"""

        transaction = next(
            (tx for tx in self.demo_transactions if tx["id"] == transaction_id), None
        )
        if transaction:
            return TransactionResponse(**transaction)
        return None

    async def get_transactions(
        self,
        filter_params: Optional[TransactionFilter] = None,
        page: int = 1,
        limit: int = 20,
        sort_by: str = "transaction_date",
        sort_order: str = "desc",
    ) -> Dict[str, Any]:
        """Get paginated demo transactions with filtering"""

        filtered_transactions = self._apply_filters(
            self.demo_transactions, filter_params
        )
        sorted_transactions = self._sort_transactions(
            filtered_transactions, sort_by, sort_order
        )

        # Apply pagination
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        paginated_transactions = sorted_transactions[start_idx:end_idx]

        # Convert to response objects
        transaction_responses = [
            TransactionResponse(**tx) for tx in paginated_transactions
        ]

        total = len(sorted_transactions)
        total_pages = (total + limit - 1) // limit

        return {
            "transactions": transaction_responses,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_previous": page > 1,
        }

    async def update_transaction(
        self, transaction_id: str, update_data: TransactionUpdate
    ) -> Optional[TransactionResponse]:
        """Update a demo transaction"""

        transaction_idx = next(
            (
                i
                for i, tx in enumerate(self.demo_transactions)
                if tx["id"] == transaction_id
            ),
            None,
        )

        if transaction_idx is None:
            return None

        # Update transaction data
        update_dict = update_data.model_dump(exclude_unset=True)
        self.demo_transactions[transaction_idx].update(update_dict)
        self.demo_transactions[transaction_idx]["updated_at"] = utc_now()

        # Update category object if category changed
        if "category_id" in update_dict:
            category = next(
                (
                    cat
                    for cat in self.demo_categories
                    if cat["id"] == update_dict["category_id"]
                ),
                None,
            )
            if category:
                self.demo_transactions[transaction_idx]["category_obj"] = (
                    TransactionCategoryResponse(**category)
                )

        logger.info(f"Demo transaction updated: {transaction_id}")

        return TransactionResponse(**self.demo_transactions[transaction_idx])

    async def delete_transaction(self, transaction_id: str) -> bool:
        """Delete a demo transaction"""

        transaction_idx = next(
            (
                i
                for i, tx in enumerate(self.demo_transactions)
                if tx["id"] == transaction_id
            ),
            None,
        )

        if transaction_idx is not None:
            del self.demo_transactions[transaction_idx]
            logger.info(f"Demo transaction deleted: {transaction_id}")
            return True

        return False

    async def bulk_create_transactions(
        self, bulk_data: BulkTransactionCreate
    ) -> BulkTransactionResponse:
        """Bulk create demo transactions"""

        created_transactions = []
        errors = []
        skipped = 0

        for i, transaction_data in enumerate(bulk_data.transactions):
            try:
                # Check for duplicates if enabled
                if bulk_data.skip_duplicates:
                    is_duplicate = self._check_duplicate_transaction(transaction_data)
                    if is_duplicate:
                        skipped += 1
                        continue

                # Create transaction
                result = await self.create_transaction(transaction_data)
                created_transactions.append(result["transaction"])

            except Exception as e:
                logger.error(f"Error creating demo transaction {i}: {str(e)}")
                errors.append(
                    {
                        "index": i,
                        "error": str(e),
                        "transaction_data": transaction_data.model_dump(),
                    }
                )

        return BulkTransactionResponse(
            total_requested=len(bulk_data.transactions),
            successful=len(created_transactions),
            failed=len(errors),
            skipped=skipped,
            created_transactions=created_transactions,
            errors=errors,
        )

    async def get_analytics(
        self, date_from: Optional[date] = None, date_to: Optional[date] = None
    ) -> TransactionAnalytics:
        """Get demo transaction analytics"""

        # Default to last 30 days if no dates provided
        if not date_to:
            date_to = business_today()
        if not date_from:
            date_from = date_to - timedelta(days=30)

        # Filter transactions by date range
        filtered_transactions = [
            tx
            for tx in self.demo_transactions
            if date_from <= tx["transaction_date"] <= date_to
        ]

        # Calculate summary
        total_income = sum(
            tx["amount"]
            for tx in filtered_transactions
            if tx["type"] == TransactionType.INCOME
        )
        total_expenses = sum(
            tx["amount"]
            for tx in filtered_transactions
            if tx["type"] == TransactionType.EXPENSE
        )

        summary = TransactionSummary(
            total_income=total_income,
            total_expenses=total_expenses,
            net_amount=total_income - total_expenses,
            transaction_count=len(filtered_transactions),
            period_start=date_from,
            period_end=date_to,
            currency="SGD",
        )

        # Category breakdown
        category_amounts = {}
        for tx in filtered_transactions:
            if tx["type"] == TransactionType.EXPENSE:
                category_id = tx["category_id"]
                if category_id not in category_amounts:
                    category_amounts[category_id] = {"amount": Decimal("0"), "count": 0}
                category_amounts[category_id]["amount"] += tx["amount"]
                category_amounts[category_id]["count"] += 1

        category_breakdown = []
        category_map = {cat["id"]: cat for cat in self.demo_categories}

        for category_id, data in category_amounts.items():
            if category_id in category_map:
                category = category_map[category_id]
                percentage = (
                    (data["amount"] / total_expenses * 100) if total_expenses > 0 else 0
                )
                category_breakdown.append(
                    CategorySpending(
                        category_id=category_id,
                        category_name=category["name"],
                        category_type=category["type"],
                        amount=data["amount"],
                        percentage=Decimal(str(percentage)),
                        transaction_count=data["count"],
                        currency="SGD",
                    )
                )

        # Monthly trends (simplified)
        monthly_trends = [
            MonthlyTrend(
                month=date_from.strftime("%Y-%m"),
                income=total_income,
                expenses=total_expenses,
                net_amount=total_income - total_expenses,
                transaction_count=len(filtered_transactions),
            )
        ]

        # Payment method breakdown
        payment_amounts = {}
        for tx in filtered_transactions:
            if tx["type"] == TransactionType.EXPENSE and tx["payment_method"]:
                pm = tx["payment_method"]
                if pm not in payment_amounts:
                    payment_amounts[pm] = {"amount": Decimal("0"), "count": 0}
                payment_amounts[pm]["amount"] += tx["amount"]
                payment_amounts[pm]["count"] += 1

        payment_breakdown = []
        for pm, data in payment_amounts.items():
            percentage = (
                (data["amount"] / total_expenses * 100) if total_expenses > 0 else 0
            )
            payment_breakdown.append(
                PaymentMethodAnalytics(
                    payment_method=pm,
                    amount=data["amount"],
                    percentage=Decimal(str(percentage)),
                    transaction_count=data["count"],
                )
            )

        # Top merchants
        merchant_amounts = {}
        for tx in filtered_transactions:
            if tx["type"] == TransactionType.EXPENSE and tx["merchant_name"]:
                merchant = tx["merchant_name"]
                if merchant not in merchant_amounts:
                    merchant_amounts[merchant] = {"amount": Decimal("0"), "count": 0}
                merchant_amounts[merchant]["amount"] += tx["amount"]
                merchant_amounts[merchant]["count"] += 1

        top_merchants = [
            {
                "merchant_name": merchant,
                "amount": data["amount"],
                "transaction_count": data["count"],
            }
            for merchant, data in sorted(
                merchant_amounts.items(), key=lambda x: x[1]["amount"], reverse=True
            )[:10]
        ]

        # Currency breakdown
        currency_breakdown = [
            {
                "currency": "SGD",
                "amount": total_income + total_expenses,
                "transaction_count": len(filtered_transactions),
            }
        ]

        return TransactionAnalytics(
            summary=summary,
            category_breakdown=category_breakdown,
            monthly_trends=monthly_trends,
            payment_method_breakdown=payment_breakdown,
            top_merchants=top_merchants,
            currency_breakdown=currency_breakdown,
        )

    def _is_transfer_leg(self, tx) -> bool:
        """The same rule the authenticated endpoint uses, on a fixture row."""
        if tx.get("transfer_group_id") is not None:
            return True
        names = {cat["id"]: cat.get("name") for cat in self.demo_categories}
        name = (names.get(tx.get("category_id")) or "").strip().lower()
        return name in TransactionRepository.TRANSFER_CATEGORY_NAMES

    async def get_monthly_summary(self, year: int) -> List[Dict[str, Any]]:
        """Get monthly spending summary for demo mode"""
        # Same rules as the authenticated endpoint, from the same module — these sets
        # used to be duplicated here verbatim.
        from .spending_buckets import bucket_for, empty_buckets

        year_expense_txs = [
            tx
            for tx in self.demo_transactions
            if tx["transaction_date"].year == year
            and tx["type"] == TransactionType.EXPENSE
        ]
        year_income_txs = [
            tx
            for tx in self.demo_transactions
            if tx["transaction_date"].year == year
            and tx["type"] == TransactionType.INCOME
        ]

        # Group by month
        monthly_summaries = {}
        for month_num in range(1, 13):
            month_key = f"{year}-{month_num:02d}"
            monthly_summaries[month_key] = {
                "month": month_key,
                **empty_buckets(),
                "transfer": 0.0,
                "total": 0.0,
                "income": 0.0,
            }

        category_map = {cat["id"]: cat for cat in self.demo_categories}
        _is_transfer = self._is_transfer_leg

        # Aggregate income by month. A transfer's inflow is the user's own money
        # arriving from their other wallet, not earnings.
        for tx in year_income_txs:
            if _is_transfer(tx):
                continue
            month_key = f"{year}-{tx['transaction_date'].month:02d}"
            monthly_summaries[month_key]["income"] += float(tx["amount"])

        # Categorize expense transactions

        for tx in year_expense_txs:
            month_key = f"{year}-{tx['transaction_date'].month:02d}"
            amount = float(tx["amount"])

            # Get category info (case-insensitive, check parent and Chinese names)
            category_id = tx.get("category_id")
            cat_info = category_map.get(category_id, {})
            category_name_lower = cat_info.get("name", "Others").lower()
            cat_name_zh = (cat_info.get("name_zh") or "").lower()
            parent_id = cat_info.get("parent_id")
            parent_name_lower = ""
            if parent_id and parent_id in category_map:
                parent_name_lower = category_map[parent_id].get("name", "").lower()

            # Its own bucket rather than "others" spending, as on the real endpoint.
            if _is_transfer(tx):
                monthly_summaries[month_key]["transfer"] += amount
            else:
                bucket = bucket_for(
                    (category_name_lower, parent_name_lower, cat_name_zh),
                    has_loan_link=tx.get("loan_id") is not None,
                )
                monthly_summaries[month_key][bucket] += amount

            monthly_summaries[month_key]["total"] += amount

        # Convert to list and return ALL months (including those with zero)
        result_list = sorted(monthly_summaries.values(), key=lambda x: x["month"])

        return result_list

    async def get_categories(
        self, include_inactive: bool = False
    ) -> List[TransactionCategoryResponse]:
        """Get demo categories"""
        categories = self.demo_categories
        if not include_inactive:
            categories = [cat for cat in categories if cat["is_active"]]

        return [TransactionCategoryResponse(**cat) for cat in categories]

    def _apply_filters(
        self, transactions: List[Dict], filter_params: Optional[TransactionFilter]
    ) -> List[Dict]:
        """Apply filtering to transactions"""

        if not filter_params:
            return transactions

        filtered = transactions

        if filter_params.type == TransactionType.TRANSFER:
            # Legs are income/expense rows; none is typed 'transfer'.
            filtered = [tx for tx in filtered if self._is_transfer_leg(tx)]
        elif filter_params.type:
            filtered = [tx for tx in filtered if tx["type"] == filter_params.type]

        if filter_params.category_ids:
            filtered = [
                tx for tx in filtered if tx["category_id"] in filter_params.category_ids
            ]

        if filter_params.payment_methods:
            filtered = [
                tx
                for tx in filtered
                if tx["payment_method"] in filter_params.payment_methods
            ]

        if filter_params.date_from:
            filtered = [
                tx
                for tx in filtered
                if tx["transaction_date"] >= filter_params.date_from
            ]

        if filter_params.date_to:
            filtered = [
                tx for tx in filtered if tx["transaction_date"] <= filter_params.date_to
            ]

        if filter_params.amount_min:
            filtered = [
                tx for tx in filtered if tx["amount"] >= filter_params.amount_min
            ]

        if filter_params.amount_max:
            filtered = [
                tx for tx in filtered if tx["amount"] <= filter_params.amount_max
            ]

        if filter_params.merchant_name:
            filtered = [
                tx
                for tx in filtered
                if tx.get("merchant_name")
                and filter_params.merchant_name.lower() in tx["merchant_name"].lower()
            ]

        if filter_params.search:
            search_lower = filter_params.search.lower()
            filtered = [
                tx
                for tx in filtered
                if (
                    search_lower in tx["description"].lower()
                    or (
                        tx.get("merchant_name")
                        and search_lower in tx["merchant_name"].lower()
                    )
                )
            ]

        return filtered

    def _sort_transactions(
        self, transactions: List[Dict], sort_by: str, sort_order: str
    ) -> List[Dict]:
        """Sort transactions"""

        reverse_order = sort_order == "desc"

        try:
            if sort_by == "transaction_date":
                return sorted(
                    transactions,
                    key=lambda x: x["transaction_date"],
                    reverse=reverse_order,
                )
            elif sort_by == "amount":
                return sorted(
                    transactions, key=lambda x: x["amount"], reverse=reverse_order
                )
            elif sort_by == "created_at":
                return sorted(
                    transactions, key=lambda x: x["created_at"], reverse=reverse_order
                )
            else:
                # Default to transaction_date
                return sorted(
                    transactions,
                    key=lambda x: x["transaction_date"],
                    reverse=reverse_order,
                )
        except KeyError:
            return transactions

    def _check_duplicate_transaction(self, transaction_data: TransactionCreate) -> bool:
        """Check if a similar demo transaction already exists"""

        for tx in self.demo_transactions:
            if (
                tx["amount"] == transaction_data.amount
                and tx["transaction_date"] == transaction_data.transaction_date
                and tx["description"].lower() == transaction_data.description.lower()
            ):
                return True

        return False


# Global instance for demo mode
demo_transaction_service = DemoTransactionService()
