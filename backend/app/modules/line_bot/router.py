"""
FastAPI router for the LINE Bot module.

Public endpoint (no JWT auth — LINE signs requests instead):
  POST /line-bot/webhook    ← LINE Messaging API delivers events here

Authenticated endpoints (JWT required — called by the Aspiro frontend):
  POST /line-bot/link-confirm   ← complete account linking after Google login
  GET  /line-bot/link-status    ← check whether the current user has linked LINE

Authenticated read endpoints:
  GET  /line-bot/groups/{group_id}/balances  ← net balances for a group
  GET  /line-bot/groups/{group_id}/expenses  ← expense history for a group
"""

import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.schemas import ApiResponse
from app.core.database import get_db
from app.modules.line_bot import schemas, service
from app.modules.line_bot.schemas import (
    ExpenseCreateRequest,
    ExpenseOut,
    ExpenseUpdateRequest,
    GroupBalanceResponse,
    GroupOut,
    LiffSessionRequest,
    LiffSessionResponse,
    LinkConfirmRequest,
    LinkConfirmResponse,
    LinkPreviewResponse,
    LinkStatusResponse,
    LineWebhookPayload,
    MemberOut,
    SettleRequest,
    SettleResponse,
)
from app.modules.users.dependencies import CurrentUser
from app.modules.users.dependencies import CurrentAdminUser

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public webhook (called by LINE platform)
# ---------------------------------------------------------------------------


@router.post(
    "/webhook",
    status_code=status.HTTP_200_OK,
    summary="LINE Messaging API webhook",
    include_in_schema=False,
)
async def line_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_line_signature: str = Header(..., alias="X-Line-Signature"),
) -> dict:
    body = await request.body()

    if not service.verify_line_signature(body, x_line_signature):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature")

    try:
        payload = LineWebhookPayload.model_validate_json(body)
    except Exception as exc:
        logger.warning("Malformed LINE webhook payload: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed payload")

    # Ack LINE immediately, then process events after the 200. A slow handler
    # (LINE API round-trips + DB writes) must not delay the ack, or LINE times
    # out and re-delivers the batch — which, since handling isn't idempotent,
    # would double-record /add and /txn entries. The background task opens its
    # own DB session (this request's session is closed once the response is sent).
    background_tasks.add_task(service.process_webhook_events, payload.events)

    return {}


# ---------------------------------------------------------------------------
# Public: LIFF session exchange (LINE ID token -> Aspiro access token)
# ---------------------------------------------------------------------------


