"""The Taiwan CAPE: TWSE parsing, the CAPE math, the sync, and the endpoint."""

from datetime import date
from typing import List

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.market.models import TwMarketMonth
from app.modules.market.services import FIRST_MONTH, TwMarketSync, _next_month
from app.modules.market.sources import (
    NoTradingData,
    market_day,
    parse_codes,
    parse_cpi_xml,
    parse_fmtqik_taiex,
    parse_mi_index,
)
from app.modules.market.valuation import MonthInput, cape_series, read_cape

# ── TWSE reports, trimmed to their shape ────────────────────────────────────


def _mi_index(taiex="8,080.60", closes=None):
    closes = closes or {"2330": "143.00", "1101": "26.00", "9999": "10.00"}
    return {
        "stat": "OK",
        "tables": [
            {"title": "價格指數(臺灣證券交易所)", "fields": ["指數", "收盤指數", "漲跌(+/-)"],
             "data": [["寶島股價指數", "9,000.00", ""], ["發行量加權股價指數", taiex, ""]]},
            {"title": None, "fields": None, "data": []},
            {"title": "每日收盤行情(全部)", "fields": ["證券代號", "證券名稱", "成交股數", "收盤價"],
             "data": [[code, "name", "1", close] for code, close in closes.items()]},
        ],
    }


def _old_mi_index():
    """A 2000s MI_INDEX: closing prices, but no index tables at all."""
    report = _mi_index()
    report["tables"] = [t for t in report["tables"] if (t.get("fields") or [""])[0] != "指數"]
    return report


def _fmtqik():
    return {"stat": "OK", "fields": ["日期", "成交股數", "成交金額", "成交筆數", "發行量加權股價指數", "漲跌點數"],
            "data": [[" 94/12/29", "1", "1", "1", "6,575.53", "1"], [" 94/12/30", "1", "1", "1", "6,548.34", "-27.19"]]}


def _bwibbu(pes=None):
    pes = pes or {"2330": "11.00", "1101": "13.00", "9999": "-"}
    return {"stat": "OK", "fields": ["證券代號", "證券名稱", "本益比", "殖利率(%)", "股價淨值比"],
            "data": [[code, "name", pe, "1.0", "1.0"] for code, pe in pes.items()]}


def _qfiis(shares=None):
    shares = shares or {"2330": "25,930,380,458", "1101": "3,692,175,869", "9999": "1,000,000"}
    return {"stat": "OK", "fields": ["證券代號", "證券名稱", "國際證券編碼", "發行股數"],
            "data": [[code, "name", "TW", n] for code, n in shares.items()]}


class TestParsing:
    def test_mi_index_reads_the_taiex_not_another_index(self):
        taiex, closes = parse_mi_index(_mi_index())
        assert taiex == pytest.approx(8080.60)
        assert closes["2330"] == 143.0

    def test_a_day_without_trading_is_not_an_error_but_no_data(self):
        with pytest.raises(NoTradingData):
            parse_mi_index({"stat": "很抱歉，沒有符合條件的資料!"})

    def test_columns_are_found_by_name(self):
        # Later BWIBBU_d reports add a 收盤價 column before 本益比.
        payload = {"stat": "OK", "fields": ["證券代號", "證券名稱", "收盤價", "殖利率(%)", "股利年度", "本益比"],
                   "data": [["2330", "台積電", "1000", "1.0", "114", "25.00"]]}
        assert parse_codes(payload, "本益比") == {"2330": 25.0}

    def test_market_pe_is_cap_over_earnings_of_companies_with_a_pe(self):
        day = market_day(date(2016, 1, 29), _mi_index(), _bwibbu(), _qfiis())
        cap_2330, cap_1101 = 143.0 * 25_930_380_458, 26.0 * 3_692_175_869
        expected = (cap_2330 + cap_1101) / (cap_2330 / 11 + cap_1101 / 13)
        assert day.market_pe == pytest.approx(expected)
        assert day.companies == 2  # 9999 has no P/E ("-")
        assert day.taiex == pytest.approx(8080.60)

    def test_an_old_report_without_the_taiex_takes_it_from_fmtqik(self):
        taiex, closes = parse_mi_index(_old_mi_index())
        assert taiex is None and closes["2330"] == 143.0
        fallback = parse_fmtqik_taiex(_fmtqik(), date(2005, 12, 30))  # ROC 94/12/30
        assert fallback == pytest.approx(6548.34)
        day = market_day(date(2005, 12, 30), _old_mi_index(), _bwibbu(), _qfiis(), taiex=fallback)
        assert day.taiex == pytest.approx(6548.34)
        with pytest.raises(ValueError):
            market_day(date(2005, 12, 30), _old_mi_index(), _bwibbu(), _qfiis())

    def test_fmtqik_without_the_day_is_no_trading_data(self):
        with pytest.raises(NoTradingData):
            parse_fmtqik_taiex(_fmtqik(), date(2005, 12, 31))

    def test_cpi_takes_the_monthly_general_index_only(self):
        xml = """<?xml version="1.0" encoding="utf-8"?><Root>
        <Obs><Item>總指數(指數基期：民國110年=100)</Item><TIME_PERIOD>2026M10</TIME_PERIOD><FREQ>M</FREQ><TYPE>原始值</TYPE><Item_VALUE>112.9</Item_VALUE></Obs>
        <Obs><Item>總指數(指數基期：民國110年=100)</Item><TIME_PERIOD>2026M10</TIME_PERIOD><FREQ>M</FREQ><TYPE>年增率(%)</TYPE><Item_VALUE>2.33</Item_VALUE></Obs>
        <Obs><Item>一.食物類(指數基期：民國110年=100)</Item><TIME_PERIOD>2026M10</TIME_PERIOD><FREQ>M</FREQ><TYPE>原始值</TYPE><Item_VALUE>120.0</Item_VALUE></Obs>
        </Root>""".encode()
        assert parse_cpi_xml(xml) == {date(2026, 10, 1): 112.9}


