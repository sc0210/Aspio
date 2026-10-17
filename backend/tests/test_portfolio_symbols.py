"""One security, one stored spelling.

These pin the boundary rule. The bug they guard against is not a crash: both
"0050" and "0050.TW" are accepted everywhere, each accumulates its own separate
row set in `historical_prices`, and every history-walking calculation then
answers differently depending on which spelling a lot happens to carry — with
nothing surfacing that the other half of the series exists.
"""

import pytest
from pydantic import ValidationError

from app.modules.portfolio.schemas import HoldingCreate, TransactionCreate
from app.modules.portfolio.symbols import (
    canonical_symbol,
    canonical_symbol_for_asset,
    is_tw_code,
    looks_like_stripped_tw_code,
    symbol_lookup_variants,
)


class TestCanonicalSymbol:
    @pytest.mark.unit
    @pytest.mark.parametrize(
        "raw,expected",
        [
            # Taiwan: the exchange's own bare code, never Yahoo's suffix.
            ("0050.TW", "0050"),
            ("0050", "0050"),
            ("2330.TWO", "2330"),
            ("006208", "006208"),
            # Leveraged/inverse ETFs carry a class letter — 元大台灣50正2 is
            # 00631L. Requiring all digits left that whole class un-canonicalised.
            ("00631L.TW", "00631L"),
            ("00632R", "00632R"),
            # Crypto is NOT resolved from the string alone — see the asset-type
            # tests below for why.
            ("BTC", "BTC"),
            ("BTC-USD", "BTC-USD"),
            ("eth", "ETH"),
            # US tickers pass through untouched.
            ("AAPL", "AAPL"),
            ("vt", "VT"),
            ("  VXUS  ", "VXUS"),
            # The app's own bookkeeping rows are not securities and must not be
            # rewritten into tickers that do not exist.
            ("CASH-TWD", "CASH-TWD"),
            ("USDT-LEND", "USDT-LEND"),
            ("CRYPTO", "CRYPTO"),
            ("ANNUAL-BUDGET", "ANNUAL-BUDGET"),
            ("", ""),
            (None, ""),
        ],
    )
    def test_canonical_form(self, raw, expected):
        assert canonical_symbol(raw) == expected

    @pytest.mark.unit
    @pytest.mark.parametrize("raw", ["0050.TW", "BTC", "AAPL", "CASH-TWD", "2330"])
    def test_is_idempotent(self, raw):
        once = canonical_symbol(raw)
        assert canonical_symbol(once) == once

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("0050", True), ("0050.TW", True), ("2330.TWO", True),
            ("00631L", True), ("00631L.TW", True),
            ("AAPL", False), ("BTC-USD", False), ("50", False),
        ],
    )
    def test_is_tw_code(self, raw, expected):
        assert is_tw_code(raw) is expected


class TestCryptoNeedsTheAssetType:
    """Every bare crypto base is also a live US equity ticker.

    BTC is Grayscale's Bitcoin Mini Trust, LTC is LTC Properties (a REIT), SOL
    is ReneSola, ADA is Adams Diversified. Resolving that ambiguity from the
    string alone renames a real equity position into a coin — permanently, since
    the repair migration's downgrade is a no-op.
    """

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "raw,asset_type,expected",
        [
            ("BTC", "crypto", "BTC-USD"),
            ("ltc", "crypto", "LTC-USD"),
            # asset_type_enum carries both spellings and the app treats them as
            # one; matching only "crypto" left these stored bare and ambiguous.
            ("BTC", "cryptocurrency", "BTC-USD"),
            ("eth", "CryptoCurrency", "ETH-USD"),
            # The same tickers held as the equities they also name.
            ("LTC", "reit", "LTC"),
            ("SOL", "stock", "SOL"),
            ("BTC", None, "BTC"),
            # Already a pair, or bookkeeping — untouched either way.
            ("BTC-USD", "crypto", "BTC-USD"),
            ("USDT-LEND", "crypto", "USDT-LEND"),
            ("CRYPTO", "crypto", "CRYPTO"),
            # The Taiwan rule still applies regardless of type.
            ("0050.TW", "etf", "0050"),
        ],
    )
    def test_only_a_crypto_holding_gets_the_pair_form(self, raw, asset_type, expected):
        assert canonical_symbol_for_asset(raw, asset_type) == expected


class TestStrippedTaiwanCodes:
    """Excel coerces a ticker column to a number when it opens a CSV, so "0050"
    reaches the importer as 50. 80 lots were stored that way, under symbols no
    provider has ever heard of."""

    @pytest.mark.unit
    @pytest.mark.parametrize("raw", ["50", "713", "6"])
    def test_impossible_codes_are_reported(self, raw):
        assert looks_like_stripped_tw_code(raw) is True

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "raw",
        [
            "0050",  # the intact form
            "2330",  # a real 4-digit stock code
            "6208",  # stripped "006208" — indistinguishable from a TPEx code
            "AAPL",
            "",
        ],
    )
    def test_possible_codes_are_left_alone(self, raw):
        assert looks_like_stripped_tw_code(raw) is False


