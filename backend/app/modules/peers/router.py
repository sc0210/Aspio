"""
FastAPI router for peer-comparison and shared-goals endpoints.

All routes require authentication.

Endpoints:
  GET    /peers/search?username=                          → search for a user by exact username
  POST   /peers/invite                                    → send a peer invite
  GET    /peers/                                          → list the caller's connections
  PATCH  /peers/{id}/respond                              → accept or decline an invite
  DELETE /peers/{id}                                      → remove a connection
  GET    /peers/compare-data                              → wallet-comparison data (self + peers)

  GET    /peers/goals                                     → list active and completed shared goals for the caller
  POST   /peers/goals                                     → create a shared goal
  GET    /peers/goals/{goal_id}                           → get a single shared goal
  PATCH  /peers/goals/{goal_id}                           → edit title, target or date (either participant)
  DELETE /peers/goals/{goal_id}                           → delete a shared goal (creator only)

  GET    /peers/goals/{goal_id}/records                   → list saving records for a goal
  POST   /peers/goals/{goal_id}/records                   → add a saving record
  PATCH  /peers/goals/{goal_id}/records/{record_id}       → update a saving record (owner only)
  DELETE /peers/goals/{goal_id}/records/{record_id}       → delete a saving record (owner only)

  POST   /peers/splits                                    → split a bill with a partner
  GET    /peers/splits                                    → list your split bills
  GET    /peers/splits/balances                           → what each partner owes / is owed
  GET    /peers/splits/{split_id}                         → one split
  POST   /peers/splits/{split_id}/respond                 → accept or decline (the partner)
  POST   /peers/splits/{split_id}/void                    → withdraw before an answer (the creator)
  POST   /peers/splits/{split_id}/cancel                  → cancel an accepted split (the payer)
  GET    /peers/{id}/prefs, PATCH /peers/{id}/prefs       → your split policy for this partner
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.schemas import ApiResponse
from app.core.database import get_db
from app.modules.peers.schemas import (
    CompareDataResponse,
    PeerConnectionOut,
    PeerInviteRequest,
    PeerRespondRequest,
    SavingRecordCreate,
    SavingRecordOut,
    SavingRecordUpdate,
    SharedGoalUpdate,
    SharedGoalCreate,
    SharedGoalOut,
    UserSearchResult,
    PeerBalanceOut,
    PeerPrefsOut,
    PeerPrefsUpdate,
    AmendmentRespond,
    RecurringSplitCreate,
    RecurringSplitOut,
    SettlementCreate,
    SettlementOut,
    SplitAmend,
    SettlementRespond,
    SplitCreate,
    SplitFromTransaction,
    SplitOut,
    SplitRespond,
)
from app.modules.peers.service import get_peer_service
from app.modules.peers.splits import SplitService
from app.modules.users.dependencies import CurrentUser

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get(
    "/search",
    response_model=ApiResponse[UserSearchResult | None],
    summary="Search for a user by username",
)
async def search_user(
    current_user: CurrentUser,
    username: str = Query(..., min_length=1, max_length=30),
    session: AsyncSession = Depends(get_db),
):
    """Return the public profile of a user whose username matches exactly.

    Returns ``null`` in ``data`` if no matching user is found.
    """
    svc = get_peer_service(session)
    result = await svc.search_user(username, current_user.id)
    found = result is not None
    return ApiResponse.success_response(
        data=result,
        message="User found" if found else "No user found with that username",
    )


@router.post(
    "/invite",
    response_model=ApiResponse[PeerConnectionOut],
    status_code=status.HTTP_201_CREATED,
    summary="Send a peer invite",
)
async def send_invite(
    body: PeerInviteRequest,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Invite another user to become a peer by their username.

    Raises:
      - 404 if the username does not exist
      - 400 if the requester already has 2 accepted peers
      - 409 if a pending or accepted connection already exists
    """
    svc = get_peer_service(session)
    conn = await svc.send_invite(current_user.id, body.username)
    # Build the output — fetch the receiver's profile from the connection
    out = await _build_connection_out(conn, current_user.id, session)
    return ApiResponse.success_response(data=out, message="Peer invite sent")


