"""Data access for ``tw_market_valuations``."""

from datetime import date
from typing import Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository

from .models import TwMarketMonth
from .sources import MarketDay


class TwMarketRepository(BaseRepository[TwMarketMonth]):
    def __init__(self, db: AsyncSession):
        super().__init__(db, TwMarketMonth)

    async def all_months(self) -> List[TwMarketMonth]:
        return list((await self.db.execute(select(TwMarketMonth).order_by(TwMarketMonth.month))).scalars())

    async def upsert_month(self, month: date, reading: MarketDay, final: bool) -> TwMarketMonth:
        """Write one month's reading; flushes, the caller commits."""
        row = await self.db.get(TwMarketMonth, month)
        if row is None:
            row = TwMarketMonth(month=month)
            self.db.add(row)
        row.as_of = reading.day
        row.taiex = round(reading.taiex, 2)
        row.market_pe = round(reading.market_pe, 4)
        row.companies = reading.companies
        row.is_final = final
        await self.db.flush()
        return row

    async def months_missing_cpi(self) -> List[TwMarketMonth]:
        return list((await self.db.execute(
            select(TwMarketMonth).where(TwMarketMonth.cpi.is_(None))
        )).scalars())

    async def set_cpi(self, cpi: Dict[date, float]) -> int:
        """Write CPI on every month the series covers; flushes, the caller commits.

        Every month, not only the empty ones: when DGBAS moves the index to a
        new base year, the whole series moves with it, and a series half on
        one base and half on another would put a step into real earnings.
        """
        written = 0
        for row in await self.all_months():
            value = cpi.get(row.month)
            if value and (row.cpi is None or float(row.cpi) != value):
                row.cpi = value
                written += 1
        await self.db.flush()
        return written
