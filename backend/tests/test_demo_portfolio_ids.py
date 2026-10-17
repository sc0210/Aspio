"""Demo holding ids must survive across requests.

The demo portfolio is rebuilt on every unauthenticated GET /portfolio/, and each
holding used to take a fresh uuid4(). That made every id-based route into a demo
holding — /portfolio/edit/[id] above all — impossible to resolve: by the time the
edit page asked for the record, its id had already been replaced.

The ids are also pinned to UUID4 by PortfolioResponse, so a deterministic-but-v5
id (uuid5) fails validation and 500s the endpoint. Both properties are checked
here because breaking either one reintroduces a user-visible failure.
"""

import uuid

import pytest

from app.modules.portfolio.routers.portfolio_root import _demo_holding_id

DEMO_SYMBOLS = ["AAPL", "GOOGL", "BTC-USD"]


@pytest.mark.unit
@pytest.mark.parametrize("symbol", DEMO_SYMBOLS)
def test_demo_holding_id_is_stable_across_calls(symbol):
    assert _demo_holding_id(symbol) == _demo_holding_id(symbol)


@pytest.mark.unit
@pytest.mark.parametrize("symbol", DEMO_SYMBOLS)
def test_demo_holding_id_is_uuid4(symbol):
    # PortfolioResponse pins this field to UUID4; a v5 id fails with uuid_version
    assert uuid.UUID(_demo_holding_id(symbol)).version == 4


@pytest.mark.unit
def test_demo_holding_ids_are_distinct_per_symbol():
    ids = [_demo_holding_id(s) for s in DEMO_SYMBOLS]
    assert len(set(ids)) == len(ids)


@pytest.mark.unit
def test_demo_holding_id_handles_an_unmapped_symbol():
    # A new demo holding must not need a lookup table kept in sync — an earlier
    # version indexed a dict here and would KeyError, 500ing the demo endpoint.
    first = _demo_holding_id("SOME-NEW-SYMBOL")
    assert uuid.UUID(first).version == 4
    assert first == _demo_holding_id("SOME-NEW-SYMBOL")
