"""One row per month of the Taiwan market, the inputs to the CAPE."""

from sqlalchemy import Boolean, Column, Date, DateTime, Integer, Numeric, func

from app.database.base import Base


class TwMarketMonth(Base):
    """The TAIEX and the listed market's P/E on one trading day of a month.

    A finished month is read on its last trading day and marked final; the
    current month is re-read daily on its latest trading day. ``market_pe`` is
    total market cap over total trailing earnings of the companies TWSE gives a
    P/E for (positive trailing earnings), so the TAIEX's earnings that month are
    ``taiex / market_pe``. ``cpi`` is DGBAS's general index (2021 = 100) for the
    month, filled in once published, about a week after the month ends.
    """

    __tablename__ = "tw_market_valuations"

    month = Column(Date, primary_key=True)  # first day of the month
    as_of = Column(Date, nullable=False)  # the trading day read
    taiex = Column(Numeric(12, 2), nullable=False)
    market_pe = Column(Numeric(10, 4), nullable=False)
    companies = Column(Integer, nullable=False)  # companies with a P/E that day
    cpi = Column(Numeric(8, 3))
    is_final = Column(Boolean, nullable=False, default=False)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