class TestSchemaBoundary:
    """The canonical form is applied where data enters, not where it is read."""

    @pytest.mark.unit
    def test_holding_create_canonicalises_symbol(self):
        holding = HoldingCreate(
            symbol="0050.tw",
            name="元大台灣50",
            type="etf",
            exchange="TWSE",
            currency="TWD",
            market="TW",
            quantity=100,
            average_cost=105,
        )
        assert holding.symbol == "0050"

    @pytest.mark.unit
    def test_holding_create_resolves_crypto_from_its_type(self):
        holding = HoldingCreate(
            symbol="btc", name="Bitcoin", type="crypto",
            exchange="CRYPTO", currency="USD", market="CRYPTO",
            quantity=1, average_cost=100000,
        )
        assert holding.symbol == "BTC-USD"

    @pytest.mark.unit
    def test_holding_create_leaves_the_equity_that_shares_the_ticker(self):
        """LTC is LTC Properties, a NYSE REIT, as well as Litecoin."""
        holding = HoldingCreate(
            symbol="LTC", name="LTC Properties", type="stock",
            exchange="NYSE", currency="USD", market="US",
            quantity=100, average_cost=35,
        )
        assert holding.symbol == "LTC"

    @pytest.mark.unit
    def test_a_taiwan_holding_gets_its_market_corrected(self):
        """Stripping ".TW" while `market` still says "US" routes the bare code to
        the US provider, which does not know it — an empty chart and no error."""
        holding = HoldingCreate(
            symbol="0050.TW", name="元大台灣50", type="etf",
            exchange="TWSE", currency="TWD",
            quantity=100, average_cost=105,
        )
        assert (holding.symbol, holding.market) == ("0050", "TW")

    @pytest.mark.unit
    def test_the_api_rejects_what_the_importer_rejects(self):
        """The guard lived only in the import parser, so the API and the Add
        Holding form still created the rows the repair migration exists to fix."""
        with pytest.raises(ValidationError):
            HoldingCreate(
                symbol="50", name="元大台灣50", type="etf",
                exchange="TWSE", currency="TWD", quantity=100, average_cost=63,
            )

    @pytest.mark.unit
    def test_a_transaction_keeps_the_taiwan_rule(self):
        """A transaction carries no asset type. In practice it never diverges
        from its holding: `add_holding` writes the holding's resolved symbol onto
        the transaction, and the sell path copies `holding.symbol`."""
        transaction = TransactionCreate(
            type="buy", symbol="0050.tw", quantity=1, price=105,
            currency="TWD", transaction_date="2026-08-26T00:00:00Z",
        )
        assert transaction.symbol == "0050"


class TestLookupVariants:
    """Reads still have to find rows written before the merge ran."""

    @pytest.mark.unit
    def test_taiwan_reads_both_spellings(self):
        assert set(symbol_lookup_variants("0050")) == {"0050", "0050.TW"}
        assert set(symbol_lookup_variants("0050.TW")) == {"0050", "0050.TW"}

    @pytest.mark.unit
    def test_crypto_is_never_widened(self):
        """"BTC" and "BTC-USD" are two different securities' rows, so reading
        both and preferring the freshest would price Bitcoin off a $28 ETF."""
        assert symbol_lookup_variants("BTC") == ["BTC"]
        assert symbol_lookup_variants("BTC-USD") == ["BTC-USD"]

    @pytest.mark.unit
    def test_us_ticker_has_one_spelling(self):
        assert symbol_lookup_variants("AAPL") == ["AAPL"]


class TestImportGuard:
    """The import preview is where a corrupted ticker is still recoverable.

    An 0050 that Excel turned into 50 imports without complaint, prices at
    nothing forever, and only shows up much later as a holding whose chart is
    empty — so the file, not the database, is where it has to be caught.
    """

    @staticmethod
    def _trade_log(stock_id: str) -> bytes:
        return (
            "Date,Type,StockID,Currency,Shares,Price per shares\n"
            f"2025/11/12,買進,{stock_id},TWD,1000,63.65\n"
        ).encode()

    @pytest.mark.asyncio
    async def test_stripped_code_is_rejected_with_the_reason(self):
        from app.modules.portfolio.services import parse_import_file

        result = await parse_import_file(self._trade_log("50"), "trades.csv")

        assert result["holdings"] == []
        assert len(result["errors"]) == 1
        assert "leading zeros" in result["errors"][0]

    @pytest.mark.asyncio
    async def test_intact_code_imports(self):
        from app.modules.portfolio.services import parse_import_file

        result = await parse_import_file(self._trade_log("0050"), "trades.csv")

        assert result["errors"] == []
        assert [h["symbol"] for h in result["holdings"]] == ["0050"]

    @pytest.mark.asyncio
    async def test_yahoo_suffix_imports_under_the_bare_code(self):
        from app.modules.portfolio.services import parse_import_file

        result = await parse_import_file(self._trade_log("0050.TW"), "trades.csv")

        assert [h["symbol"] for h in result["holdings"]] == ["0050"]


class TestPriceWriteBoundary:
    """`historical_prices` is the table the split actually hurt, and it has more
    than one writer: the nightly sync stores the bare Taiwan code, while the
    trend page's benchmark lookup stores whatever ticker Yahoo was asked for.
    Canonicalising in the repository is what stops the second one from
    re-splitting a series the merge just joined."""

    @pytest.mark.asyncio
    async def test_upsert_stores_the_canonical_spelling(self):
        from unittest.mock import AsyncMock, MagicMock

        from app.modules.portfolio.historical_price_repository import (
            HistoricalPriceRepository,
        )

        session = MagicMock()
        session.execute = AsyncMock()
        session.commit = AsyncMock()

        written = await HistoricalPriceRepository(session).bulk_upsert_prices(
            [
                {"symbol": "0050.TW", "market": "TW", "date": "2026-08-26", "close": 105.9},
                {"symbol": "btc", "market": "CRYPTO", "date": "2026-08-26", "close": 77881.5},
            ]
        )

        assert written == 2
        params = session.execute.call_args[0][0].compile().params
        stored = [v for k, v in params.items() if k.startswith("symbol_")]
        # "btc" stays bare: the price table has no asset type, and mapping it to
        # the pair here is how a benchmark request for the Grayscale ETF would
        # write $28 closes into Bitcoin's series.
        assert stored == ["0050", "BTC"]
