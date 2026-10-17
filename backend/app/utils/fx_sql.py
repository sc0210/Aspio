"""Converting a money column to TWD inside a query.

Every total this app shows is in TWD, and the tables store each row in the
currency it was entered in. Summing `amount` across rows therefore adds NT$ to
US$ as though they were the same unit — a USD purchase of 9,062 counted as
NT$9,062 rather than roughly NT$285,000.

The obvious fix is to group by currency and re-aggregate in Python, but the
aggregates that need it are the carefully built ones — the dashboard summary is
a single query with five CASE-based sums — and regrouping each would change
their shape, their row counts and their tests. Converting *inside* the query
leaves all of that alone: `amount` becomes `amount * rate-for-its-currency`, and
every surrounding sum, filter and grouping stays exactly as it was.

The rates are read once per query, not per row: `rate_case` builds a single SQL
CASE from a dict the caller has already fetched.
"""

import logging
from decimal import Decimal
from typing import Dict, Iterable, Optional

from sqlalchemy import case, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.utils.exchange_rate_service import get_exchange_rate_service

logger = logging.getLogger(__name__)

BASE_CURRENCY = "TWD"


async def twd_rates_for(
    db: Optional[AsyncSession], currencies: Iterable[str]
) -> Dict[str, Decimal]:
    """One TWD rate per currency. TWD is 1; anything unresolvable is 1 too.

    A missing rate falling back to 1 is the pre-existing behaviour — it is what
    summing the raw column already did — so an FX outage degrades to the old
    numbers rather than to zeroes or an error on the dashboard.
    """
    wanted = {(c or BASE_CURRENCY).upper() for c in currencies}
    wanted.discard(BASE_CURRENCY)
    if not wanted:
        return {}

    service = get_exchange_rate_service(db)
    rates: Dict[str, Decimal] = {}
    for currency in sorted(wanted):
        rate = await service.get_exchange_rate(currency, BASE_CURRENCY)
        if rate is None:
            logger.warning(
                f"No {currency}->{BASE_CURRENCY} rate; counting those rows at face value"
            )
            continue
        rates[currency] = rate

    return rates


def in_twd(
    amount_col: ColumnElement, currency_col: ColumnElement, rates: Dict[str, Decimal]
) -> ColumnElement:
    """`amount_col` expressed in TWD, as a SQL expression.

    With no rates — a single-currency account, the common case — the column is
    returned untouched, so the query is byte-for-byte what it was before.
    """
    if not rates:
        return amount_col

    # The rates are keyed upper-case (`twd_rates_for` normalises), so the column
    # is too — otherwise a row stored as "usd" would miss its rate and fall
    # through to ELSE 1, silently counted at face value.
    return amount_col * case(
        {currency: rate for currency, rate in rates.items()},
        value=func.upper(currency_col),
        else_=1,
    )


def to_twd(amount, currency: Optional[str], rates: Dict[str, Decimal]):
    """One loaded value in TWD: `in_twd` for an amount already in Python.

    The same rule as the query form, so a row converted in Python and one summed
    in SQL cannot disagree: currencies match upper-case, a missing currency is
    TWD, and one without a rate counts at face value. A float stays a float.
    """
    rate = rates.get((currency or BASE_CURRENCY).upper())
    if rate is None:
        return amount
    return amount * (float(rate) if isinstance(amount, float) else rate)


__all__ = ["BASE_CURRENCY", "in_twd", "to_twd", "twd_rates_for"]
