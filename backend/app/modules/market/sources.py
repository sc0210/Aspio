"""Fetch and parse the TWSE and DGBAS data behind the Taiwan CAPE.

One trading day of the listed market takes three TWSE after-hours reports:

* MI_INDEX  — every listed stock's close, and the TAIEX close (from about 2009;
              older reports carry no index tables, so FMTQIK supplies it)
* BWIBBU_d  — every stock's P/E (trailing four quarters); "-" when not positive
* MI_QFIIS  — every stock's shares issued

so a stock's market cap is close x shares and its earnings cap / P/E. These are
the dated report pages (www.twse.com.tw/rwd), which go back to 2005; the
openapi.twse.com.tw endpoints serve only the latest day. TWSE blocks clients
that ask faster than about three requests in five seconds, so callers pace
requests (``REQUEST_INTERVAL_SECONDS``).

CPI is DGBAS's monthly general index from the data.gov.tw dataset 6019.
"""

import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date
from typing import Dict, Optional

import httpx

logger = logging.getLogger(__name__)

TWSE_BASE = "https://www.twse.com.tw/rwd/zh"
# DGBAS re-uploads the CPI file under a new path now and then, so its current
# URL is read from the data.gov.tw catalogue entry (dataset 6019); the path
# last seen there is the fallback.
CPI_DATASET_URL = "https://data.gov.tw/api/v2/rest/dataset/6019"
CPI_XML_URL = "https://ws.dgbas.gov.tw/001/Upload/461/relfile/11525/230555/pr0101a1m.xml"
REQUEST_INTERVAL_SECONDS = 3.5
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Aspiro market data)"}
TAIEX_NAME = "發行量加權股價指數"
CPI_GENERAL_PREFIX = "總指數"


class NoTradingData(Exception):
    """TWSE has no report for that day: a holiday, a weekend, or not yet published."""


@dataclass(frozen=True)
class MarketDay:
    day: date
    taiex: float
    market_pe: float
    companies: int


def _number(value) -> Optional[float]:
    text = str(value).replace(",", "").strip()
    try:
        n = float(text)
    except ValueError:
        return None
    return n


def _column(fields, name: str) -> int:
    try:
        return list(fields).index(name)
    except ValueError as e:
        raise ValueError(f"TWSE report has no {name!r} column: {fields}") from e


def _require_ok(payload: dict) -> None:
    if payload.get("stat") != "OK":
        raise NoTradingData(str(payload.get("stat")))


def parse_mi_index(payload: dict) -> tuple[Optional[float], Dict[str, float]]:
    """(TAIEX close or None, {code: close}) from a MI_INDEX report.

    Reports from the 2000s have the closing prices but no index tables, so the
    TAIEX can be absent; the caller then reads it from FMTQIK.
    """
    _require_ok(payload)
    taiex: Optional[float] = None
    closes: Dict[str, float] = {}
    for table in payload.get("tables", []):
        fields = table.get("fields") or []
        title = table.get("title") or ""
        if fields and fields[0] == "指數" and taiex is None:
            for row in table.get("data", []):
                if row and row[0] == TAIEX_NAME:
                    taiex = _number(row[1])
        if "每日收盤行情" in title:
            code_i, close_i = _column(fields, "證券代號"), _column(fields, "收盤價")
            for row in table.get("data", []):
                close = _number(row[close_i])
                if close and close > 0:
                    closes[row[code_i].strip()] = close
    if not closes:
        raise ValueError("MI_INDEX report has no closing prices")
    return taiex, closes


def parse_fmtqik_taiex(payload: dict, day: date) -> float:
    """The TAIEX close on `day` from a FMTQIK (daily market summary) month.

    Its dates are in the ROC calendar: " 94/12/30" is 2005-12-30.
    """
    _require_ok(payload)
    fields = payload.get("fields") or []
    date_i, taiex_i = _column(fields, "日期"), _column(fields, TAIEX_NAME)
    wanted = f"{day.year - 1911}/{day.month:02d}/{day.day:02d}"
    for row in payload.get("data", []):
        if str(row[date_i]).strip() == wanted:
            value = _number(row[taiex_i])
            if value:
                return value
    raise NoTradingData(f"FMTQIK has no TAIEX for {day}")


def parse_codes(payload: dict, value_field: str) -> Dict[str, float]:
    """{code: value} for one numeric column of a BWIBBU_d or MI_QFIIS report.

    Non-numeric values ("-", blank) are left out.
    """
    _require_ok(payload)
    fields = payload.get("fields") or []
    code_i, value_i = _column(fields, "證券代號"), _column(fields, value_field)
    out: Dict[str, float] = {}
    for row in payload.get("data", []):
        value = _number(row[value_i])
        if value is not None:
            out[str(row[code_i]).strip()] = value
    return out