@router.post(
    "/liff/session",
    response_model=ApiResponse[LiffSessionResponse],
    summary="Exchange a LIFF LINE ID token for an Aspiro session",
)
async def liff_session(
    body: LiffSessionRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[LiffSessionResponse]:
    try:
        result = await service.liff_session(db, body.id_token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return ApiResponse.success_response(data=result)


# ---------------------------------------------------------------------------
# Authenticated: account linking
# ---------------------------------------------------------------------------


@router.get(
    "/link-preview",
    response_model=ApiResponse[LinkPreviewResponse],
    summary="Show which LINE account a link token would attach",
)
async def link_preview(
    token: UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[LinkPreviewResponse]:
    try:
        result = await service.link_preview(db, token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return ApiResponse.success_response(data=result)


@router.post(
    "/link-confirm",
    response_model=ApiResponse[LinkConfirmResponse],
    summary="Complete LINE account linking after Aspiro login",
)
async def link_confirm(
    body: LinkConfirmRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[LinkConfirmResponse]:
    display_name = getattr(current_user, "display_name", None) or current_user.email.split("@")[0]
    try:
        result = await service.confirm_link(db, body.token, current_user.id, display_name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    await db.commit()
    await service.push_link_confirmation(result.line_user_id, display_name)
    return ApiResponse.success_response(data=result, message="LINE account linked successfully")


@router.get(
    "/link-status",
    response_model=ApiResponse[LinkStatusResponse],
    summary="Check whether the current user has linked a LINE account",
)
async def link_status(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[LinkStatusResponse]:
    result = await service.get_link_status(db, current_user.id)
    return ApiResponse.success_response(data=result)


@router.delete(
    "/link",
    response_model=ApiResponse[None],
    summary="Unlink the current user's LINE account",
)
async def unlink_line(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await service.unlink(db, current_user.id)
    return ApiResponse.success_response(data=None, message="LINE account unlinked")


@router.get(
    "/activity",
    response_model=ApiResponse[list[schemas.LineBotActivityOut]],
    summary="Recent LINE bot activity for the current user",
)
async def get_activity(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
) -> ApiResponse[list[schemas.LineBotActivityOut]]:
    activities = await service.get_recent_activity(db, current_user.id, limit)
    return ApiResponse.success_response(data=[schemas.LineBotActivityOut.model_validate(a) for a in activities])


# ---------------------------------------------------------------------------
# Authenticated: group data
# ---------------------------------------------------------------------------


@router.get(
    "/groups",
    response_model=ApiResponse[list[GroupOut]],
    summary="List LINE expense groups the current user belongs to",
)
async def list_groups(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[list[GroupOut]]:
    result = await service.get_user_groups(db, current_user.id)
    return ApiResponse.success_response(data=result)


@router.get(
    "/groups/{group_id}/balances",
    response_model=ApiResponse[GroupBalanceResponse],
    summary="Net balances for a LINE expense group",
)
async def group_balances(
    group_id: UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[GroupBalanceResponse]:
    await service.assert_group_member(db, group_id, current_user.id)
    result = await service.compute_balances(db, group_id)
    return ApiResponse.success_response(data=result)


@router.get(
    "/groups/{group_id}/members",
    response_model=ApiResponse[list[MemberOut]],
    summary="List members of a LINE expense group with display names",
)
async def group_members(
    group_id: UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[list[MemberOut]]:
    await service.assert_group_member(db, group_id, current_user.id)
    result = await service.get_group_members_with_names(db, group_id, current_user.id)
    return ApiResponse.success_response(data=result)


@router.get(
    "/groups/{group_id}/expenses",
    response_model=ApiResponse[list[schemas.ExpenseOut]],
    summary="Expense history for a LINE expense group",
)
async def group_expenses(
    group_id: UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiResponse[list[schemas.ExpenseOut]]:
    await service.assert_group_member(db, group_id, current_user.id)
    result = await service.get_group_expenses(db, group_id, limit=limit, offset=offset)
    return ApiResponse.success_response(data=result)


# ---------------------------------------------------------------------------
# Authenticated: group mutations (write endpoints called by the frontend)
# ---------------------------------------------------------------------------


@router.post(
    "/groups/{group_id}/expenses",
    response_model=ApiResponse[ExpenseOut],
    status_code=status.HTTP_201_CREATED,
    summary="Add a shared expense to a LINE expense group",
)
async def add_group_expense(
    group_id: UUID,
    body: ExpenseCreateRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ExpenseOut]:
    result = await service.web_add_expense(db, group_id, current_user.id, body)
    return ApiResponse.success_response(data=result, message="Expense added")


@router.patch(
    "/groups/{group_id}/expenses/{expense_id}",
    response_model=ApiResponse[ExpenseOut],
    summary="Edit an existing shared expense in a LINE expense group",
)
async def update_group_expense(
    group_id: UUID,
    expense_id: UUID,
    body: ExpenseUpdateRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ExpenseOut]:
    result = await service.web_update_expense(
        db, group_id, expense_id, current_user.id, body
    )
    return ApiResponse.success_response(data=result, message="Expense updated")


@router.delete(
    "/groups/{group_id}/expenses/{expense_id}",
    response_model=ApiResponse[None],
    summary="Delete a shared expense from a LINE expense group",
)
async def delete_group_expense(
    group_id: UUID,
    expense_id: UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await service.web_delete_expense(db, group_id, expense_id, current_user.id)
    return ApiResponse.success_response(data=None, message="Expense deleted")


@router.post(
    "/groups/{group_id}/settle",
    response_model=ApiResponse[SettleResponse],
    summary="Settle a debt between two members of a LINE expense group",
)
async def settle_group_debt(
    group_id: UUID,
    body: SettleRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[SettleResponse]:
    result = await service.web_settle(db, group_id, current_user.id, body)
    return ApiResponse.success_response(data=result, message="Debt settled")


# ---------------------------------------------------------------------------
# Rich menu (admin only)
# ---------------------------------------------------------------------------


@router.post(
    "/rich-menu/setup",
    response_model=ApiResponse[dict],
    summary="Create and activate the Aspiro rich menu for all LINE users (admin only)",
)
async def setup_rich_menu(
    _admin: CurrentAdminUser,
) -> ApiResponse[dict]:
    try:
        result = await service.setup_rich_menu()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return ApiResponse.success_response(
        data=result,
        message="Rich menu created. Upload your menu image to the returned image_upload_url.",
    )