@router.get(
    "/compare-data",
    response_model=ApiResponse[CompareDataResponse],
    summary="Get wallet comparison data for self and accepted peers",
)
async def get_compare_data(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Return the wallet comparison payload.

    Includes the calling user and up to 2 accepted peers.
    The ``chart`` array contains a single snapshot point (current net-worth).
    """
    svc = get_peer_service(session)
    data = await svc.get_compare_data(current_user.id)
    return ApiResponse.success_response(data=data)


@router.get(
    "/",
    response_model=ApiResponse[list[PeerConnectionOut]],
    summary="List all peer connections for the current user",
)
async def list_connections(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Return all non-removed connections (both sent and received)."""
    svc = get_peer_service(session)
    connections = await svc.list_connections(current_user.id)
    return ApiResponse.success_response(
        data=connections,
        message=f"{len(connections)} connection(s) found",
    )


# ---------------------------------------------------------------------------
# Shared goals — must be registered BEFORE /{connection_id} routes so that
# FastAPI does not mistake "goals" for a UUID path parameter.
# ---------------------------------------------------------------------------


@router.get(
    "/goals",
    response_model=ApiResponse[list[SharedGoalOut]],
    summary="List active shared goals for the current user",
)
async def list_goals(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Return all active shared savings goals in which the caller participates.

    Goals are ordered newest-first.  The ``your_amount`` / ``peer_amount``
    fields in each item are oriented to the calling user.
    """
    svc = get_peer_service(session)
    goals = await svc.list_goals(current_user.id)
    return ApiResponse.success_response(
        data=goals,
        message=f"{len(goals)} active goal(s) found",
    )


@router.post(
    "/goals",
    response_model=ApiResponse[SharedGoalOut],
    status_code=status.HTTP_201_CREATED,
    summary="Create a shared savings goal",
)
async def create_goal(
    body: SharedGoalCreate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Create a shared savings goal on an accepted peer connection.

    Raises:
      - 404 if the connection does not exist or the caller is not a participant
      - 400 if the connection is not in 'accepted' status
      - 400 if the connection already has 10 goals
    """
    svc = get_peer_service(session)
    goal = await svc.create_goal(current_user.id, body)
    return ApiResponse.success_response(data=goal, message="Shared goal created")


@router.get(
    "/goals/{goal_id}",
    response_model=ApiResponse[SharedGoalOut],
    summary="Get a single shared goal",
)
async def get_goal(
    goal_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Return a single shared goal by ID.

    Raises 404 if the goal does not exist or the caller is not a participant.
    """
    svc = get_peer_service(session)
    goal = await svc.get_goal(current_user.id, goal_id)
    return ApiResponse.success_response(data=goal)


@router.patch(
    "/goals/{goal_id}",
    response_model=ApiResponse[SharedGoalOut],
    summary="Edit a shared goal's title, target or date",
)
async def update_goal(
    goal_id: UUID,
    body: SharedGoalUpdate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Either participant may edit. Raising the target re-opens a completed goal.

    Raises:
      - 404 if the goal is not found or the caller is not a participant
      - 400 if the goal is cancelled
    """
    svc = get_peer_service(session)
    goal = await svc.update_goal(current_user.id, goal_id, body)
    return ApiResponse.success_response(data=goal, message="Goal updated")


@router.delete(
    "/goals/{goal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a shared goal (creator only)",
)
async def delete_goal(
    goal_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Permanently delete a shared goal.

    Only the user who created the goal may delete it.

    Raises:
      - 404 if the goal does not exist
      - 403 if the caller is not the creator
    """
    svc = get_peer_service(session)
    await svc.delete_goal(current_user.id, goal_id)


@router.get(
    "/goals/{goal_id}/records",
    response_model=ApiResponse[list[SavingRecordOut]],
    summary="List saving records for a shared goal",
)
async def list_records(
    goal_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Return all saving records for a goal, newest first.

    Both participants may view records.

    Raises 404 if the goal does not exist or the caller is not a participant.
    """
    svc = get_peer_service(session)
    records = await svc.list_records(current_user.id, goal_id)
    return ApiResponse.success_response(
        data=records,
        message=f"{len(records)} record(s) found",
    )


@router.post(
    "/goals/{goal_id}/records",
    response_model=ApiResponse[SavingRecordOut],
    status_code=status.HTTP_201_CREATED,
    summary="Add a saving record to a shared goal",
)
async def add_record(
    goal_id: UUID,
    body: SavingRecordCreate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Record a new individual deposit for the calling user on a shared goal.

    The goal's running total (requester_amount or receiver_amount) is
    recalculated automatically from the sum of all records.

    Raises:
      - 404 if the goal does not exist or the caller is not a participant
      - 400 if the goal is not in 'active' status
    """
    svc = get_peer_service(session)
    record = await svc.add_record(current_user.id, goal_id, body)
    return ApiResponse.success_response(data=record, message="Saving record added")


@router.patch(
    "/goals/{goal_id}/records/{record_id}",
    response_model=ApiResponse[SavingRecordOut],
    summary="Update a saving record",
)
async def update_record(
    goal_id: UUID,
    record_id: UUID,
    body: SavingRecordUpdate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Update the amount, date, or note of an existing saving record.

    Only the user who created the record may edit it.

    Raises:
      - 404 if the record or goal is not found
      - 403 if the caller did not create the record
    """
    svc = get_peer_service(session)
    record = await svc.update_record(current_user.id, goal_id, record_id, body)
    return ApiResponse.success_response(data=record, message="Saving record updated")


@router.delete(
    "/goals/{goal_id}/records/{record_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a saving record",
)
async def delete_record(
    goal_id: UUID,
    record_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Permanently delete a saving record.

    Only the user who created the record may delete it.
    The goal's running total is recalculated automatically after deletion.

    Raises:
      - 404 if the record or goal is not found
      - 403 if the caller did not create the record
    """
    svc = get_peer_service(session)
    await svc.delete_record(current_user.id, goal_id, record_id)


# ---------------------------------------------------------------------------
# Split bills (registered before the /{connection_id} routes)
# ---------------------------------------------------------------------------


@router.post("/splits", response_model=ApiResponse[SplitOut], status_code=status.HTTP_201_CREATED,
             summary="Split a bill with a partner")
async def create_split(body: SplitCreate, current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    """Your share goes into your ledger now (the whole bill if you paid, until your
    partner accepts); theirs only when they accept, or at once if they auto-accept."""
    split = await SplitService(session).create_split(current_user.id, body)
    return ApiResponse.success_response(data=split, message="Bill split")


@router.post("/splits/from-transaction", response_model=ApiResponse[SplitOut],
             status_code=status.HTTP_201_CREATED, summary="Split an expense you already recorded")
async def split_transaction(body: SplitFromTransaction, current_user: CurrentUser,
                            session: AsyncSession = Depends(get_db)):
    """You paid it. The expense stays whole until your partner accepts, then holds
    only your share; withdrawing or a decline hands it back whole."""
    split = await SplitService(session).split_transaction(current_user.id, body)
    return ApiResponse.success_response(data=split, message="Bill split")


@router.get("/splits", response_model=ApiResponse[list[SplitOut]], summary="List your split bills")
async def list_splits(current_user: CurrentUser, connection_id: UUID | None = Query(None),
                      session: AsyncSession = Depends(get_db)):
    return ApiResponse.success_response(data=await SplitService(session).list_splits(current_user.id, connection_id))


@router.get("/splits/balances", response_model=ApiResponse[list[PeerBalanceOut]],
            summary="What each partner owes you, or you owe them, per currency")
async def split_balances(current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    return ApiResponse.success_response(data=await SplitService(session).balances(current_user.id))


# Settling up. Registered before /splits/{split_id} so "settlements" isn't read as an id.
@router.post("/splits/settlements", response_model=ApiResponse[SettlementOut],
             status_code=status.HTTP_201_CREATED, summary="Record that one of you paid the other back")
async def create_settlement(body: SettlementCreate, current_user: CurrentUser,
                            session: AsyncSession = Depends(get_db)):
    """they_paid_me counts at once; i_paid_them waits for your partner to confirm.
    No transactions are written: each ledger already holds only its owner's share."""
    st = await SplitService(session).create_settlement(current_user.id, body)
    return ApiResponse.success_response(data=st, message="Repayment recorded")


@router.get("/splits/settlements", response_model=ApiResponse[list[SettlementOut]],
            summary="List repayments between you and your partners")
async def list_settlements(current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    return ApiResponse.success_response(data=await SplitService(session).list_settlements(current_user.id))


@router.post("/splits/settlements/{settlement_id}/respond", response_model=ApiResponse[SettlementOut],
             summary="Confirm or decline a repayment your partner says they sent")
async def respond_to_settlement(settlement_id: UUID, body: SettlementRespond, current_user: CurrentUser,
                                session: AsyncSession = Depends(get_db)):
    st = await SplitService(session).respond_settlement(current_user.id, settlement_id, body.action)
    return ApiResponse.success_response(data=st)


@router.post("/splits/settlements/{settlement_id}/void", response_model=ApiResponse[SettlementOut],
             summary="Withdraw your unconfirmed repayment, or undo one you were paid")
async def void_settlement(settlement_id: UUID, current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    return ApiResponse.success_response(data=await SplitService(session).void_settlement(current_user.id, settlement_id))


# Repeating bills. Registered before /splits/{split_id} so "recurring" isn't read as an id.
@router.post("/splits/recurring", response_model=ApiResponse[RecurringSplitOut],
             status_code=status.HTTP_201_CREATED, summary="A bill you pay regularly, split each time it posts")
async def create_recurring_split(body: RecurringSplitCreate, current_user: CurrentUser,
                                 session: AsyncSession = Depends(get_db)):
    rule = await SplitService(session).create_recurring(current_user.id, body)
    return ApiResponse.success_response(data=rule, message="Repeating bill set up")


@router.get("/splits/recurring", response_model=ApiResponse[list[RecurringSplitOut]],
            summary="Your repeating bills split with a partner")
async def list_recurring_splits(current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    return ApiResponse.success_response(data=await SplitService(session).list_recurring(current_user.id))


@router.post("/splits/recurring/{rule_id}/stop", response_model=ApiResponse[None],
             summary="Stop a bill repeating; what it already posted stays")
async def stop_recurring_split(rule_id: UUID, current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    await SplitService(session).stop_recurring(current_user.id, rule_id)
    return ApiResponse.success_response(data=None, message="Stopped")


@router.get("/splits/{split_id}", response_model=ApiResponse[SplitOut], summary="Get one split")
async def get_split(split_id: UUID, current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    return ApiResponse.success_response(data=await SplitService(session).get_split(current_user.id, split_id))


@router.post("/splits/{split_id}/respond", response_model=ApiResponse[SplitOut],
             summary="Accept or decline a split proposed to you")
async def respond_to_split(split_id: UUID, body: SplitRespond, current_user: CurrentUser,
                           session: AsyncSession = Depends(get_db)):
    split = await SplitService(session).respond(current_user.id, split_id, body.action,
                                                body.category_id, body.wallet_type,
                                                seen_total=body.seen_total, seen_my_share=body.seen_my_share)
    return ApiResponse.success_response(data=split)


@router.post("/splits/{split_id}/void", response_model=ApiResponse[SplitOut],
             summary="Withdraw a split your partner hasn't answered")
async def void_split(split_id: UUID, current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    return ApiResponse.success_response(data=await SplitService(session).void(current_user.id, split_id))


@router.post("/splits/{split_id}/cancel", response_model=ApiResponse[SplitOut],
             summary="Cancel an accepted split (the payer); they carry the whole bill again")
async def cancel_split(split_id: UUID, current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    return ApiResponse.success_response(data=await SplitService(session).cancel(current_user.id, split_id))


@router.post("/splits/{split_id}/cancel-request", response_model=ApiResponse[SplitOut],
             summary="Ask the payer to cancel an accepted split (the non-payer); it closes if they accept")
async def request_cancel_split(split_id: UUID, current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    split = await SplitService(session).request_cancel(current_user.id, split_id)
    return ApiResponse.success_response(data=split, message="Request sent")


@router.post("/splits/{split_id}/amend", response_model=ApiResponse[SplitOut],
             summary="Change a split: an accepted one waits for your partner; one they haven't answered changes now")
async def amend_split(split_id: UUID, body: SplitAmend, current_user: CurrentUser,
                      session: AsyncSession = Depends(get_db)):
    split = await SplitService(session).propose_amendment(current_user.id, split_id, body)
    return ApiResponse.success_response(data=split, message="Change sent")


@router.post("/splits/{split_id}/amendment/respond", response_model=ApiResponse[SplitOut],
             summary="Accept or decline a change your partner proposed")
async def respond_to_amendment(split_id: UUID, body: AmendmentRespond, current_user: CurrentUser,
                               session: AsyncSession = Depends(get_db)):
    split = await SplitService(session).respond_amendment(current_user.id, split_id, body.action)
    return ApiResponse.success_response(data=split)


@router.post("/splits/{split_id}/amendment/withdraw", response_model=ApiResponse[SplitOut],
             summary="Withdraw a change you proposed")
async def withdraw_amendment(split_id: UUID, current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    return ApiResponse.success_response(data=await SplitService(session).withdraw_amendment(current_user.id, split_id))


@router.get("/{connection_id}/prefs", response_model=ApiResponse[PeerPrefsOut],
            summary="Your settings for this partner")
async def get_prefs(connection_id: UUID, current_user: CurrentUser, session: AsyncSession = Depends(get_db)):
    return ApiResponse.success_response(data=await SplitService(session).get_prefs(current_user.id, connection_id))


@router.patch("/{connection_id}/prefs", response_model=ApiResponse[PeerPrefsOut],
              summary="Change how you handle splits from this partner")
async def set_prefs(connection_id: UUID, body: PeerPrefsUpdate, current_user: CurrentUser,
                    session: AsyncSession = Depends(get_db)):
    prefs = await SplitService(session).set_prefs(current_user.id, connection_id, body.split_policy, body.notify)
    return ApiResponse.success_response(data=prefs)


@router.patch(
    "/{connection_id}/respond",
    response_model=ApiResponse[PeerConnectionOut],
    summary="Accept or decline a peer invite",
)
async def respond_to_invite(
    connection_id: UUID,
    body: PeerRespondRequest,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Respond to a pending peer invite directed at the calling user.

    ``action`` must be either ``"accept"`` or ``"decline"``.
    """
    svc = get_peer_service(session)
    conn = await svc.respond_to_invite(connection_id, current_user.id, body.action)
    out = await _build_connection_out(conn, current_user.id, session)
    verb = "accepted" if body.action == "accept" else "declined"
    return ApiResponse.success_response(data=out, message=f"Invite {verb}")


@router.delete(
    "/{connection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a peer connection",
)
async def remove_connection(
    connection_id: UUID,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Soft-remove a connection (either party may do this)."""
    svc = get_peer_service(session)
    await svc.remove_connection(connection_id, current_user.id)


# ---------------------------------------------------------------------------
# Private helper
# ---------------------------------------------------------------------------


async def _build_connection_out(
    conn,
    calling_user_id: UUID,
    session: AsyncSession,
) -> PeerConnectionOut:
    """Convert a PeerConnection ORM object to the PeerConnectionOut schema.

    Fetches the *other* user's profile from the DB so that the router
    doesn't need to rely on lazy-loaded ORM relationships.
    """
    from sqlalchemy import select
    from app.modules.users.models import User
    from app.modules.peers.schemas import UserSearchResult

    is_sent = conn.requester_id == calling_user_id
    other_id = conn.receiver_id if is_sent else conn.requester_id

    stmt = select(
        User.id,
        User.username,
        User.name,
        User.avatar_url,
    ).where(User.id == other_id)
    row = (await session.execute(stmt)).mappings().first()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Could not resolve peer user profile",
        )

    other_user = UserSearchResult.model_validate(dict(row))
    return PeerConnectionOut(
        id=conn.id,
        other_user=other_user,
        status=conn.status,
        direction="sent" if is_sent else "received",
        created_at=conn.created_at,
    )