# ── The CAPE math ───────────────────────────────────────────────────────────


def _months(n: int, start=date(2010, 1, 1)) -> List[date]:
    out, m = [], start
    for _ in range(n):
        out.append(m)
        m = _next_month(m)
    return out


def _rows(prices, pes, cpis=None) -> List[MonthInput]:
    months = _months(len(prices))
    cpis = cpis or [100.0] * len(prices)
    return [MonthInput(m, m, p, pe, c, True) for m, p, pe, c in zip(months, prices, pes, cpis)]


class TestCape:
    def test_flat_earnings_and_prices_give_the_pe(self):
        rows = _rows([100.0] * 130, [20.0] * 130)
        series = cape_series(rows)
        assert series[0].cape == pytest.approx(20.0)
        assert len(series) == 130 - 113  # from the first month with 114 months behind it

    def test_inflation_is_taken_out_of_both_price_and_earnings(self):
        # Prices and earnings that only keep up with CPI are flat in real terms.
        cpi = [100.0 * 1.002 ** i for i in range(130)]
        rows = _rows([100.0 * c / 100 for c in cpi], [20.0] * 130, cpi)
        assert cape_series(rows)[-1].cape == pytest.approx(20.0)

    def test_growing_earnings_put_the_cape_above_todays_pe(self):
        # Earnings that doubled over the decade: the ten-year average lags them.
        prices = [100.0 * 2 ** (i / 120) for i in range(130)]
        rows = _rows(prices, [20.0] * 130)
        assert cape_series(rows)[-1].cape > 25

    def test_too_little_history_is_unavailable(self):
        assert read_cape(_rows([100.0] * 100, [20.0] * 100)).available is False

    def test_newest_months_carry_the_last_published_cpi(self):
        rows = _rows([100.0] * 130, [20.0] * 130)
        rows[-1] = MonthInput(rows[-1].month, rows[-1].as_of, 100.0, 20.0, None, False)
        reading = read_cape(rows)
        assert reading.as_of == rows[-1].as_of
        assert reading.cape == pytest.approx(20.0)

    def test_percentile_and_band_are_against_its_own_history(self):
        # Cheap for years, then a run-up: the latest is the highest seen.
        prices = [100.0] * 125 + [100.0 + 10 * i for i in range(1, 11)]
        reading = read_cape(_rows(prices, [20.0] * 135))
        assert reading.percentile == pytest.approx(100.0)
        assert reading.band == "expensive"
        assert reading.high == pytest.approx(reading.cape)

        falling = [100.0] * 125 + [100.0 - 5 * i for i in range(1, 11)]
        assert read_cape(_rows(falling, [20.0] * 135)).band == "cheap"


# ── The sync against a fake TWSE ────────────────────────────────────────────


class FakeTwse:
    """Every weekday trades; publishes up to `published` (inclusive)."""

    def __init__(self, published: date, missing_bwibbu: date = None):
        self.published = published
        self.missing_bwibbu = missing_bwibbu
        self.calls = []

    def _ok(self, day):
        return day <= self.published

    async def mi_index(self, day):
        self.calls.append(("mi", day))
        if not self._ok(day):
            return {"stat": "很抱歉，沒有符合條件的資料!"}
        return _old_mi_index() if day.year < 2009 else _mi_index()

    async def fmtqik(self, day):
        self.calls.append(("fm", day))
        roc = f" {day.year - 1911}/{day.month:02d}"
        return {"stat": "OK", "fields": ["日期", "發行量加權股價指數"],
                "data": [[f"{roc}/{d:02d}", "6,000.00"] for d in range(1, 32)]}

    async def bwibbu(self, day):
        self.calls.append(("pe", day))
        if day == self.missing_bwibbu:
            return {"stat": "很抱歉，沒有符合條件的資料!"}
        return _bwibbu()

    async def qfiis(self, day):
        self.calls.append(("sh", day))
        return _qfiis()

    async def cpi(self):
        self.calls.append(("cpi", None))
        out, m = {}, FIRST_MONTH
        while m < date(2026, 10, 1):
            out[m] = 100.0
            m = _next_month(m)
        return out