def market_day(
    day: date, mi_index: dict, bwibbu: dict, qfiis: dict, taiex: Optional[float] = None
) -> MarketDay:
    """The TAIEX and the market's P/E from one day's three reports.

    The P/E is total cap over total earnings of companies with a positive P/E,
    TWSE's own convention: a loss has no P/E. That leaves loss-makers out of
    the earnings rather than subtracting them, which flatters earnings in a bad
    year; they were about 3% of market cap in the months checked.
    """
    reported, closes = parse_mi_index(mi_index)
    taiex = reported or taiex
    if not taiex:
        raise ValueError(f"No TAIEX for {day}: MI_INDEX lacks it and none was given")
    pes = parse_codes(bwibbu, "本益比")
    shares = parse_codes(qfiis, "發行股數")
    cap = earnings = 0.0
    companies = 0
    for code, pe in pes.items():
        close, issued = closes.get(code), shares.get(code)
        if pe <= 0 or not close or not issued:
            continue
        stock_cap = close * issued
        cap += stock_cap
        earnings += stock_cap / pe
        companies += 1
    if earnings <= 0:
        raise ValueError(f"No earnings computed for {day}")
    return MarketDay(day=day, taiex=taiex, market_pe=cap / earnings, companies=companies)


def parse_cpi_xml(content: bytes) -> Dict[date, float]:
    """{first of month: general CPI} from the DGBAS dataset (2021 = 100).

    The URL comes from a remote catalogue, so a payload that declares a DTD or
    entities is refused before parsing: the stdlib parser would expand them.
    """
    head = content[:4096]
    if b"<!DOCTYPE" in head or b"<!ENTITY" in head:
        raise ValueError("CPI XML declares a DTD or entities; refusing to parse it")
    root = ET.fromstring(content)
    out: Dict[date, float] = {}
    for record in root:
        values = {child.tag: (child.text or "").strip() for child in record}
        if not values.get("Item", "").startswith(CPI_GENERAL_PREFIX):
            continue
        if values.get("TYPE") != "原始值" or values.get("FREQ") != "M":
            continue
        period = values.get("TIME_PERIOD", "")  # e.g. 2026M10
        value = _number(values.get("Item_VALUE"))
        if value is None or "M" not in period:
            continue
        year, month = period.split("M")
        out[date(int(year), int(month), 1)] = value
    return out


def cpi_url_from_catalogue(payload: dict) -> Optional[str]:
    """The XML download URL in a data.gov.tw dataset entry, or None."""
    for resource in (payload.get("result") or {}).get("distribution") or []:
        url = resource.get("resourceDownloadUrl")
        if url and str(resource.get("resourceFormat", "")).upper() == "XML":
            return url
    return None


class MarketDataClient:
    """The HTTP side: one call per report, paced by the caller."""

    def __init__(self, client: httpx.AsyncClient):
        self._client = client

    async def _twse(self, path: str, params: dict) -> dict:
        response = await self._client.get(
            f"{TWSE_BASE}/{path}", params={**params, "response": "json"}, headers=_HEADERS, timeout=30
        )
        response.raise_for_status()
        return response.json()

    async def mi_index(self, day: date) -> dict:
        return await self._twse("afterTrading/MI_INDEX", {"date": day.strftime("%Y%m%d"), "type": "ALLBUT0999"})

    async def bwibbu(self, day: date) -> dict:
        return await self._twse("afterTrading/BWIBBU_d", {"date": day.strftime("%Y%m%d"), "selectType": "ALL"})

    async def qfiis(self, day: date) -> dict:
        return await self._twse("fund/MI_QFIIS", {"date": day.strftime("%Y%m%d"), "selectType": "ALLBUT0999"})

    async def fmtqik(self, day: date) -> dict:
        """The daily market summary for `day`'s month (one row per trading day)."""
        return await self._twse("afterTrading/FMTQIK", {"date": day.strftime("%Y%m01")})

    async def _cpi_url(self) -> str:
        try:
            response = await self._client.get(CPI_DATASET_URL, headers=_HEADERS, timeout=30)
            response.raise_for_status()
            return cpi_url_from_catalogue(response.json()) or CPI_XML_URL
        except Exception as e:
            logger.warning("data.gov.tw catalogue unavailable, using the last known CPI URL: %s", e)
            return CPI_XML_URL

    async def cpi(self) -> Dict[date, float]:
        url = await self._cpi_url()
        response = await self._client.get(url, headers=_HEADERS, timeout=120, follow_redirects=True)
        response.raise_for_status()
        return parse_cpi_xml(response.content)
