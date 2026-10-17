"""
FastAPI router for Loan / Debt Account endpoints.

All routes require authentication — no demo mode (debt is personal data).

Endpoints:
  GET    /loans              → list all loans + computed fields
  POST   /loans              → create a new loan
  GET    /loans/summary      → total debt summary (used by dashboard)
  GET    /loans/{id}         → single loan detail
  PUT    /loans/{id}         → update loan terms
  DELETE /loans/{id}         → soft-delete a loan
  POST   /loans/{id}/payment → record a monthly repayment
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.schemas import ApiResponse
from app.core.database import get_db
from app.modules.users.dependencies import CurrentUser
from app.modules.loans.schemas import (
    DebtAccountCreate,
    DebtAccountUpdate,
    DebtAccountResponse,
    DebtAccountSummary,
    LoanPaymentCreate,
    LoanPaymentResponse,
    LoanPaymentRecord,
    LoanPaymentUpdate,
)
from app.modules.loans.service import get_loan_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/summary", response_model=ApiResponse[DebtAccountSummary])
async def get_summary(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Total debt summary — used by the dashboard Net Worth calculation."""
    svc = get_loan_service(session)
    summary = await svc.get_summary(current_user.id)
    return ApiResponse.success_response(data=summary)


@router.get("/", response_model=ApiResponse[list[DebtAccountResponse]])
async def list_loans(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """List all loans for the current user with computed amortisation fields."""
    svc = get_loan_service(session)
    loans = await svc.list_loans(current_user.id)
    return ApiResponse.success_response(data=loans, message=f"{len(loans)} loan(s) found")


@router.post("/", response_model=ApiResponse[DebtAccountResponse], status_code=status.HTTP_201_CREATED)
async def create_loan(
    data: DebtAccountCreate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """
    Create a new debt account.

    Call this when you receive a bank loan — current_balance defaults to
    principal_amount if not provided. Record the corresponding cash inflow
    as a separate income Transaction in the Life Wallet.
    """
    svc = get_loan_service(session)
    try:
        loan = await svc.create_loan(current_user.id, data)
        return ApiResponse.success_response(data=loan, message="Loan created successfully")
    except Exception as e:
        logger.error(f"Error creating loan for user {current_user.id}: {e}", exc_info=True)
        raise


@router.get("/{loan_id}", response_model=ApiResponse[DebtAccountResponse])
async def get_loan(
    loan_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Get a single loan with computed amortisation fields."""
    svc = get_loan_service(session)
    try:
        loan = await svc.get_loan(current_user.id, loan_id)
        return ApiResponse.success_response(data=loan)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")


@router.put("/{loan_id}", response_model=ApiResponse[DebtAccountResponse])
async def update_loan(
    loan_id: UUID,
    data: DebtAccountUpdate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Update loan terms (interest rate, minimum payment, status, etc.)."""
    svc = get_loan_service(session)
    try:
        loan = await svc.update_loan(current_user.id, loan_id, data)
        return ApiResponse.success_response(data=loan, message="Loan updated")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")


@router.delete("/{loan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_loan(
    loan_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Soft-delete a loan. Payment history (transactions) is preserved."""
    svc = get_loan_service(session)
    try:
        await svc.delete_loan(current_user.id, loan_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")


@router.post("/{loan_id}/payment", response_model=ApiResponse[LoanPaymentResponse], status_code=status.HTTP_201_CREATED)
async def record_payment(
    loan_id: UUID,
    data: LoanPaymentCreate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """
    Record a monthly loan repayment.

    - Creates an expense Transaction in the Life Wallet linked to this loan
    - Reduces current_balance by principal_portion
    - Automatically marks the loan as paid_off when balance reaches zero

    The sum of principal_portion + interest_portion must equal total_amount.
    """
    svc = get_loan_service(session)
    try:
        result = await svc.record_payment(current_user.id, loan_id, data)
        msg = "Payment recorded — loan fully paid off!" if result.is_paid_off else "Payment recorded successfully"
        return ApiResponse.success_response(data=result, message=msg)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/{loan_id}/payments", response_model=ApiResponse[list[LoanPaymentRecord]])
async def list_payments(
    loan_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """List all recorded payments for a loan, newest first."""
    svc = get_loan_service(session)
    try:
        payments = await svc.list_payments(current_user.id, loan_id)
        return ApiResponse.success_response(data=payments)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")


@router.delete("/{loan_id}/payments/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_payment(
    loan_id: UUID,
    transaction_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Delete a recorded payment and restore the corresponding loan balance."""
    svc = get_loan_service(session)
    try:
        await svc.delete_payment(current_user.id, loan_id, transaction_id)
    except ValueError as e:
        status_code = status.HTTP_404_NOT_FOUND if "not found" in str(e).lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=str(e))


@router.put("/{loan_id}/payments/{transaction_id}", response_model=ApiResponse[LoanPaymentRecord])
async def update_payment(
    loan_id: UUID,
    transaction_id: UUID,
    data: LoanPaymentUpdate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Edit a recorded payment and recalculate the loan balance."""
    svc = get_loan_service(session)
    try:
        payment = await svc.update_payment(current_user.id, loan_id, transaction_id, data)
        return ApiResponse.success_response(data=payment, message="Payment updated")
    except ValueError as e:
        status_code = status.HTTP_404_NOT_FOUND if "Payment not found" in str(e) else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=str(e))
