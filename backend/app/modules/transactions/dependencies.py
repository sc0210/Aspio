"""
Dependencies for transaction module in the Aspiro personal finance application.
Provides dependency injection for repositories and services.
"""

from functools import lru_cache
from typing import Annotated
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from .repositories import TransactionRepository, TransactionCategoryRepository, RecurringTransactionRepository
from .services import TransactionService, CategorizationService, RecurringTransactionService
from .attachment_service import AttachmentService, ImportExportService


# Repository dependencies
async def get_transaction_repository(
    db: AsyncSession = Depends(get_db)
) -> TransactionRepository:
    """Get transaction repository instance"""
    return TransactionRepository(db)


async def get_category_repository(
    db: AsyncSession = Depends(get_db)
) -> TransactionCategoryRepository:
    """Get transaction category repository instance"""
    return TransactionCategoryRepository(db)


async def get_recurring_repository(
    db: AsyncSession = Depends(get_db)
) -> RecurringTransactionRepository:
    """Get recurring transaction repository instance"""
    return RecurringTransactionRepository(db)


# Service dependencies
async def get_categorization_service(
    transaction_repo: TransactionRepository = Depends(get_transaction_repository),
    category_repo: TransactionCategoryRepository = Depends(get_category_repository),
) -> CategorizationService:
    """Get categorization service instance"""
    return CategorizationService(transaction_repo, category_repo)


async def get_transaction_service(
    transaction_repo: TransactionRepository = Depends(get_transaction_repository),
    category_repo: TransactionCategoryRepository = Depends(get_category_repository),
    recurring_repo: RecurringTransactionRepository = Depends(get_recurring_repository),
) -> TransactionService:
    """Get transaction service instance"""
    return TransactionService(transaction_repo, category_repo, recurring_repo)


async def get_recurring_service(
    recurring_repo: RecurringTransactionRepository = Depends(get_recurring_repository),
    transaction_service: TransactionService = Depends(get_transaction_service)
) -> RecurringTransactionService:
    """Get recurring transaction service instance"""
    return RecurringTransactionService(recurring_repo, transaction_service)


# Additional service dependencies
async def get_attachment_service(
    db: AsyncSession = Depends(get_db),
    transaction_repo: TransactionRepository = Depends(get_transaction_repository)
) -> AttachmentService:
    """Get attachment service instance"""
    return AttachmentService(db, transaction_repo)


async def get_import_export_service(
    db: AsyncSession = Depends(get_db),
    transaction_service: TransactionService = Depends(get_transaction_service)
) -> ImportExportService:
    """Get import/export service instance"""
    return ImportExportService(db, transaction_service)




# Type aliases for dependency injection
TransactionRepoDepends = Annotated[TransactionRepository, Depends(get_transaction_repository)]
CategoryRepoDepends = Annotated[TransactionCategoryRepository, Depends(get_category_repository)]
RecurringRepoDepends = Annotated[RecurringTransactionRepository, Depends(get_recurring_repository)]
TransactionServiceDepends = Annotated[TransactionService, Depends(get_transaction_service)]
CategorizationServiceDepends = Annotated[CategorizationService, Depends(get_categorization_service)]
RecurringServiceDepends = Annotated[RecurringTransactionService, Depends(get_recurring_service)]
AttachmentServiceDepends = Annotated[AttachmentService, Depends(get_attachment_service)]
ImportExportServiceDepends = Annotated[ImportExportService, Depends(get_import_export_service)]