async def _no_sleep(_seconds):
    return None


@pytest.fixture
def session_factory(async_engine):
    return async_sessionmaker(async_engine, expire_on_commit=False)


@pytest.mark.asyncio
@pytest.mark.database
async def test_backfill_then_daily_run_fetches_only_the_current_month(session_factory):
    today = date(2026, 11, 20)  # a Friday, published
    twse = FakeTwse(published=today)
    result = await TwMarketSync(session_factory, twse, sleep=_no_sleep).run(today)

    async with session_factory() as s:
        rows = {r.month: r for r in (await s.execute(select(TwMarketMonth))).scalars()}
    assert min(rows) == FIRST_MONTH and max(rows) == date(2026, 11, 1)
    assert result["failed"] == 0
    assert rows[date(2026, 10, 1)].as_of == date(2026, 10, 30)  # Oct 31 2026 is a Saturday
    assert rows[date(2026, 10, 1)].is_final is True
    assert rows[date(2026, 11, 1)].is_final is False
    assert rows[date(2026, 9, 1)].cpi is not None  # CPI filled once due
    assert rows[date(2026, 11, 1)].cpi is None
    assert float(rows[date(2005, 12, 1)].taiex) == 6000.0  # read from FMTQIK
    assert not any(kind == "fm" and d.year >= 2009 for kind, d in twse.calls)

    twse.calls.clear()
    await TwMarketSync(session_factory, twse, sleep=_no_sleep).run(today)
    fetched_days = {d for kind, d in twse.calls if kind == "mi"}
    assert fetched_days == {today}  # finished months are final: not fetched again


@pytest.mark.asyncio
@pytest.mark.database
async def test_before_publication_the_current_month_reads_the_last_published_day(session_factory):
    today = date(2026, 11, 20)
    twse = FakeTwse(published=date(2026, 11, 19))  # today's reports not out yet
    sync = TwMarketSync(session_factory, twse, sleep=_no_sleep)
    reading = await sync._trading_day(today, floor=date(2026, 11, 1))
    assert reading.day == date(2026, 11, 19)


@pytest.mark.asyncio
@pytest.mark.database
async def test_a_day_with_mi_index_but_no_pe_report_steps_back(session_factory):
    twse = FakeTwse(published=date(2026, 11, 20), missing_bwibbu=date(2026, 11, 20))
    reading = await TwMarketSync(session_factory, twse, sleep=_no_sleep)._trading_day(
        date(2026, 11, 20), floor=date(2026, 11, 1)
    )
    assert reading.day == date(2026, 11, 19)


@pytest.mark.asyncio
@pytest.mark.database
async def test_requests_are_paced(session_factory):
    waits = []

    async def sleep(seconds):
        waits.append(seconds)

    twse = FakeTwse(published=date(2026, 11, 20))
    await TwMarketSync(session_factory, twse, sleep=sleep)._trading_day(date(2026, 11, 20), floor=date(2026, 11, 1))
    assert len(waits) == 2 and all(w >= 3 for w in waits)  # three requests, two gaps


# ── The endpoint ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.api
async def test_endpoint_without_history_says_unavailable(client):
    r = client.get("/api/v1/market/tw-cape")
    assert r.status_code == 200
    assert r.json()["data"] == {"available": False}


@pytest.mark.asyncio
@pytest.mark.api
async def test_endpoint_reads_the_cape_without_signing_in(client, async_session):
    for i, m in enumerate(_months(130)):
        # Prices rising over flat earnings (5 per index point): P/E climbs with them.
        async_session.add(TwMarketMonth(month=m, as_of=m, taiex=100 + i, market_pe=(100 + i) / 5,
                                        companies=900, cpi=100, is_final=True))
    await async_session.commit()
    body = client.get("/api/v1/market/tw-cape").json()["data"]
    assert body["available"] is True
    assert body["band"] == "expensive"  # rising prices over flat earnings
    assert body["percentile"] == 100.0
    assert body["history"][-1]["month"] == _months(130)[-1].isoformat()[:7]
    assert set(body) >= {"asOf", "cape", "since", "low", "high", "taiex", "marketPe"}
