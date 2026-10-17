"""Which bucket a month's spending falls into, for /transactions/monthly-summary.

One copy, because there are two callers — the authenticated endpoint in router.py and
demo_service.py — and they were carrying byte-identical duplicates of every set below.
Adding a bucket to two lists by hand is how they drift, and a bucket that exists in one
path and not the other shows up as a column that is populated for real users and empty
in the demo (or the reverse).

The buckets are evaluated in the order `BUCKETS` lists them, first match wins, and
anything unmatched lands in `others`.
"""

from __future__ import annotations

from typing import Iterable, Optional

# Utilities are grouped with Housing to match the frontend sidebar grouping.
HOUSING_CATEGORIES = {
    # English
    "rent",
    "mortgage",
    "home insurance",
    "property tax",
    "home maintenance",
    "housing",
    "utilities",
    # Chinese
    "住房",
    "房租",
    "管理費",
    "管理费",
    "房屋",
    "水電費",
    "水电费",
}

EAT_CATEGORIES = {
    # English
    "food",
    "food & dining",
    "groceries",
    "dining",
    "restaurants",
    "coffee",
    "coffee & tea",
    "snacks",
    "eating out",
    "food delivery",
    # Chinese
    "餐飲",
    "餐饮",
    "食物",
    "飲食",
    "饮食",
    "雜貨",
    "杂货",
    "外賣",
    "外卖",
    "咖啡",
    "餐廳",
    "餐厅",
}

INVESTMENT_CATEGORIES = {
    # English
    "investment",
    "investments",
    "investing",
    "investment purchase",
    "investment return",
    "stocks",
    "stock",
    "etf",
    "etfs",
    "bonds",
    "bond",
    "mutual fund",
    "mutual funds",
    "cryptocurrency",
    "crypto",
    "securities",
    # Chinese
    "投資",
    "投资",
    "股票",
    "基金",
    "債券",
    "债券",
    "加密貨幣",
    "加密货币",
    "證券",
    "证券",
}

# Repaying borrowed money. Deliberately NOT here:
#
#   "mortgage"      — stays under Housing, which is checked first. A mortgage is a
#                     housing cost people budget as one, and moving it would silently
#                     change the Housing column rather than only splitting Others.
#   "loan receipt"  — that is money arriving FROM a loan. It is the income side of
#                     borrowing, not a repayment.
#   bare "interest" / "利息"
#                   — ambiguous enough to catch investment interest; only the
#                     explicitly loan-flavoured spellings are listed.
DEBT_CATEGORIES = {
    # English
    "loan payment",
    "loan payments",
    "loan repayment",
    "loan interest",
    "debt",
    "debt payment",
    "debt repayment",
    "credit card payment",
    "credit card bill",
    # Chinese
    "貸款",
    "贷款",
    "還款",
    "还款",
    "信貸",
    "信贷",
    "卡費",
    "卡费",
    "債務",
    "债务",
    "負債",
    "负债",
    "貸款利息",
    "贷款利息",
}

# Order is the evaluation order; `others` is the fallthrough.
BUCKETS = ("housing", "eat", "investment", "debt", "others")

_SETS = (
    ("housing", HOUSING_CATEGORIES),
    ("eat", EAT_CATEGORIES),
    ("investment", INVESTMENT_CATEGORIES),
    ("debt", DEBT_CATEGORIES),
)


def empty_buckets() -> dict:
    """A zeroed bucket dict, so every caller starts with the same keys.

    Months with no spending still have to report every key: the frontend reads them
    unconditionally, and a missing one renders as a blank cell rather than NT$0.
    """
    return {name: 0.0 for name in BUCKETS}


def bucket_for(
    names: Iterable[Optional[str]],
    *,
    has_loan_link: bool = False,
) -> str:
    """Return the bucket for a transaction, given every name that might identify it.

    `names` is the category name, its parent's name and its Chinese name — whichever
    the caller has. They are compared case-insensitively and trimmed, and any of them
    matching is enough, which is how a child category under "Food & Dining" lands in
    `eat` without being listed itself.

    `has_loan_link` is `Transaction.loan_id` being set. That column is not a guess: it
    exists because the user tied this expense to a debt account through the
    Link-to-Loan selector, and it is what actually reduces the balance. So it outranks
    every category name — except Housing.

    Housing first, and note carefully what that does and does not cover. It applies to
    rows whose CATEGORY says housing — a hand-entered "Mortgage" or "Rent" — and keeps
    them in `housing` even when they carry a loan link, so linking a payment can never
    shrink the Housing column.

    It does NOT reach a mortgage paid through the Loans page. `record_payment` files
    every payment under the system "Loan Payment" category whatever the loan's
    `account_type` is, so such a row lands in `debt`. That is deliberate, not an
    oversight: before this bucket existed it was in `others`, never in `housing`, so
    `debt` takes it out of Others and leaves Housing exactly as it was. Sending it to
    `housing` instead would GROW that column, which is the silent change this carve-out
    exists to prevent. `test_a_loans_page_mortgage_payment_is_debt` pins it.

    Both signals are needed below Housing: of the seven loan payments on the live box,
    five carry the link and two have only the category.
    """
    lowered = {(n or "").strip().lower() for n in names}
    lowered.discard("")

    if lowered & HOUSING_CATEGORIES:
        return "housing"
    if has_loan_link:
        return "debt"
    for bucket, members in _SETS:
        if lowered & members:
            return bucket
    return "others"
