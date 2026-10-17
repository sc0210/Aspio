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

  GET    /peers/goals                                     → list active shared goals for the caller
  POST   /peers/goals                                     → create a shared goal
  GET    /peers/goals/{goal_id}                           → get a single shared goal
  PATCH  /peers/goals/{goal_id}/contribution              → update the caller's contribution amount (compat shim)
  DELETE /peers/goals/{goal_id}                           → delete a shared goal (creator only)

  GET    /peers/goals/{goal_id}/records                   → list saving records for a goal
  POST   /peers/goals/{goal_id}/records                   → add a saving record
  PATCH  /peers/goals/{goal_id}/records/{record_id}       → update a saving record (owner only)
  DELETE /peers/goals/{goal_id}/records/{record_id}       → delete a saving record (owner only)
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
    SharedGoalContributionUpdate,
    SharedGoalCreate,
    SharedGoalOut,
    UserSearchResult,
)
from app.modules.peers.service import get_peer_service
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
    "/goals/{goal_id}/contribution",
    response_model=ApiResponse[SharedGoalOut],
    summary="Update the caller's contribution to a shared goal",
)
async def update_contribution(
    goal_id: UUID,
    body: SharedGoalContributionUpdate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_db),
):
    """Set the calling user's contribution amount (absolute value, not a delta).

    If the new combined total >= target_amount the goal transitions to
    'completed' automatically.

    Raises:
      - 404 if the goal is not found or the caller is not a participant
      - 400 if the goal is not in 'active' status
    """
    svc = get_peer_service(session)
    goal = await svc.update_contribution(current_user.id, goal_id, body.amount)
    message = "Goal completed!" if goal.status == "completed" else "Contribution updated"
    return ApiResponse.success_response(data=goal, message=message)


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
