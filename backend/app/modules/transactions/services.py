"""
Business logic service layer for transactions in the Aspiro personal finance application.
Handles complex business rules, auto-categorization, and transaction processing.
"""

from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
from typing import Optional, List, Dict, Any, Tuple
import logging
import re

from sqlalchemy.exc import IntegrityError

from app.core.exceptions import ValidationException

from .repositories import (
    TransactionRepository,
    TransactionCategoryRepository,
    RecurringTransactionRepository,
)
from .models import (
    Transaction,
    TransactionType,
    PaymentMethod,
    TransactionStatus,
    RecurringFrequency,
)
from .schemas import (
    TransactionCreate,
    TransactionUpdate,
    TransactionFilter,
    TransactionAnalytics,
    CategorizationSuggestion,
    AutoCategorizationResponse,
    BulkTransactionCreate,
    BulkTransactionResponse,
    RecurringTransactionUpdate,
)
from app.utils.datetime_helpers import business_today

logger = logging.getLogger(__name__)

# The catch-all an unknown category_name resolves to, per type. Both are in the
# fresh-install seed (scripts/seed/categories.sql); "Others" matches the LINE bot's.
UNKNOWN_CATEGORY_FALLBACK = {"expense": "Others", "income": "Other Income"}


class TransactionService:
    """Service for transaction business logic"""

    def __init__(
        self,
        transaction_repo: TransactionRepository,
        category_repo: TransactionCategoryRepository,
        recurring_repo: RecurringTransactionRepository,
    ):
        self.transaction_repo = transaction_repo
        self.category_repo = category_repo
        self.recurring_repo = recurring_repo
        self.categorization_service = CategorizationService(transaction_repo, category_repo)

    async def _ensure_category_id(self, data: Dict[str, Any]) -> str:
        """Ensure category_id exists, creating category if needed"""
        logger.info(f"🔍 _ensure_category_id called with data: {data}")

        # If category_id is provided, validate it exists in database
        if "category_id" in data and data["category_id"]:
            logger.info(f"🔍 Validating category_id: {data['category_id']}")
            try:
                # Verify the category actually exists
                category = await self.category_repo.get_by_id(data["category_id"])
                if category:
                    logger.info(f"✅ Valid category_id provided: {data['category_id']}")
                    return data["category_id"]
                else:
                    logger.warning(
                        f"⚠️ Invalid category_id provided: {data['category_id']}, will try category_name fallback"
                    )
            except Exception as e:
                logger.warning(
                    f"⚠️ Error validating category_id: {e}, will try category_name fallback"
                )

        # If category_name is provided, try to find or create category
        if "category_name" in data and data["category_name"]:
            logger.info(
                f"🔍 Looking up category by name: {data['category_name']}, type: {data.get('type', 'expense')}"
            )
            category = await self.category_repo.get_by_name(
                data["category_name"], data.get("type", "expense")
            )

            if category:
                logger.info(
                    f"✅ Found existing category by name: {data['category_name']} -> ID: {category.id}"
                )
                return str(category.id)

            # Categories are global and only admins add them, so an unknown name
            # from an ordinary request is not a reason to create one: that let any
            # account put text into every user's category list. Use the catch-all
            # instead, creating only that fixed name on a fresh install without it.
            txn_type = data.get("type", "expense")
            name = UNKNOWN_CATEGORY_FALLBACK.get(
                str(getattr(txn_type, "value", txn_type)).lower(), UNKNOWN_CATEGORY_FALLBACK["expense"]
            )
            fallback = await self.category_repo.get_by_name(name, txn_type)
            if not fallback:
                try:
                    fallback = await self.category_repo.create(
                        {"name": name, "type": txn_type, "color": "#6B7280", "icon": "receipt"}
                    )
                except IntegrityError:
                    # A concurrent first request created it; nothing else is pending yet.
                    await self.category_repo.db.rollback()
                    fallback = await self.category_repo.get_by_name(name, txn_type)
                    if not fallback:
                        raise
            logger.info("Unknown category_name %r; using %r", data["category_name"], name)
            return str(fallback.id)

        # If no category info provided, use auto-categorization
        logger.warning(f"⚠️ No category_id or category_name provided, returning None")
        return None

    async def create_transaction(
        self, transaction_data: TransactionCreate, user_id: str
    ) -> Dict[str, Any]:
        """Create a new transaction with auto-categorization"""

        # Convert to dict and add processing metadata
        data = transaction_data.model_dump()
        data["status"] = TransactionStatus.COMPLETED
        data["processed_at"] = datetime.now(timezone.utc)

        if data.get("loan_id") and data.get("type") == TransactionType.EXPENSE:
            cap = await self._loan_payment_cap(
                str(data["loan_id"]),
                Decimal(str(data.get("principal_portion") or data["amount"])),
                user_id,
            )
            if cap is not None:
                data["principal_portion"] = cap

        # Ensure category_id is set
        category_id = await self._ensure_category_id(data)

        # Auto-categorize if category_id not determined yet
        if not category_id and not data.get("reviewed_by_user", False):
            suggestion = await self.categorization_service.auto_categorize(
                description=data["description"],
                amount=data.get("amount"),
                merchant_name=data.get("merchant_name"),
                payment_method=data.get("payment_method"),
            )

            if (
                suggestion.primary_suggestion
                and suggestion.primary_suggestion.confidence >= 0.7
            ):
                category_id = suggestion.primary_suggestion.category_id
                data["auto_categorized"] = True
                data["categorization_confidence"] = (
                    suggestion.primary_suggestion.confidence
                )

        # Set the category_id
        if category_id:
            data["category_id"] = category_id
        else:
            # Fallback: use a default "Other" category or raise error
            raise ValidationException(
                "Unable to determine transaction category",
                details={
                    "description": data.get("description"),
                    "merchant_name": data.get("merchant_name"),
                    "suggestion": "Please provide a valid category_id or category_name",
                },
            )

        # ⚠️ Remove category_name from data before creating transaction
        # (it's only used for lookup, not stored in the database)
        data.pop("category_name", None)

        # Create transaction
        transaction = await self.transaction_repo.create(data, user_id)

        # Update category usage count
        await self.category_repo.increment_usage(transaction.category_id)

        # Reduce loan balance if this expense is linked to a loan
        if data.get("loan_id") and transaction.type == TransactionType.EXPENSE:
            reduction = data.get("principal_portion") or data["amount"]
            await self._apply_loan_payment(str(data["loan_id"]), Decimal(str(reduction)), user_id)

        # Log transaction creation
        logger.info(f"Transaction created: {transaction.id} for user: {user_id}")

        return {
            "transaction": transaction,
            "auto_categorized": data.get("auto_categorized", False),
            "categorization_confidence": data.get("categorization_confidence"),
        }

    async def create_transfer(
        self,
        user_id: str,
        from_wallet: str,
        to_wallet: str,
        amount: Decimal,
        currency: str,
        transaction_date: date,
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a wallet-to-wallet transfer (atomic operation).

        Creates two synchronized transactions (debit source, credit destination).
        Both wallets must be transaction wallets (life/emergency) — cash never
        lives in the Portfolio wallet, which holds invested assets only. To move
        cash into investments you buy a holding (which debits the Life Wallet).

        Args:
            user_id: User ID
            from_wallet: Source wallet type (life, emergency)
            to_wallet: Destination wallet type (life, emergency)
            amount: Transfer amount (always positive)
            currency: Currency code
            transaction_date: Date of transfer
            notes: Optional notes

        Returns:
            Dict with created transactions/holdings
        """
        from app.modules.transactions.models import TransactionWalletType

        logger.info(
            f"🔄 Creating transfer: {amount} {currency} from {from_wallet} to {to_wallet} for user {user_id}"
        )

        # Validation — cash only ever lives in transaction wallets (life/emergency).
        # "portfolio" is intentionally NOT a transfer target: the Portfolio wallet
        # holds invested assets only, never cash.
        valid_wallets = {e.value for e in TransactionWalletType}
        for field, value in [("from_wallet", from_wallet), ("to_wallet", to_wallet)]:
            if value not in valid_wallets:
                raise ValidationException(
                    f"Invalid {field}: '{value}'. Must be one of: {', '.join(sorted(valid_wallets))}",
                    details={field: value},
                )

        if from_wallet == to_wallet:
            raise ValidationException(
                "Cannot transfer to the same wallet",
                details={"from_wallet": from_wallet, "to_wallet": to_wallet},
            )

        if amount <= 0:
            raise ValidationException(
                "Transfer amount must be positive", details={"amount": float(amount)}
            )

        # Get or create "Transfer" category (EXPENSE type for debit transactions)
        transfer_category_expense = await self.category_repo.get_by_name(
            "Transfer", TransactionType.EXPENSE
        )
        if not transfer_category_expense:
            transfer_category_data = {
                "name": "Transfer",
                "type": TransactionType.EXPENSE,
                "color": "#6B7280",
                "icon": "🔄",
                "description": "Money transfers between wallets",
                "is_system": True,
            }
            transfer_category_expense = await self.category_repo.create(
                transfer_category_data
            )
            logger.info(f"Created 'Transfer' (EXPENSE) category")

        # Get or create "Transfer" category (INCOME type for credit transactions)
        transfer_category_income = await self.category_repo.get_by_name(
            "Transfer", TransactionType.INCOME
        )
        if not transfer_category_income:
            transfer_category_data = {
                "name": "Transfer",
                "type": TransactionType.INCOME,
                "color": "#6B7280",
                "icon": "🔄",
                "description": "Money transfers between wallets",
                "is_system": True,
            }
            transfer_category_income = await self.category_repo.create(
                transfer_category_data
            )
            logger.info(f"Created 'Transfer' (INCOME) category")

        created_items = []

        try:
            # === Step 1: Debit from source wallet ===
            source_description = (
                notes if notes
                else f"Transfer to {to_wallet.replace('_', ' ').title()} Wallet"
            )
            source_transaction_data = {
                "user_id": user_id,
                "type": TransactionType.EXPENSE,
                "wallet_type": from_wallet,
                "category_id": str(transfer_category_expense.id),
                "amount": amount,
                "currency": currency,
                "description": source_description,
                "notes": f"Transfer from {from_wallet.replace('_', ' ').title()} to {to_wallet.replace('_', ' ').title()}",
                "transaction_date": transaction_date,
                "payment_method": "bank_transfer",
                "status": TransactionStatus.COMPLETED,
                "processed_at": datetime.now(timezone.utc),
            }

            # Use flush (not commit) so both legs are in the same transaction
            source_transaction = await self.transaction_repo.create_flush(
                source_transaction_data, user_id
            )
            # Both legs share this as their transfer_group_id so the pair can
            # later be edited/deleted as one unit (see update_transfer /
            # delete_transaction).
            source_transaction.transfer_group_id = source_transaction.id
            created_items.append({"type": "transaction", "item": source_transaction})
            logger.info(f"✅ Flushed source transaction: {source_transaction.id}")

            # === Step 2: Credit to destination wallet ===
            # Both legs are transactions now (life/emergency only); the Portfolio
            # wallet never receives cash.
            dest_description = (
                notes if notes
                else f"Transfer from {from_wallet.replace('_', ' ').title()} Wallet"
            )
            dest_transaction_data = {
                "user_id": user_id,
                "type": TransactionType.INCOME,
                "wallet_type": to_wallet,
                "category_id": str(transfer_category_income.id),
                "amount": amount,
                "currency": currency,
                "description": dest_description,
                "notes": f"Transfer from {from_wallet.replace('_', ' ').title()} to {to_wallet.replace('_', ' ').title()}",
                "transaction_date": transaction_date,
                "payment_method": "bank_transfer",
                "status": TransactionStatus.COMPLETED,
                "processed_at": datetime.now(timezone.utc),
                "transfer_group_id": source_transaction.id,
            }

            dest_transaction = await self.transaction_repo.create_flush(
                dest_transaction_data, user_id
            )
            created_items.append({"type": "transaction", "item": dest_transaction})
            logger.info(f"✅ Flushed destination transaction: {dest_transaction.id}")

            # Single commit covers both legs — atomicity guaranteed
            await self.transaction_repo.db.commit()
            logger.info(f"✅ Transfer committed atomically: {len(created_items)} items")

            return {
                "success": True,
                "from_wallet": from_wallet,
                "to_wallet": to_wallet,
                "amount": float(amount),
                "currency": currency,
                "items": created_items,
            }

        except Exception as e:
            logger.error(f"❌ Transfer failed, rolling back: {str(e)}", exc_info=True)
            await self.transaction_repo.db.rollback()
            raise

    async def get_transfer(
        self, user_id: str, group_id: str
    ) -> Optional[Dict[str, Any]]:
        """Fetch both legs of a wallet transfer as a single editable unit."""
        legs = await self.transaction_repo.get_by_transfer_group(group_id, user_id)
        expense_leg = next((t for t in legs if t.type == TransactionType.EXPENSE), None)
        income_leg = next((t for t in legs if t.type == TransactionType.INCOME), None)
        if not expense_leg or not income_leg:
            return None

        return {
            "transfer_group_id": group_id,
            "from_wallet": expense_leg.wallet_type.value
            if hasattr(expense_leg.wallet_type, "value")
            else expense_leg.wallet_type,
            "to_wallet": income_leg.wallet_type.value
            if hasattr(income_leg.wallet_type, "value")
            else income_leg.wallet_type,
            "amount": float(expense_leg.amount),
            "currency": expense_leg.currency,
            "transaction_date": expense_leg.transaction_date.isoformat(),
            "notes": expense_leg.notes,
        }

    async def update_transfer(
        self,
        user_id: str,
        group_id: str,
        from_wallet: str,
        to_wallet: str,
        amount: Decimal,
        currency: str,
        transaction_date: date,
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Update both legs of an existing wallet transfer atomically.

        Mirrors create_transfer's validation and atomicity: the two rows
        linked by transfer_group_id are rewritten together (wallet_type,
        amount, currency, date) so there is no path that leaves the wallets
        unbalanced by editing only one leg.
        """
        from app.modules.transactions.models import TransactionWalletType

        valid_wallets = {e.value for e in TransactionWalletType}
        for field, value in [("from_wallet", from_wallet), ("to_wallet", to_wallet)]:
            if value not in valid_wallets:
                raise ValidationException(
                    f"Invalid {field}: '{value}'. Must be one of: {', '.join(sorted(valid_wallets))}",
                    details={field: value},
                )

        if from_wallet == to_wallet:
            raise ValidationException(
                "Cannot transfer to the same wallet",
                details={"from_wallet": from_wallet, "to_wallet": to_wallet},
            )

        if amount <= 0:
            raise ValidationException(
                "Transfer amount must be positive", details={"amount": float(amount)}
            )

        legs = await self.transaction_repo.get_by_transfer_group(group_id, user_id)
        expense_leg = next((t for t in legs if t.type == TransactionType.EXPENSE), None)
        income_leg = next((t for t in legs if t.type == TransactionType.INCOME), None)
        if not expense_leg or not income_leg:
            raise ValidationException(
                "Transfer not found or already deleted",
                details={"transfer_group_id": group_id},
            )

        fixed_notes = f"Transfer from {from_wallet.replace('_', ' ').title()} to {to_wallet.replace('_', ' ').title()}"
        source_description = (
            notes if notes else f"Transfer to {to_wallet.replace('_', ' ').title()} Wallet"
        )
        dest_description = (
            notes if notes else f"Transfer from {from_wallet.replace('_', ' ').title()} Wallet"
        )

        try:
            await self.transaction_repo.update_flush(
                str(expense_leg.id),
                user_id,
                {
                    "wallet_type": from_wallet,
                    "amount": amount,
                    "currency": currency,
                    "transaction_date": transaction_date,
                    "description": source_description,
                    "notes": fixed_notes,
                },
            )
            await self.transaction_repo.update_flush(
                str(income_leg.id),
                user_id,
                {
                    "wallet_type": to_wallet,
                    "amount": amount,
                    "currency": currency,
                    "transaction_date": transaction_date,
                    "description": dest_description,
                    "notes": fixed_notes,
                },
            )
            await self.transaction_repo.db.commit()
            logger.info(f"✅ Transfer {group_id} updated atomically")
        except Exception as e:
            logger.error(f"❌ Transfer update failed, rolling back: {str(e)}", exc_info=True)
            await self.transaction_repo.db.rollback()
            raise

        return {
            "success": True,
            "transfer_group_id": group_id,
            "from_wallet": from_wallet,
            "to_wallet": to_wallet,
            "amount": float(amount),
            "currency": currency,
        }

    async def get_transaction(self, transaction_id: str, user_id: str):
        """Get transaction by ID"""
        return await self.transaction_repo.get_by_id(transaction_id, user_id)

    async def get_transactions(
        self,
        user_id: str,
        filter_params: Optional[TransactionFilter] = None,
        page: int = 1,
        limit: int = 20,
        sort_by: str = "transaction_date",
        sort_order: str = "desc",
    ) -> Dict[str, Any]:
        """Get paginated transactions with filtering"""

        transactions, total = await self.transaction_repo.get_all(
            user_id=user_id,
            filter_params=filter_params,
            page=page,
            limit=limit,
            sort_by=sort_by,
            sort_order=sort_order,
        )

        total_pages = (total + limit - 1) // limit

        return {
            "transactions": transactions,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_previous": page > 1,
        }

    async def update_transaction(
        self, transaction_id: str, user_id: str, update_data: TransactionUpdate
    ):
        """Update a transaction with category resolution"""

        data = update_data.model_dump(exclude_unset=True)
        logger.info(f"🔍 UPDATE TRANSACTION - Incoming data: {data}")

        # ✅ Ensure category_id is resolved (handles category_name if provided)
        if "category_id" in data or "category_name" in data:
            logger.info(
                f"🔍 UPDATE TRANSACTION - Before category resolution: category_id={data.get('category_id')}, category_name={data.get('category_name')}"
            )
            # An edit rarely resends the type; resolve the name against the
            # stored one so an income row does not get an expense category.
            lookup = data
            if data.get("category_name") and "type" not in data:
                stored = await self.transaction_repo.get_by_id(transaction_id, user_id)
                if stored:
                    lookup = {**data, "type": stored.type}
            category_id = await self._ensure_category_id(lookup)
            logger.info(
                f"🔍 UPDATE TRANSACTION - After _ensure_category_id: category_id={category_id}"
            )

            if category_id:
                data["category_id"] = category_id
                data["reviewed_by_user"] = True
                data["auto_categorized"] = False
                data["categorization_confidence"] = None
                logger.info(f"✅ UPDATE TRANSACTION - Set category_id to {category_id}")
            else:
                logger.warning(
                    f"⚠️ UPDATE TRANSACTION - _ensure_category_id returned None!"
                )

            # Remove category_name from data (not a database field)
            data.pop("category_name", None)

        # Treat an empty loan_id as an explicit "unlink" (restore the balance).
        if "loan_id" in data and not data["loan_id"]:
            data["loan_id"] = None

        # Only snapshot the pre-update loan effect when an edit could actually shift
        # a loan balance (link/unlink, amount, or type). Ordinary edits (description,
        # category, tags…) skip the extra fetch and the sync entirely.
        loan_relevant = bool({"loan_id", "amount", "type"} & data.keys())
        existing = (
            await self.transaction_repo.get_by_id(transaction_id, user_id)
            if loan_relevant
            else None
        )
        old_loan_id = str(existing.loan_id) if existing and existing.loan_id else None
        old_is_expense = bool(existing and existing.type == TransactionType.EXPENSE)
        old_reduction = (
            Decimal(str(existing.principal_portion or existing.amount))
            if existing
            else Decimal("0")
        )

        if existing:
            next_loan_id = data["loan_id"] if "loan_id" in data else old_loan_id
            next_type = data.get("type", existing.type)
            next_amount = Decimal(str(data.get("amount", existing.amount)))
            next_reduction = next_amount
            if existing.principal_portion:
                # The principal part of a payment can never be more than the payment:
                # lowering a capped 3,200 payment to 2,000 takes 2,000 off, not 3,000.
                next_reduction = min(Decimal(str(existing.principal_portion)), next_amount)
                if next_reduction != existing.principal_portion:
                    data["principal_portion"] = next_reduction
            if next_loan_id and next_type == TransactionType.EXPENSE:
                # This row's current payment is already off the balance; it comes
                # back before the new one goes on.
                same_payment = old_loan_id == str(next_loan_id) and old_is_expense
                cap = await self._loan_payment_cap(
                    str(next_loan_id),
                    next_reduction,
                    user_id,
                    already_applied=old_reduction if same_payment else Decimal("0"),
                )
                if cap is not None:
                    data["principal_portion"] = cap

        logger.info(f"🔍 UPDATE TRANSACTION - Final data before repo.update: {data}")
        transaction = await self.transaction_repo.update(transaction_id, user_id, data)

        if transaction:
            if "category_id" in data:
                await self.category_repo.increment_usage(transaction.category_id)

            # Re-sync the loan balance: reverse the old effect, apply the new one.
            if loan_relevant:
                new_loan_id = str(transaction.loan_id) if transaction.loan_id else None
                new_is_expense = transaction.type == TransactionType.EXPENSE
                new_reduction = Decimal(str(transaction.principal_portion or transaction.amount))
                if (
                    old_loan_id != new_loan_id
                    or old_reduction != new_reduction
                    or old_is_expense != new_is_expense
                ):
                    if old_loan_id and old_is_expense:
                        await self._apply_loan_payment(old_loan_id, -old_reduction, user_id)
                    if new_loan_id and new_is_expense:
                        await self._apply_loan_payment(new_loan_id, new_reduction, user_id)

        logger.info(f"Transaction updated: {transaction_id} by user: {user_id}")

        return transaction

    async def set_day_order(self, user_id: str, day: date, ids: List[str]) -> List[str]:
        """Order one day's rows as the user dragged them (#478); see the repository."""
        return await self.transaction_repo.set_day_order(str(user_id), day, ids)

    async def delete_transaction(self, transaction_id: str, user_id: str) -> bool:
        """Soft delete a transaction"""
        # Fetch before deleting so we can reverse any loan balance change
        existing = await self.transaction_repo.get_by_id(transaction_id, user_id)

        success = await self.transaction_repo.soft_delete(transaction_id, user_id)

        if success:
            # Reverse the loan balance reduction if this was a linked loan expense
            if (
                existing
                and existing.loan_id
                and existing.type == TransactionType.EXPENSE
            ):
                restore = existing.principal_portion or existing.amount
                await self._apply_loan_payment(
                    str(existing.loan_id), -Decimal(str(restore)), user_id
                )

            # Cascade-delete the sibling leg of a wallet transfer so neither
            # side is left as an orphaned half-transaction.
            if existing and existing.transfer_group_id:
                siblings = await self.transaction_repo.get_by_transfer_group(
                    str(existing.transfer_group_id), user_id
                )
                for sibling in siblings:
                    if str(sibling.id) != str(transaction_id):
                        await self.transaction_repo.soft_delete(
                            str(sibling.id), user_id
                        )

            logger.info(f"Transaction deleted: {transaction_id} by user: {user_id}")

        return success

    async def _get_loan(self, loan_id: str, user_id: str):
        import uuid as _uuid
        from sqlalchemy import select, and_
        from app.modules.loans.models import DebtAccount

        result = await self.transaction_repo.db.execute(
            select(DebtAccount).where(
                and_(
                    DebtAccount.id == _uuid.UUID(str(loan_id)),
                    DebtAccount.user_id == _uuid.UUID(str(user_id)),
                    DebtAccount.is_deleted == False,
                )
            )
        )
        return result.scalar_one_or_none()

    async def _loan_payment_cap(
        self,
        loan_id: str,
        reduction: Decimal,
        user_id: str,
        already_applied: Decimal = Decimal("0"),
    ) -> Optional[Decimal]:
        """The principal to record when a linked payment is bigger than what is left.

        The form has no principal field, so a final payment that includes interest
        (3,200 against 3,000 left) is normal. _apply_loan_payment clamps the balance
        at 0, and without recording what actually came off, deleting the payment
        later added the full 3,200 back. Returns None when the payment fits.
        """
        loan = await self._get_loan(loan_id, user_id)
        if loan is None:
            return None
        room = loan.current_balance + already_applied
        if room <= 0:
            raise ValueError(f"{loan.name} is already paid off")
        return room if reduction > room else None

    async def _apply_loan_payment(
        self, loan_id: str, reduction: Decimal, user_id: str
    ) -> None:
        """Increase or decrease a loan's current_balance by `reduction`.

        Positive reduction = payment (balance goes down).
        Negative reduction = reversal (balance goes back up).
        """
        from app.modules.loans.models import LoanStatus

        db = self.transaction_repo.db
        loan = await self._get_loan(loan_id, user_id)
        if not loan:
            logger.warning(f"Loan {loan_id} not found for balance sync — skipping")
            return

        new_balance = (loan.current_balance - reduction).quantize(Decimal("0.01"))
        # Clamp to [0, principal_amount] to avoid negative or over-restored balances
        loan.current_balance = max(
            Decimal("0.00"), min(new_balance, loan.principal_amount)
        )

        if loan.current_balance <= 0 and reduction > 0:
            loan.current_balance = Decimal("0.00")
            loan.status = LoanStatus.PAID_OFF
            logger.info(f"Loan {loan_id} fully paid off via transaction")
        elif loan.status == LoanStatus.PAID_OFF and reduction < 0:
            # Reversal of a payment that triggered paid-off — re-activate
            loan.status = LoanStatus.ACTIVE

        await db.commit()
        logger.info(
            f"Loan {loan_id} balance updated by -{reduction}: new_balance={loan.current_balance}"
        )

    async def bulk_create_transactions(
        self, bulk_data: BulkTransactionCreate, user_id: str
    ) -> BulkTransactionResponse:
        """Bulk create transactions with validation and error handling"""

        created_transactions = []
        errors = []
        skipped = 0

        for i, transaction_data in enumerate(bulk_data.transactions):
            try:
                # Check for duplicates if enabled
                if bulk_data.skip_duplicates:
                    is_duplicate = await self._check_duplicate_transaction(
                        user_id, transaction_data
                    )
                    if is_duplicate:
                        skipped += 1
                        continue

                # Create transaction
                result = await self.create_transaction(transaction_data, user_id)
                created_transactions.append(result["transaction"])

            except Exception as e:
                logger.error(f"Error creating transaction {i}: {str(e)}")
                errors.append(
                    {
                        "index": i,
                        "error": str(e),
                        # mode="json" — this gets persisted into a JSON column
                        # (see ImportExportService.import_csv); the default
                        # model_dump() leaves Decimal/date objects raw, which
                        # crashes json serialization and rolls back the whole
                        # batch (losing any rows that succeeded before it).
                        "transaction_data": transaction_data.model_dump(mode="json"),
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
        self,
        user_id: str,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> TransactionAnalytics:
        """Get comprehensive transaction analytics with caching"""

        # Default to last 12 months if no dates provided
        if not date_to:
            date_to = business_today()
        if not date_from:
            date_from = date_to - timedelta(days=365)

        # These six queries all run on this request's single AsyncSession, so
        # they must run one at a time. Gathering them was not just a no-op — a
        # session that has not yet checked out a connection raises
        # "This session is provisioning a new connection; concurrent operations
        # are not permitted" and 500s the endpoint, and the half-opened
        # transaction then breaks session teardown too. An AsyncSession is not
        # a concurrency primitive; parallelising these would mean a session per
        # query, and it does not pay: measured against the heaviest account
        # (2,641 transactions) the whole set is ~12ms sequential versus ~14ms
        # with five pooled connections, because the checkout costs more than
        # the queries do.
        summary = await self.transaction_repo.get_summary(user_id, date_from, date_to)
        category_breakdown = await self.transaction_repo.get_category_breakdown(
            user_id, date_from, date_to
        )
        monthly_trends = await self.transaction_repo.get_monthly_trends(user_id, 12)
        payment_breakdown = await self.transaction_repo.get_payment_method_breakdown(
            user_id, date_from, date_to
        )
        top_merchants = await self.transaction_repo.get_top_merchants(
            user_id, date_from, date_to, 10
        )

        # Add period info to summary
        summary.update({"period_start": date_from, "period_end": date_to})

        # Per currency, natively and in TWD. This was one row labelled USD
        # holding the summary's TWD total.
        currency_breakdown = await self.transaction_repo.get_currency_breakdown(
            user_id, date_from, date_to
        )

        analytics = TransactionAnalytics(
            summary=summary,
            category_breakdown=category_breakdown,
            monthly_trends=monthly_trends,
            payment_method_breakdown=payment_breakdown,
            top_merchants=top_merchants,
            currency_breakdown=currency_breakdown,
        )

        return analytics

    async def get_page_stats(
        self,
        user_id: str,
        filter_params: TransactionFilter,
    ) -> Dict[str, Any]:
        """Aggregate stats for the transactions page, normalized to TWD.

        Replaces the frontend's fetch-all-then-reduce approach: per-currency sums
        come from single aggregate queries and are converted with live FX rates,
        matching the client's old toTWD() normalization.
        """
        from app.utils.exchange_rate_service import ExchangeRateService

        fx = ExchangeRateService(self.transaction_repo.db)

        # Breakdown for the category dropdown ignores the category/wallet filters
        # (mirrors the old client behavior of deriving it from the raw fetch).
        # `exclude_transfers` is cleared too: the dropdown lists what the user can
        # filter BY, so hiding transfers from the totals must not also take the
        # Transfer chip off the panel — with it selected, that left every card at
        # NT$0 and no way to unselect from the panel.
        dropdown_filters = filter_params.model_copy(
            update={"category_ids": None, "wallet_type": None, "exclude_transfers": False}
        )
        expense_filters = filter_params.model_copy(
            update={"type": TransactionType.EXPENSE}
        )
        # If the user is filtering to a non-expense type, the expense breakdown
        # must be empty — the pie has to agree with the (type-filtered) stat
        # cards, not silently override the filter.
        expense_breakdown_applies = (
            filter_params.type is None
            or filter_params.type == TransactionType.EXPENSE
        )

        # Sequential on purpose: these five aggregates share one AsyncSession,
        # which is not safe for concurrent use. Each is a single indexed query.
        summary_rows = await self.transaction_repo.get_filtered_summary(
            user_id, filter_params
        )
        dropdown_breakdown = await self.transaction_repo.get_filtered_category_breakdown(
            user_id, dropdown_filters
        )
        expense_breakdown = (
            await self.transaction_repo.get_filtered_category_breakdown(
                user_id, expense_filters
            )
            if expense_breakdown_applies
            else []
        )
        top_expense_rows = await self.transaction_repo.get_top_transactions(
            user_id, filter_params, TransactionType.EXPENSE, limit=20
        )
        top_income_rows = await self.transaction_repo.get_top_transactions(
            user_id, filter_params, TransactionType.INCOME, limit=20
        )

        # Resolve each distinct currency's rate once
        currencies = {row["currency"] for row in summary_rows}
        currencies.update(row["currency"] for row in dropdown_breakdown)
        currencies.update(row["currency"] for row in expense_breakdown)
        currencies.update(t.currency for t in top_expense_rows)
        currencies.update(t.currency for t in top_income_rows)

        rates: Dict[str, Decimal] = {}
        for cur in currencies:
            rate = await fx.get_exchange_rate(cur or "TWD", "TWD")
            rates[cur] = rate if rate is not None else Decimal("1")

        def to_twd(amount: Decimal, currency: str) -> float:
            return float((amount or Decimal("0")) * rates.get(currency, Decimal("1")))

        total_income = sum(to_twd(r["income"], r["currency"]) for r in summary_rows)
        total_expenses = sum(to_twd(r["expenses"], r["currency"]) for r in summary_rows)
        total_amount = sum(to_twd(r["total_amount"], r["currency"]) for r in summary_rows)
        transaction_count = sum(r["transaction_count"] for r in summary_rows)

        def merge_breakdown(rows: List[dict]) -> List[dict]:
            merged: Dict[tuple, dict] = {}
            for row in rows:
                key = (row["category"], row["type"])
                if key not in merged:
                    merged[key] = {
                        "category": row["category"],
                        "type": row["type"],
                        "amount": 0.0,
                    }
                merged[key]["amount"] += to_twd(row["amount"], row["currency"])
            return sorted(merged.values(), key=lambda r: r["amount"], reverse=True)

        def top_by_twd(rows: List[Transaction], limit: int = 5) -> List[Transaction]:
            return sorted(
                rows, key=lambda t: to_twd(t.amount, t.currency), reverse=True
            )[:limit]

        return {
            "stats": {
                "total_income": total_income,
                "total_expenses": total_expenses,
                "net_income": total_income - total_expenses,
                "transaction_count": transaction_count,
                "avg_transaction_amount": (
                    total_amount / transaction_count if transaction_count else 0.0
                ),
            },
            "category_breakdown": merge_breakdown(dropdown_breakdown),
            "expense_category_breakdown": merge_breakdown(expense_breakdown),
            "top_expenses": top_by_twd(top_expense_rows),
            "top_income": top_by_twd(top_income_rows),
            "currency": "TWD",
        }

    async def _check_duplicate_transaction(
        self, user_id: str, transaction_data: TransactionCreate
    ) -> bool:
        """Check if a similar transaction already exists"""

        # Look for transactions with same amount, date, and similar description
        filter_params = TransactionFilter(
            amount_min=transaction_data.amount,
            amount_max=transaction_data.amount,
            date_from=transaction_data.transaction_date,
            date_to=transaction_data.transaction_date,
            search=transaction_data.description[:50],  # Partial description match
        )

        transactions, _ = await self.transaction_repo.get_all(
            user_id=user_id, filter_params=filter_params, limit=5
        )

        # Check for exact matches
        for transaction in transactions:
            if (
                transaction.amount == transaction_data.amount
                and transaction.transaction_date == transaction_data.transaction_date
                and transaction.description.lower()
                == transaction_data.description.lower()
            ):
                return True

        return False


class CategorizationService:
    """Service for automatic transaction categorization"""

    def __init__(
        self,
        transaction_repo: TransactionRepository,
        category_repo: TransactionCategoryRepository,
    ):
        self.transaction_repo = transaction_repo
        self.category_repo = category_repo

        # Merchant patterns for categorization
        self.merchant_patterns = {
            # Food & Dining
            "food_dining": [
                r"restaurant",
                r"cafe",
                r"coffee",
                r"pizza",
                r"burger",
                r"mcdonald",
                r"kfc",
                r"subway",
                r"starbucks",
                r"grab.*food",
                r"foodpanda",
                r"deliveroo",
                r"uber.*eats",
                r"zomato",
                r"老字号",
                r"茶餐厅",
            ],
            # Groceries
            "groceries": [
                r"supermarket",
                r"grocery",
                r"market",
                r"fairprice",
                r"cold storage",
                r"giant",
                r"tesco",
                r"carrefour",
                r"walmart",
                r"aeon",
                r"超市",
                r"便利店",
            ],
            # Transportation
            "transportation": [
                r"uber",
                r"grab",
                r"taxi",
                r"bus",
                r"mrt",
                r"train",
                r"parking",
                r"petrol",
                r"gas station",
                r"shell",
                r"caltex",
                r"esso",
                r"出租车",
            ],
            # Shopping
            "shopping": [
                r"mall",
                r"shopping",
                r"lazada",
                r"shopee",
                r"amazon",
                r"uniqlo",
                r"h&m",
                r"zara",
                r"nike",
                r"adidas",
                r"apple store",
                r"商场",
            ],
            # Healthcare
            "healthcare": [
                r"clinic",
                r"hospital",
                r"pharmacy",
                r"doctor",
                r"dental",
                r"guardian",
                r"watsons",
                r"医院",
                r"诊所",
                r"药店",
            ],
            # Utilities
            "utilities": [
                r"electricity",
                r"water",
                r"internet",
                r"phone",
                r"cable",
                r"sp services",
                r"singtel",
                r"starhub",
                r"electric",
                r"水电费",
            ],
        }

    async def auto_categorize(
        self,
        description: str,
        amount: Optional[Decimal] = None,
        merchant_name: Optional[str] = None,
        payment_method: Optional[PaymentMethod] = None,
        user_id: Optional[str] = None,
    ) -> AutoCategorizationResponse:
        """Auto-categorize a transaction based on various signals"""

        suggestions = []

        # Get all active categories
        categories = await self.category_repo.get_all()
        category_map = {cat.id: cat for cat in categories}

        # 1. Rule-based categorization using merchant patterns
        rule_suggestions = self._categorize_by_rules(
            description, merchant_name, categories
        )
        suggestions.extend(rule_suggestions)

        # 2. Machine learning-based categorization using similar transactions
        if user_id:
            ml_suggestions = await self._categorize_by_similarity(
                user_id, description, amount, merchant_name, categories
            )
            suggestions.extend(ml_suggestions)

        # 3. Keyword-based categorization using category keywords
        keyword_suggestions = self._categorize_by_keywords(
            description, merchant_name, categories
        )
        suggestions.extend(keyword_suggestions)

        # 4. Amount-based heuristics
        amount_suggestions = self._categorize_by_amount(
            amount, payment_method, categories
        )
        suggestions.extend(amount_suggestions)

        # Deduplicate and sort by confidence
        unique_suggestions = {}
        for suggestion in suggestions:
            if suggestion.category_id not in unique_suggestions:
                unique_suggestions[suggestion.category_id] = suggestion
            else:
                # Keep the one with higher confidence
                if (
                    suggestion.confidence
                    > unique_suggestions[suggestion.category_id].confidence
                ):
                    unique_suggestions[suggestion.category_id] = suggestion

        sorted_suggestions = sorted(
            unique_suggestions.values(), key=lambda x: x.confidence, reverse=True
        )[
            :5
        ]  # Top 5 suggestions

        primary_suggestion = sorted_suggestions[0] if sorted_suggestions else None

        response = AutoCategorizationResponse(
            suggestions=sorted_suggestions, primary_suggestion=primary_suggestion
        )

        return response

    def _categorize_by_rules(
        self, description: str, merchant_name: Optional[str], categories: List
    ) -> List[CategorizationSuggestion]:
        """Rule-based categorization using merchant patterns"""

        suggestions = []
        text_to_analyze = f"{description} {merchant_name or ''}".lower()

        category_mapping = {
            "food_dining": "Food & Dining",
            "groceries": "Groceries",
            "transportation": "Transportation",
            "shopping": "Shopping",
            "healthcare": "Healthcare",
            "utilities": "Utilities",
        }

        for pattern_category, patterns in self.merchant_patterns.items():
            for pattern in patterns:
                if re.search(pattern, text_to_analyze, re.IGNORECASE):
                    # Find matching category
                    category_name = category_mapping.get(pattern_category)
                    matching_category = next(
                        (
                            cat
                            for cat in categories
                            if cat.name == category_name
                            and cat.type == TransactionType.EXPENSE
                        ),
                        None,
                    )

                    if matching_category:
                        confidence = 0.8  # High confidence for rule-based matching
                        suggestions.append(
                            CategorizationSuggestion(
                                category_id=matching_category.id,
                                category_name=matching_category.name,
                                confidence=Decimal(str(confidence)),
                                reasons=[f"Matched pattern: {pattern}"],
                            )
                        )
                        break  # Only add one suggestion per pattern category

        return suggestions

    async def _categorize_by_similarity(
        self,
        user_id: str,
        description: str,
        amount: Optional[Decimal],
        merchant_name: Optional[str],
        categories: List,
    ) -> List[CategorizationSuggestion]:
        """ML-based categorization using similar transactions"""

        suggestions = []

        # Find similar transactions
        similar_transactions = await self.transaction_repo.search_similar_transactions(
            user_id=user_id, description=description, amount=amount, limit=5
        )

        if similar_transactions:
            # Count category frequency
            category_counts = {}
            for transaction in similar_transactions:
                category_id = transaction.category_id
                if category_id not in category_counts:
                    category_counts[category_id] = 0
                category_counts[category_id] += 1

            # Create suggestions based on frequency
            total_similar = len(similar_transactions)
            for category_id, count in category_counts.items():
                category = next(
                    (cat for cat in categories if cat.id == category_id), None
                )
                if category:
                    confidence = min(
                        0.9, count / total_similar * 0.7 + 0.2
                    )  # 0.2-0.9 range
                    suggestions.append(
                        CategorizationSuggestion(
                            category_id=category_id,
                            category_name=category.name,
                            confidence=Decimal(str(confidence)),
                            reasons=[f"Similar to {count} previous transactions"],
                        )
                    )

        return suggestions

    def _categorize_by_keywords(
        self, description: str, merchant_name: Optional[str], categories: List
    ) -> List[CategorizationSuggestion]:
        """Keyword-based categorization using category keywords"""

        suggestions = []
        text_to_analyze = f"{description} {merchant_name or ''}".lower()

        for category in categories:
            if category.keywords:
                matches = 0
                matched_keywords = []

                for keyword in category.keywords:
                    if keyword.lower() in text_to_analyze:
                        matches += 1
                        matched_keywords.append(keyword)

                if matches > 0:
                    confidence = min(0.7, matches * 0.2 + 0.3)  # 0.3-0.7 range
                    suggestions.append(
                        CategorizationSuggestion(
                            category_id=category.id,
                            category_name=category.name,
                            confidence=Decimal(str(confidence)),
                            reasons=[
                                f"Matched keywords: {', '.join(matched_keywords)}"
                            ],
                        )
                    )

        return suggestions

    def _categorize_by_amount(
        self,
        amount: Optional[Decimal],
        payment_method: Optional[PaymentMethod],
        categories: List,
    ) -> List[CategorizationSuggestion]:
        """Amount and payment method-based heuristics"""

        suggestions = []

        if not amount:
            return suggestions

        # Amount-based heuristics
        amount_float = float(amount)

        # Small amounts might be food/coffee
        if amount_float < 20:
            food_category = next(
                (
                    cat
                    for cat in categories
                    if "food" in cat.name.lower() or "dining" in cat.name.lower()
                ),
                None,
            )
            if food_category:
                suggestions.append(
                    CategorizationSuggestion(
                        category_id=food_category.id,
                        category_name=food_category.name,
                        confidence=Decimal("0.4"),
                        reasons=["Small amount typical for food/beverages"],
                    )
                )

        # Payment method heuristics
        if payment_method:
            if payment_method in [PaymentMethod.GRAB_PAY, PaymentMethod.WECHAT_PAY]:
                # These are often used for food delivery or transportation
                food_category = next(
                    (cat for cat in categories if "food" in cat.name.lower()), None
                )
                transport_category = next(
                    (cat for cat in categories if "transport" in cat.name.lower()), None
                )

                if food_category:
                    suggestions.append(
                        CategorizationSuggestion(
                            category_id=food_category.id,
                            category_name=food_category.name,
                            confidence=Decimal("0.5"),
                            reasons=[
                                f"Payment method {payment_method.value} often used for food"
                            ],
                        )
                    )

                if transport_category:
                    suggestions.append(
                        CategorizationSuggestion(
                            category_id=transport_category.id,
                            category_name=transport_category.name,
                            confidence=Decimal("0.5"),
                            reasons=[
                                f"Payment method {payment_method.value} often used for transport"
                            ],
                        )
                    )

        return suggestions


class RecurringTransactionService:
    """Service for recurring transaction management"""

    def __init__(
        self,
        recurring_repo: RecurringTransactionRepository,
        transaction_service: TransactionService,
    ):
        self.recurring_repo = recurring_repo
        self.transaction_service = transaction_service

    async def create_recurring_transaction(self, recurring_data: dict, user_id: str):
        """Create a new recurring transaction"""

        # Set initial next occurrence
        recurring_data["next_occurrence"] = recurring_data["start_date"]

        recurring = await self.recurring_repo.create(recurring_data, user_id)

        logger.info(
            f"Recurring transaction created: {recurring.id} for user: {user_id}"
        )

        return recurring

    async def process_due_transactions(
        self, max_date: Optional[date] = None
    ) -> Dict[str, int]:
        """Process recurring transactions that are due"""

        if not max_date:
            max_date = business_today()

        due_recurring = await self.recurring_repo.get_due_transactions(max_date)

        created_count = 0
        failed_count = 0

        for recurring in due_recurring:
            try:
                # Check if we should still create transactions
                if (
                    recurring.end_date
                    and recurring.next_occurrence > recurring.end_date
                ):
                    continue

                if recurring.next_occurrence < business_today():
                    logger.warning(
                        f"Recurring {recurring.id}: next_occurrence {recurring.next_occurrence} "
                        f"is in the past — advancing without creating a transaction"
                    )
                    next_occurrence = self._calculate_next_occurrence(
                        recurring.next_occurrence, recurring.frequency, recurring.interval
                    )
                    await self.recurring_repo.update_next_occurrence(recurring.id, next_occurrence)
                    continue

                if (
                    recurring.max_occurrences
                    and recurring.occurrence_count >= recurring.max_occurrences
                ):
                    continue

                # Create transaction data
                transaction_data = TransactionCreate(
                    type=recurring.type,
                    amount=recurring.amount,
                    currency=recurring.currency,
                    description=recurring.description,
                    transaction_date=recurring.next_occurrence,
                    category_id=recurring.category_id,
                    payment_method=recurring.payment_method,
                    recurring_transaction_id=recurring.id,
                    tags=recurring.tags,
                    notes=recurring.notes,
                )

                # Create the transaction
                if recurring.auto_create:
                    await self.transaction_service.create_transaction(
                        transaction_data, recurring.user_id
                    )
                    created_count += 1

                # Calculate next occurrence
                next_occurrence = self._calculate_next_occurrence(
                    recurring.next_occurrence, recurring.frequency, recurring.interval
                )

                # Update recurring transaction
                await self.recurring_repo.update_next_occurrence(
                    recurring.id, next_occurrence
                )

            except Exception as e:
                logger.error(
                    f"Failed to process recurring transaction {recurring.id}: {str(e)}"
                )
                failed_count += 1

        return {
            "processed": len(due_recurring),
            "created": created_count,
            "failed": failed_count,
        }

    def _calculate_next_occurrence(
        self, current_date: date, frequency: RecurringFrequency, interval: int
    ) -> date:
        """Calculate the next occurrence date"""

        if frequency == RecurringFrequency.DAILY:
            return current_date + timedelta(days=interval)
        elif frequency == RecurringFrequency.WEEKLY:
            return current_date + timedelta(weeks=interval)
        elif frequency == RecurringFrequency.MONTHLY:
            # Handle month boundaries properly
            year = current_date.year
            month = current_date.month + interval

            while month > 12:
                year += 1
                month -= 12

            # Handle day overflow (e.g., Jan 31 -> Feb 28/29)
            day = min(current_date.day, self._get_days_in_month(year, month))

            return date(year, month, day)
        elif frequency == RecurringFrequency.QUARTERLY:
            return self._calculate_next_occurrence(
                current_date, RecurringFrequency.MONTHLY, interval * 3
            )
        elif frequency == RecurringFrequency.YEARLY:
            return date(
                current_date.year + interval, current_date.month, current_date.day
            )
        else:
            return current_date + timedelta(days=1)  # Fallback

    def _get_days_in_month(self, year: int, month: int) -> int:
        """Get number of days in a month"""
        if month == 2:
            return (
                29 if (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0) else 28
            )
        elif month in [4, 6, 9, 11]:
            return 30
        else:
            return 31

    async def update_recurring_transaction(
        self, recurring_id: str, user_id: str, update_data: RecurringTransactionUpdate
    ):
        """Update a recurring transaction"""
        data = update_data.model_dump(exclude_unset=True)

        # Recalculate next occurrence if frequency or interval changed
        if "frequency" in data or "interval" in data or "start_date" in data:
            recurring = await self.recurring_repo.get_by_id(recurring_id, user_id)
            if recurring:
                frequency = data.get("frequency", recurring.frequency)
                interval = data.get("interval", recurring.interval)
                start_date = data.get("start_date", recurring.start_date)

                # Only update next occurrence if it hasn't been processed yet
                if recurring.occurrence_count == 0:
                    data["next_occurrence"] = start_date

        recurring = await self.recurring_repo.update(recurring_id, user_id, data)

        if recurring:
            logger.info(
                f"Recurring transaction updated: {recurring_id} by user: {user_id}"
            )

        return recurring

    async def delete_recurring_transaction(
        self, recurring_id: str, user_id: str
    ) -> bool:
        """Delete a recurring transaction"""
        success = await self.recurring_repo.delete(recurring_id, user_id)

        if success:
            logger.info(
                f"Recurring transaction deleted: {recurring_id} by user: {user_id}"
            )

        return success
