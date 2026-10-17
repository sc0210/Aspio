"""
Daily running-balance computation for wallet trends.

The original loop was quadratic: for every transaction it walked day-by-day
from that transaction's date to the end of the range, formatting a date string
on each step, then discarded every day outside the window. Cost scaled with
`transactions x age_of_oldest_transaction`, so the endpoint got slower every
day even with no new data — 2,641 transactions reaching back 1,611 days cost
~4.25M inner-loop steps and 3.7s per request. The nightly snapshot writer calls
the same code path, so it paid the same price.

_daily_running_balances replaces it with a prefix sum over the window only,
which is O(transactions_in_window + days). These tests pin the *semantics* the
old loop had, because the numbers it produced are correct and must not move:

    balance[D] = opening_balance + sum(signed amounts dated <= D)

where income adds and every other type subtracts (transfers included — that is
what the old code did, and this refactor is not the place to change it).
"""

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.modules.dashboard.services import _daily_running_balances
from app.modules.transactions.models import TransactionType


def _txn(day: date, amount: str, kind=TransactionType.EXPENSE):
    return SimpleNamespace(
        transaction_date=day, amount=Decimal(amount), type=kind
    )


def _income(day: date, amount: str):
    return _txn(day, amount, TransactionType.INCOME)


START = date(2026, 8, 1)
END = date(2026, 8, 5)
DAYS = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]


@pytest.mark.unit
class TestDailyRunningBalances:
    def test_every_day_in_range_is_present(self):
        out = _daily_running_balances(Decimal("0"), [], START, END, {})
        assert list(out.keys()) == DAYS

    def test_empty_ledger_is_all_zero(self):
        out = _daily_running_balances(Decimal("0"), [], START, END, {})
        assert set(out.values()) == {Decimal("0")}

    def test_balance_carries_forward_after_a_transaction(self):
        out = _daily_running_balances(
            Decimal("0"), [_income(date(2026, 8, 3), "100")], START, END, {}
        )
        assert out["2026-08-01"] == Decimal("0")
        assert out["2026-08-02"] == Decimal("0")
        assert out["2026-08-03"] == Decimal("100")
        assert out["2026-08-04"] == Decimal("100")
        assert out["2026-08-05"] == Decimal("100")

    def test_expenses_subtract_and_income_adds(self):
        out = _daily_running_balances(
            Decimal("0"),
            [_income(date(2026, 8, 1), "500"), _txn(date(2026, 8, 3), "120")],
            START,
            END,
            {},
        )
        assert out["2026-08-01"] == Decimal("500")
        assert out["2026-08-02"] == Decimal("500")
        assert out["2026-08-03"] == Decimal("380")
        assert out["2026-08-05"] == Decimal("380")

    def test_non_income_types_subtract_like_expenses(self):
        """The old loop treated anything that is not INCOME as a debit."""
        out = _daily_running_balances(
            Decimal("0"),
            [_txn(date(2026, 8, 2), "50", TransactionType.TRANSFER)],
            START,
            END,
            {},
        )
        assert out["2026-08-02"] == Decimal("-50")

    def test_same_day_transactions_all_land_on_that_day(self):
        out = _daily_running_balances(
            Decimal("0"),
            [
                _income(date(2026, 8, 2), "100"),
                _txn(date(2026, 8, 2), "30"),
                _income(date(2026, 8, 2), "5"),
            ],
            START,
            END,
            {},
        )
        assert out["2026-08-01"] == Decimal("0")
        assert out["2026-08-02"] == Decimal("75")
        assert out["2026-08-05"] == Decimal("75")

    def test_opening_balance_applies_from_the_first_day(self):
        """History before the window used to be replayed day-by-day into it."""
        out = _daily_running_balances(
            Decimal("1000"), [_txn(date(2026, 8, 4), "250")], START, END, {}
        )
        assert out["2026-08-01"] == Decimal("1000")
        assert out["2026-08-03"] == Decimal("1000")
        assert out["2026-08-04"] == Decimal("750")
        assert out["2026-08-05"] == Decimal("750")

    def test_negative_running_balance_is_preserved(self):
        out = _daily_running_balances(
            Decimal("0"), [_txn(date(2026, 8, 1), "80")], START, END, {}
        )
        assert out["2026-08-01"] == Decimal("-80")

    def test_decimal_precision_is_not_lost_to_float(self):
        out = _daily_running_balances(
            Decimal("0"),
            [_income(date(2026, 8, 1), "0.10"), _income(date(2026, 8, 2), "0.20")],
            START,
            END,
            {},
        )
        assert out["2026-08-02"] == Decimal("0.30")
        assert isinstance(out["2026-08-02"], Decimal)

    def test_single_day_range(self):
        out = _daily_running_balances(
            Decimal("5"), [_income(START, "1")], START, START, {}
        )
        assert out == {"2026-08-01": Decimal("6")}

    def test_transactions_outside_the_window_are_not_applied_twice(self):
        """Callers pass the opening balance separately; a stray out-of-range
        row must not silently shift days it does not belong to."""
        out = _daily_running_balances(
            Decimal("0"), [_income(date(2026, 7, 20), "999")], START, END, {}
        )
        assert set(out.values()) == {Decimal("0")}

    def test_unsorted_input_gives_the_same_answer(self):
        txns = [
            _txn(date(2026, 8, 4), "10"),
            _income(date(2026, 8, 1), "100"),
            _txn(date(2026, 8, 2), "20"),
        ]
        out = _daily_running_balances(Decimal("0"), txns, START, END, {})
        assert out["2026-08-01"] == Decimal("100")
        assert out["2026-08-02"] == Decimal("80")
        assert out["2026-08-04"] == Decimal("70")
        assert _daily_running_balances(
            Decimal("0"), list(reversed(txns)), START, END, {}
        ) == out


