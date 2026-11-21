"""Keep ``tw_market_valuations`` current, and read the CAPE from it."""

import asyncio
import calendar
import logging
from datetime import date, timedelta
from typing import Awaitable, Callable, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import TwMarketMonth
from .sources import (
    REQUEST_INTERVAL_SECONDS,
    MarketDataClient,
    MarketDay,
    NoTradingData,
    market_day,
    parse_fmtqik_taiex,
    parse_mi_index,
)
from .valuation import CapeReading, MonthInput, read_cape

logger = logging.getLogger(__name__)

# The oldest month the dated TWSE reports serve all three tables for. The first
# CAPE needs ten years of earnings, so the series starts in the second half of 2015.
FIRST_MONTH = date(2005, 10, 1)
# How far back from a target day to look for a trading day: long enough for
# Lunar New Year, short enough not to wander into the previous month's data.
MAX_LOOKBACK_DAYS = 12

SessionFactory = Callable[[], "AsyncSession"]
Sleep = Callable[[float], Awaitable[None]]


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _next_month(d: date) -> date:
    return date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def _month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


class TwMarketSync:
    """Fill in the months that are missing or not final, then the CPI.

    Idempotent: a finished month read on its last trading day is final and
    never fetched again, so the daily run costs three requests (the current
    month) once the backfill is done. The first run backfills from 2005,
    about 800 paced requests, close to an hour; each month commits on its own,
    so an interrupted run keeps what it fetched and the next one carries on.
    """

    def __init__(self, session_factory: SessionFactory, client: MarketDataClient, sleep: Sleep = asyncio.sleep):
        self._session_factory = session_factory
        self._client = client
        self._sleep = sleep
        self._requests = 0

    async def _paced(self, call):
        if self._requests:
            await self._sleep(REQUEST_INTERVAL_SECONDS)
        self._requests += 1
        return await call

    async def _trading_day(self, target: date, floor: date) -> Optional[MarketDay]:
        """The market on the latest trading day from `target` back to `floor`."""
        day = target
        for _ in range(MAX_LOOKBACK_DAYS):
            if day < floor:
                return None
            if day.weekday() < 5:
                try:
                    mi_index = await self._paced(self._client.mi_index(day))
                    if mi_index.get("stat") == "OK":
                        bwibbu = await self._paced(self._client.bwibbu(day))
                        qfiis = await self._paced(self._client.qfiis(day))
                        taiex = None
                        if parse_mi_index(mi_index)[0] is None:  # a 2000s report: no index table
                            taiex = parse_fmtqik_taiex(await self._paced(self._client.fmtqik(day)), day)
                        return market_day(day, mi_index, bwibbu, qfiis, taiex=taiex)
                except NoTradingData:
                    pass  # published MI_INDEX but not the other two yet: go back a day
            day -= timedelta(days=1)
        return None

    async def run(self, today: date) -> Dict[str, int]:
        async with self._session_factory() as session:
            rows = {r.month: r for r in (await session.execute(select(TwMarketMonth))).scalars()}

        current = _month_start(today)
        fetched = failed = 0
        month = FIRST_MONTH
        while month <= current:
            row = rows.get(month)
            if not (row and row.is_final):
                is_past = month < current
                target = _month_end(month) if is_past else today
                try:
                    reading = await self._trading_day(target, floor=month)
                except Exception as e:  # one bad month must not stop the backfill
                    logger.warning("TW market %s: fetch failed: %s", month, e)
                    reading = None
                    failed += 1
                if reading:
                    await self._save(month, reading, final=is_past)
                    fetched += 1
            month = _next_month(month)

        cpi_filled = await self._fill_cpi(today)
        logger.info("TW market sync: %d months fetched, %d failed, %d CPI filled", fetched, failed, cpi_filled)
        return {"fetched": fetched, "failed": failed, "cpi_filled": cpi_filled, "requests": self._requests}

    async def _save(self, month: date, reading: MarketDay, final: bool) -> None:
        async with self._session_factory() as session:
            row = await session.get(TwMarketMonth, month)
            if row is None:
                row = TwMarketMonth(month=month)
                session.add(row)
            row.as_of = reading.day
            row.taiex = round(reading.taiex, 2)
            row.market_pe = round(reading.market_pe, 4)
            row.companies = reading.companies
            row.is_final = final
            await session.commit()

    async def _fill_cpi(self, today: date) -> int:
        """Fill CPI on rows without one, fetching DGBAS only when one is due.

        A month's CPI comes out about a week after it ends, so only rows from
        before last month — or last month, once a week has passed — are due.
        """
        async with self._session_factory() as session:
            missing = list((await session.execute(
                select(TwMarketMonth).where(TwMarketMonth.cpi.is_(None))
            )).scalars())
            if not missing:
                return 0
            latest_due = _month_start(today - timedelta(days=37))
            if not any(r.month <= latest_due for r in missing):
                return 0
            try:
                cpi = await self._client.cpi()
            except Exception as e:
                logger.warning("TW CPI fetch failed: %s", e)
                return 0
            filled = 0
            for row in missing:
                value = cpi.get(row.month)
                if value:
                    row.cpi = value
                    filled += 1
            await session.commit()
            return filled


async def read_tw_cape(session: AsyncSession) -> CapeReading:
    rows: List[TwMarketMonth] = list((await session.execute(select(TwMarketMonth))).scalars())
    return read_cape([
        MonthInput(
            month=r.month, as_of=r.as_of, taiex=float(r.taiex), market_pe=float(r.market_pe),
            cpi=float(r.cpi) if r.cpi is not None else None, is_final=bool(r.is_final),
        )
        for r in rows
    ])
