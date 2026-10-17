"""Unit tests for FIFO cost-basis allocation (pure, no DB)."""

from dataclasses import dataclass
from decimal import Decimal

import pytest

from app.modules.portfolio.cost_basis import allocate_fifo, total_available


@dataclass
class FakeLot:
    """Minimal stand-in for a PortfolioHolding lot."""

    id: str
    quantity: Decimal
    average_cost: Decimal


def _lot(id_: str, qty: str, avg: str) -> FakeLot:
    return FakeLot(id=id_, quantity=Decimal(qty), average_cost=Decimal(avg))


class TestTotalAvailable:
    def test_sums_quantities(self):
        lots = [_lot("a", "10", "100"), _lot("b", "5", "120")]
        assert total_available(lots) == Decimal("15")

    def test_empty_is_zero(self):
        assert total_available([]) == Decimal("0")


class TestAllocateFifo:
    def test_partial_sell_single_lot(self):
        lots = [_lot("a", "10", "100")]
        result = allocate_fifo(lots, Decimal("4"))
        assert len(result.consumptions) == 1
        assert result.consumptions[0].quantity_taken == Decimal("4")
        assert result.cost_basis == Decimal("400")  # 4 * 100
        assert result.lot_ids == ["a"]

    def test_exact_lot_boundary_consumes_only_first_lot(self):
        # Selling exactly the first lot's quantity must not touch the second lot.
        lots = [_lot("a", "10", "100"), _lot("b", "10", "120")]
        result = allocate_fifo(lots, Decimal("10"))
        assert result.lot_ids == ["a"]
        assert result.cost_basis == Decimal("1000")

    def test_sell_spans_two_lots_oldest_first(self):
        # 15 shares: all of lot a (10 @ 100) + 5 of lot b (@ 120).
        lots = [_lot("a", "10", "100"), _lot("b", "10", "120")]
        result = allocate_fifo(lots, Decimal("15"))
        assert result.lot_ids == ["a", "b"]
        assert [c.quantity_taken for c in result.consumptions] == [
            Decimal("10"),
            Decimal("5"),
        ]
        assert result.cost_basis == Decimal("1600")  # 1000 + 600

    def test_sell_entire_position_across_all_lots(self):
        lots = [_lot("a", "10", "100"), _lot("b", "5", "120")]
        result = allocate_fifo(lots, Decimal("15"))
        assert result.lot_ids == ["a", "b"]
        assert result.cost_basis == Decimal("1600")  # 1000 + 600

    def test_skips_zero_quantity_lots(self):
        lots = [_lot("z", "0", "999"), _lot("a", "10", "100")]
        result = allocate_fifo(lots, Decimal("3"))
        assert result.lot_ids == ["a"]
        assert result.cost_basis == Decimal("300")

    def test_insufficient_total_raises(self):
        lots = [_lot("a", "10", "100")]
        with pytest.raises(ValueError, match="Insufficient quantity"):
            allocate_fifo(lots, Decimal("11"))

    def test_non_positive_quantity_raises(self):
        lots = [_lot("a", "10", "100")]
        with pytest.raises(ValueError, match="must be positive"):
            allocate_fifo(lots, Decimal("0"))

    def test_coerces_float_inputs(self):
        # Lots may carry floats in some code paths; allocation must stay exact.
        lots = [FakeLot(id="a", quantity=10.0, average_cost=100.0)]
        result = allocate_fifo(lots, 4)
        assert result.cost_basis == Decimal("400")