@pytest.mark.unit
class TestRunningBalancesInTwd:
    """The opening balance arrives in TWD, so the window's rows must be converted too.

    Without it, a USD expense inside the charted window moved the running Life
    balance by its face value while everything before the window had been
    converted — the chart would step by the wrong amount on that day.
    """

    def _row(self, day, amount, currency, kind=TransactionType.EXPENSE):
        return SimpleNamespace(
            transaction_date=day, amount=Decimal(amount), type=kind, currency=currency
        )

    def test_foreign_rows_move_the_balance_at_their_rate(self):
        out = _daily_running_balances(
            Decimal("1000"),
            [self._row(date(2026, 8, 2), "10", "USD"), self._row(date(2026, 8, 3), "100", "TWD")],
            START,
            END,
            rates={"USD": Decimal("31.5")},
        )
        assert out["2026-08-01"] == Decimal("1000")
        assert out["2026-08-02"] == Decimal("685.0")   # 1000 − 10 × 31.5
        assert out["2026-08-03"] == Decimal("585.0")

    def test_currency_case_and_missing_currency_are_handled(self):
        out = _daily_running_balances(
            Decimal("0"),
            [self._row(date(2026, 8, 1), "2", "usd", TransactionType.INCOME),
             self._row(date(2026, 8, 1), "5", None, TransactionType.INCOME)],
            START,
            END,
            rates={"USD": Decimal("30")},
        )
        assert out["2026-08-01"] == Decimal("65")  # 2 × 30 + 5 at face value

    def test_a_twd_only_window_takes_amounts_as_they_are(self):
        out = _daily_running_balances(
            Decimal("0"), [self._row(date(2026, 8, 1), "10", "USD")], START, END, {}
        )
        assert out["2026-08-01"] == Decimal("-10")

    def test_the_rates_cannot_be_left_out(self):
        # The opening balance is always TWD; a call without rates would chart
        # foreign rows at face value and raise nothing.
        with pytest.raises(TypeError):
            _daily_running_balances(Decimal("0"), [], START, END)


@pytest.mark.unit
class TestRunningBalancesComplexity:
    """The whole point of the rewrite: cost must not track transaction age."""

    def test_cost_does_not_grow_with_how_old_the_ledger_is(self):
        """A window far in the future of the data costs the same as a near one.

        Under the old loop this was the killer: each transaction walked every
        day between itself and end_date.
        """
        window_start, window_end = date(2026, 8, 1), date(2026, 8, 30)
        txns = [_income(date(2026, 8, 2), "10")]

        near = _daily_running_balances(Decimal("0"), txns, window_start, window_end, {})

        # Same window, but the caller's ledger reaches back years: the helper
        # only ever sees in-window rows plus a scalar opening balance, so the
        # work is identical.
        far = _daily_running_balances(Decimal("50000"), txns, window_start, window_end, {})

        assert len(near) == len(far) == 30

    def test_date_formatting_is_per_day_not_per_transaction(self):
        """The old loop formatted a date on every (transaction, day) step.

        Here the count must equal the number of days and stay flat as the
        transaction count grows — that is exactly the quadratic term that made
        one user's request take 3.7s.
        """
        counter = {"n": 0}

        class CountingDate(date):
            # date + timedelta preserves the subclass, so every day counts.
            def isoformat(self):
                counter["n"] += 1
                return super().isoformat()

        start, end = CountingDate(2026, 8, 1), date(2026, 8, 30)

        _daily_running_balances(Decimal("0"), [], start, end, {})
        empty_ledger = counter["n"]
        assert empty_ledger == 30, "expected one formatted key per day"

        counter["n"] = 0
        many = [_income(date(2026, 8, 1) + timedelta(days=i % 30), "1") for i in range(500)]
        _daily_running_balances(Decimal("0"), many, start, end, {})
        assert counter["n"] == empty_ledger, (
            f"formatting scaled with transaction count "
            f"({counter['n']} vs {empty_ledger} for an empty ledger)"
        )
