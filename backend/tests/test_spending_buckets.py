"""The bucket rules behind /transactions/monthly-summary.

The debt bucket exists because loan repayments were being summed into "others", which
made that column read as discretionary spending when most of it was servicing 信貸.
These tests pin the boundaries that were judgement calls, not the obvious matches.
"""

import pytest

from app.modules.transactions.spending_buckets import (
    BUCKETS,
    bucket_for,
    empty_buckets,
)

pytestmark = pytest.mark.unit


class TestEmptyBuckets:
    def test_every_bucket_starts_at_zero(self):
        # A month with no spending still has to report every key: the frontend reads
        # them unconditionally, so a missing one renders blank instead of NT$0.
        assert empty_buckets() == {name: 0.0 for name in BUCKETS}

    def test_debt_is_one_of_them(self):
        assert "debt" in empty_buckets()

    def test_callers_get_their_own_dict(self):
        a, b = empty_buckets(), empty_buckets()
        a["housing"] += 1
        assert b["housing"] == 0.0


class TestObviousMatches:
    @pytest.mark.parametrize(
        "name,expected",
        [
            ("Rent", "housing"),
            ("Utilities", "housing"),
            ("房租", "housing"),
            ("Groceries", "eat"),
            ("餐飲", "eat"),
            ("ETF", "investment"),
            ("投資", "investment"),
            ("Loan Payment", "debt"),
            ("信貸", "debt"),
            ("Gifts", "others"),
            ("", "others"),
        ],
    )
    def test_category_name(self, name, expected):
        assert bucket_for((name, "", "")) == expected

    def test_any_of_the_names_matching_is_enough(self):
        # A child category under "Food & Dining" lands in eat without being listed.
        assert bucket_for(("Bubble Tea", "Food & Dining", "")) == "eat"
        assert bucket_for(("Something", "", "餐飲")) == "eat"

    def test_case_and_padding_are_ignored(self):
        assert bucket_for(("  LOAN PAYMENT  ", None, None)) == "debt"

    def test_none_names_are_not_a_match(self):
        # An all-empty row must not collide with the sets via the empty string.
        assert bucket_for((None, None, None)) == "others"


class TestLoanLink:
    def test_loan_link_alone_is_enough(self):
        # loan_id is set when the user tied the expense to a debt account through the
        # Link-to-Loan selector, and that link is what reduces the balance. Two of the
        # seven loan payments on the live box carry the category but no link, which is
        # why both signals are consulted — this covers the other direction.
        assert bucket_for(("Miscellaneous", "", ""), has_loan_link=True) == "debt"

    def test_loan_link_beats_every_non_housing_category(self):
        for name in ("Groceries", "ETF", "Gifts", "Transport"):
            assert bucket_for((name, "", ""), has_loan_link=True) == "debt"

    def test_housing_outranks_the_loan_link(self):
        # Scope: this protects rows whose CATEGORY names housing, so attaching a loan
        # to an existing "Mortgage" or "Rent" expense cannot shrink the Housing column.
        # It does NOT protect payments made through the Loans page — record_payment
        # files those under "Loan Payment" whatever the loan's account_type is, and
        # they are debt by design (they were in Others before, never Housing). See
        # test_a_loans_page_mortgage_payment_is_debt.
        assert bucket_for(("Mortgage", "", ""), has_loan_link=True) == "housing"
        assert bucket_for(("Rent", "", ""), has_loan_link=True) == "housing"

    def test_no_link_falls_back_to_the_name(self):
        assert bucket_for(("Rent", "", ""), has_loan_link=False) == "housing"


class TestDeliberateExclusions:
    def test_mortgage_stays_under_housing(self):
        # A mortgage is debt, but people budget it as a housing cost and it was already
        # in Housing. Moving it would silently change that column, when the point of
        # the debt bucket is only to split what was in Others.
        assert bucket_for(("Mortgage", "", "")) == "housing"

    def test_loan_receipt_is_not_a_repayment(self):
        # Money arriving FROM a loan — the income side of borrowing.
        assert bucket_for(("Loan Receipt", "", "")) == "others"

    def test_bare_interest_is_not_assumed_to_be_debt(self):
        # Ambiguous: it also names investment interest.
        assert bucket_for(("Interest", "", "")) == "others"
        assert bucket_for(("利息", "", "")) == "others"

    def test_loan_flavoured_interest_is_debt(self):
        assert bucket_for(("Loan Interest", "", "")) == "debt"
        assert bucket_for(("貸款利息", "", "")) == "debt"


class TestTheTwoTuplesAgree:
    def test_every_set_has_a_bucket_and_vice_versa(self):
        from app.modules.transactions.spending_buckets import _SETS

        assert {name for name, _ in _SETS} | {"others"} == set(BUCKETS)


class TestEvaluationOrder:
    def test_first_match_in_bucket_order_wins(self):
        # A row whose names hit two sets resolves by BUCKETS order, not dict order.
        assert bucket_for(("Rent", "Loan Payment", "")) == "housing"
        assert BUCKETS.index("housing") < BUCKETS.index("debt")

    def test_others_is_last(self):
        assert BUCKETS[-1] == "others"
