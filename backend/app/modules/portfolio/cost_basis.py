"""Cost-basis allocation for portfolio sells.

A position in a symbol is stored as one or more *lots* (separate
``PortfolioHolding`` rows, one per purchase batch). When a user sells a
quantity that spans more than one lot, we must decide which lots are drawn
down and at what cost — that determines the realized capital gain.

This module holds the pure allocation logic so it can be unit-tested without a
database. The router gathers the active lots (oldest-first) and applies the
mutations the allocation describes.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, List, Protocol, Sequence


class Lot(Protocol):
    """Minimal shape the allocator needs from a lot (a PortfolioHolding row)."""

    id: Any
    quantity: Decimal
    average_cost: Decimal


@dataclass
class LotConsumption:
    """How much was taken from one lot, and the lot itself (so the caller can
    mutate its quantity / mark it inactive)."""

    lot: Any
    quantity_taken: Decimal


@dataclass
class FifoAllocation:
    consumptions: List[LotConsumption]
    cost_basis: Decimal  # Σ(quantity_taken × lot.average_cost)
    lot_ids: List[str]  # ids of every lot touched, in consumption order


def _d(value: Any) -> Decimal:
    """Coerce a possibly-float/str numeric to Decimal safely."""
    return value if isinstance(value, Decimal) else Decimal(str(value))


def total_available(lots: Sequence[Lot]) -> Decimal:
    """Sum of sellable quantity across the given lots."""
    return sum((_d(lot.quantity) for lot in lots), Decimal("0"))


def allocate_fifo(lots_oldest_first: Sequence[Lot], quantity: Decimal) -> FifoAllocation:
    """Consume ``quantity`` from ``lots_oldest_first`` using FIFO (oldest lot
    first), returning which lots were drawn down and the total cost basis.

    ``lots_oldest_first`` MUST already be ordered oldest purchase first.
    Raises ``ValueError`` if ``quantity`` is non-positive or exceeds the total
    available across all lots.
    """
    quantity = _d(quantity)
    if quantity <= 0:
        raise ValueError("Sell quantity must be positive")

    available = total_available(lots_oldest_first)
    if available < quantity:
        raise ValueError(
            f"Insufficient quantity: have {available}, trying to sell {quantity}"
        )

    remaining = quantity
    consumptions: List[LotConsumption] = []
    cost_basis = Decimal("0")
    lot_ids: List[str] = []

    for lot in lots_oldest_first:
        if remaining <= 0:
            break
        lot_qty = _d(lot.quantity)
        if lot_qty <= 0:
            continue
        take = lot_qty if lot_qty < remaining else remaining
        consumptions.append(LotConsumption(lot=lot, quantity_taken=take))
        cost_basis += take * _d(lot.average_cost)
        lot_ids.append(str(lot.id))
        remaining -= take

    return FifoAllocation(consumptions=consumptions, cost_basis=cost_basis, lot_ids=lot_ids)
