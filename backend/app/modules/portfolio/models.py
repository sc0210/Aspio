"""
Portfolio database models for Aspiro FastAPI backend.

This module defines SQLAlchemy models for portfolio and investment tracking,
supporting multi-asset classes and regional investment products.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    and_,
    text,
    Date,
    BigInteger,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from ...core.database import Base
import enum


class HoldingWalletType(str, enum.Enum):
    """Wallet type for portfolio holdings"""

    PORTFOLIO = "portfolio"  # Invested assets (stocks, ETF, crypto)
    EMERGENCY = "emergency"  # Emergency fund, not for trading


class Portfolio(Base):
    """Portfolio model for tracking investment portfolios"""

    __tablename__ = "portfolios"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Foreign keys
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # Basic information
    name = Column(String(100), nullable=False)
    description = Column(Text)
    currency = Column(String(3), nullable=False, default="USD")

    # Portfolio settings
    is_default = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    auto_update = Column(Boolean, default=True, nullable=False)

    # Performance tracking
    total_value = Column(Numeric(15, 2), default=0.00, nullable=False)
    total_cost = Column(Numeric(15, 2), default=0.00, nullable=False)
    total_gain_loss = Column(Numeric(15, 2), default=0.00, nullable=False)
    total_gain_loss_percentage = Column(Numeric(8, 4), default=0.0000, nullable=False)

    # Market data
    last_price_update_at = Column(DateTime(timezone=True))
    last_rebalance_at = Column(DateTime(timezone=True))

    # Metadata for additional configuration
    item_metadata = Column(JSON, default=dict, nullable=False)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=datetime.utcnow,
    )

    # Relationships
    holdings = relationship(
        "PortfolioHolding",
        back_populates="portfolio",
        cascade="all, delete-orphan",
        primaryjoin="and_(Portfolio.id==PortfolioHolding.portfolio_id, PortfolioHolding.is_active==True)",
    )
    transactions = relationship(
        "PortfolioTransaction", back_populates="portfolio", cascade="all, delete-orphan"
    )
    # Indexes
    __table_args__ = (
        Index("idx_portfolios_user_id_active", "user_id", "is_active"),
        Index("idx_portfolios_user_id_default", "user_id", "is_default"),
        Index("idx_portfolios_updated_at", "updated_at"),
        Index("idx_portfolios_default_updated", "is_default", "updated_at"),
        UniqueConstraint("user_id", "name", name="uq_portfolios_user_name"),
        # At most one ACTIVE default portfolio per user, enforced at the DB
        # level. create/update unset other defaults before setting a new one,
        # but that unset-then-set is not atomic — two concurrent writes could
        # both commit a default. This partial unique index makes the second
        # write fail instead of silently creating a duplicate that would break
        # get_default_portfolio (MultipleResultsFound).
        Index(
            "uq_portfolios_one_active_default_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("is_default AND is_active"),
        ),
    )

    def __repr__(self):
        return f"<Portfolio(id={self.id}, name='{self.name}', user_id={self.user_id})>"


class PortfolioHolding(Base):
    """Portfolio holding model for individual securities"""

    __tablename__ = "portfolio_holdings"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Foreign keys
    portfolio_id = Column(
        UUID(as_uuid=True), ForeignKey("portfolios.id"), nullable=False, index=True
    )
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # Wallet classification
    wallet_type = Column(
        Enum(
            HoldingWalletType,
            name="holding_wallet_type",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=HoldingWalletType.PORTFOLIO,
        index=True,
    )

    # Security information
    symbol = Column(String(20), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    type = Column(
        Enum(
            "stock",
            "etf",
            "crypto",
            "cryptocurrency",
            "bond",
            "mutual_fund",
            "reit",
            "commodity",
            "forex",
            "cpf",
            "gold_savings",
            "regional_fund",
            "cash",
            "lending",
            name="asset_type_enum",
        ),
        nullable=False,
        index=True,
    )

    # Market information
    exchange = Column(String(10), nullable=False)
    currency = Column(String(3), nullable=False, default="USD")
    market = Column(
        String(10), nullable=False, default="US"
    )  # Market identifier (US, TW, SG, etc.)
    sector = Column(String(50))
    region = Column(String(50))  # For regional investments

    # Holdings data
    quantity = Column(Numeric(18, 8), nullable=False, default=0.0)
    # Ten decimal places, not four: average cost and a hand-set price are often
    # derived from a total the user typed (cost / quantity, value / quantity),
    # and at four places 10,000 over 10,688.88 units came back as 10,000.52.
    average_cost = Column(Numeric(20, 10), nullable=False, default=0.0)
    current_price = Column(Numeric(20, 10), nullable=False, default=0.0)
    # Previous session's close as the price provider reports it, captured
    # alongside current_price. Preferred over deriving it from historical_prices,
    # which goes wrong whenever the nightly sync is missing a session.
    previous_close = Column(Numeric(12, 4), nullable=True)

    # Calculated fields
    total_cost = Column(Numeric(15, 2), nullable=False, default=0.0)
    total_value = Column(Numeric(15, 2), nullable=False, default=0.0)
    gain_loss = Column(Numeric(15, 2), nullable=False, default=0.0)
    gain_loss_percentage = Column(
        Numeric(8, 4), nullable=False, default=0.0
    )  # Simple ROI
    irr = Column(Numeric(8, 6), nullable=True)  # Annualized Internal Rate of Return

    # Dividend/income tracking
    dividend_yield = Column(Numeric(8, 4))
    annual_dividend = Column(Numeric(10, 2))

    # Status
    is_active = Column(Boolean, default=True, nullable=False)

    # Market data timestamps
    last_price_update_at = Column(DateTime(timezone=True))

    # Purchase tracking for individual lots
    purchase_date = Column(DateTime(timezone=True), nullable=False)
    notes = Column(Text)

    # Metadata for additional data (e.g., regional investment specifics)
    item_metadata = Column(JSON, default=dict, nullable=False)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=datetime.utcnow,
    )

    # Relationships
    portfolio = relationship("Portfolio", back_populates="holdings")
    transactions = relationship("PortfolioTransaction", back_populates="holding")
    dividends = relationship(
        "Dividend",
        foreign_keys="[Dividend.holding_id]",
        back_populates="holding",
        cascade="all, delete-orphan",
    )

    # Indexes
    __table_args__ = (
        Index("idx_holdings_portfolio_symbol", "portfolio_id", "symbol"),
        Index(
            "idx_holdings_portfolio_symbol_date",
            "portfolio_id",
            "symbol",
            "purchase_date",
        ),
        Index("idx_holdings_user_symbol", "user_id", "symbol"),
        Index("idx_holdings_user_active", "user_id", "is_active"),
        Index("idx_holdings_type_active", "type", "is_active"),
        Index("idx_holdings_exchange", "exchange"),
        Index("idx_holdings_sector", "sector"),
        Index("idx_holdings_updated_at", "updated_at"),
        Index("idx_holdings_currency", "currency"),
        Index("idx_holdings_symbol_active", "symbol", "is_active"),
    )

    def __repr__(self):
        return f"<PortfolioHolding(id={self.id}, symbol='{self.symbol}', quantity={self.quantity})>"


class PortfolioTransaction(Base):
    """Portfolio transaction model for tracking buys, sells, and other activities"""

    __tablename__ = "portfolio_transactions"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Foreign keys
    portfolio_id = Column(
        UUID(as_uuid=True), ForeignKey("portfolios.id"), nullable=False, index=True
    )
    holding_id = Column(
        UUID(as_uuid=True), ForeignKey("portfolio_holdings.id"), index=True
    )  # Optional for cash transactions
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # Transaction details
    type = Column(
        Enum(
            "buy",
            "sell",
            "dividend",
            "split",
            "transfer",
            "fee",
            "tax",
            "bonus",
            "rights",
            "spin_off",
            "merger",
            "cash_in",
            "cash_out",
            name="transaction_type_enum",
        ),
        nullable=False,
        index=True,
    )

    # Security information
    symbol = Column(String(20), nullable=False, index=True)
    exchange = Column(String(10))

    # Transaction amounts
    quantity = Column(Numeric(18, 8), nullable=False, default=0.0)
    price = Column(Numeric(12, 4), nullable=False, default=0.0)
    total_amount = Column(Numeric(15, 2), nullable=False, default=0.0)
    fees = Column(Numeric(10, 2), nullable=False, default=0.0)
    taxes = Column(Numeric(10, 2), nullable=False, default=0.0)

    # Currency
    currency = Column(String(3), nullable=False, default="USD")

    # Transaction date and execution details
    transaction_date = Column(DateTime(timezone=True), nullable=False, index=True)
    settlement_date = Column(DateTime(timezone=True))

    # Broker/exchange details
    broker = Column(String(50))
    reference_id = Column(String(100))  # Broker's transaction ID
    order_id = Column(String(100))  # Order reference

    # Notes and metadata
    notes = Column(Text)
    item_metadata = Column(JSON, default=dict, nullable=False)

    # Cost basis tracking (for sell transactions)
    cost_basis_method = Column(String(20))  # FIFO, LIFO, AVERAGE, SPECIFIC
    lot_ids = Column(JSON)  # List of lot IDs used for SPECIFIC method
    cost_basis = Column(Numeric(15, 2))  # Total cost basis for this sale
    capital_gain = Column(Numeric(15, 2))  # Capital gain/loss (proceeds - cost basis)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=datetime.utcnow,
    )

    # Relationships
    portfolio = relationship("Portfolio", back_populates="transactions")
    holding = relationship("PortfolioHolding", back_populates="transactions")

    # Indexes
    __table_args__ = (
        Index("idx_portfolio_txn_portfolio_date", "portfolio_id", "transaction_date"),
        Index("idx_portfolio_txn_user_date", "user_id", "transaction_date"),
        Index("idx_portfolio_txn_symbol_date", "symbol", "transaction_date"),
        Index("idx_portfolio_txn_type", "type"),
        Index("idx_portfolio_txn_reference", "reference_id"),
        Index("idx_portfolio_transactions_created_at", "created_at"),
        Index("idx_portfolio_transactions_cost_basis_method", "cost_basis_method"),
    )

    def __repr__(self):
        return f"<PortfolioTransaction(id={self.id}, type='{self.type}', symbol='{self.symbol}', quantity={self.quantity})>"


class MarketData(Base):
    """Market data model for storing current and historical prices"""

    __tablename__ = "market_data"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Security identification
    symbol = Column(String(20), nullable=False, index=True)
    exchange = Column(String(10), nullable=False)
    type = Column(
        Enum(
            "stock",
            "etf",
            "crypto",
            "cryptocurrency",
            "bond",
            "mutual_fund",
            "reit",
            "commodity",
            "forex",
            "index",
            name="market_data_type_enum",
        ),
        nullable=False,
        index=True,
    )

    # Price data
    price = Column(Numeric(12, 4), nullable=False, default=0.0)
    open_price = Column(Numeric(12, 4))
    high_price = Column(Numeric(12, 4))
    low_price = Column(Numeric(12, 4))
    previous_close = Column(Numeric(12, 4))

    # Volume and market data
    volume = Column(Numeric(20, 0))
    market_cap = Column(Numeric(20, 2))

    # Currency
    currency = Column(String(3), nullable=False, default="USD")

    # Data timestamp
    data_timestamp = Column(DateTime(timezone=True), nullable=False, index=True)

    # Data source and quality
    source = Column(
        String(50), nullable=False
    )  # e.g., "alpha_vantage", "polygon", "manual"

    # Timestamps
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=datetime.utcnow,
    )

    # Indexes
    __table_args__ = (
        Index("idx_market_data_symbol_exchange", "symbol", "exchange"),
        Index("idx_market_data_timestamp", "data_timestamp"),
        Index("idx_market_data_updated_at", "updated_at"),
        Index("idx_market_data_source", "source"),
        UniqueConstraint(
            "symbol", "exchange", "data_timestamp", name="uq_market_data_symbol_time"
        ),
    )

    def __repr__(self):
        return f"<MarketData(symbol='{self.symbol}', price={self.price}, timestamp={self.data_timestamp})>"


class CurrencyRate(Base):
    """Currency exchange rate model"""

    __tablename__ = "currency_rates"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Currency pair
    from_currency = Column(String(3), nullable=False, index=True)
    to_currency = Column(String(3), nullable=False, index=True)

    # Exchange rate
    rate = Column(Numeric(12, 6), nullable=False)

    # Rate metadata
    source = Column(String(50), nullable=False)

    # Timestamps
    rate_timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=datetime.utcnow,
    )

    # Indexes
    __table_args__ = (
        Index("idx_currency_rates_pair", "from_currency", "to_currency"),
        Index("idx_currency_rates_timestamp", "rate_timestamp"),
        Index("idx_currency_rates_updated_at", "updated_at"),
        UniqueConstraint(
            "from_currency",
            "to_currency",
            "rate_timestamp",
            name="uq_currency_rates_pair_time",
        ),
    )

    def __repr__(self):
        return f"<CurrencyRate({self.from_currency}/{self.to_currency}={self.rate})>"


class HistoricalPrice(Base):
    """Historical price data model for caching daily OHLCV data"""

    __tablename__ = "historical_prices"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Security identification
    symbol = Column(String(20), nullable=False, index=True)
    exchange = Column(String(10))
    market = Column(String(10), nullable=False, index=True)  # TW, US, CRYPTO, etc.

    # Date (primary dimension for time-series data)
    date = Column(Date, nullable=False, index=True)

    # OHLCV data
    open = Column(Numeric(12, 4))
    high = Column(Numeric(12, 4))
    low = Column(Numeric(12, 4))
    close = Column(Numeric(12, 4), nullable=False)  # Close is mandatory
    volume = Column(BigInteger)
    adjusted_close = Column(Numeric(12, 4))  # For splits/dividends adjusted price

    # Data source tracking
    source = Column(
        String(20), nullable=False, default="finlab"
    )  # finlab, yahoo, tradingview
    currency = Column(String(3), nullable=False, default="USD")

    # Metadata
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=datetime.utcnow,
    )

    # Constraints and Indexes
    __table_args__ = (
        UniqueConstraint("symbol", "date", name="uq_historical_prices_symbol_date"),
        Index("idx_historical_prices_symbol_date", "symbol", "date"),
        Index("idx_historical_prices_market_date", "market", "date"),
        Index("idx_historical_prices_date", "date"),
        # Index for recent data queries (most common - sorted descending)
        Index(
            "idx_historical_prices_symbol_recent",
            "symbol",
            "date",
            postgresql_using="btree",
            postgresql_ops={"date": "DESC"},
        ),
    )

    def __repr__(self):
        return f"<HistoricalPrice(symbol={self.symbol}, date={self.date}, close={self.close})>"


class Dividend(Base):
    """Dividend payment tracking model"""

    __tablename__ = "dividends"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Foreign keys
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    holding_id = Column(
        UUID(as_uuid=True),
        ForeignKey("portfolio_holdings.id"),
        nullable=True,
        index=True,
    )

    # Symbol information (stored for reference even if holding is deleted)
    symbol = Column(String(20), nullable=False, index=True)
    name = Column(String(255))

    # Dividend details
    payment_date = Column(Date, nullable=False, index=True)
    ex_dividend_date = Column(Date)
    record_date = Column(Date)
    amount_per_share = Column(Numeric(12, 4), nullable=False)
    shares_owned = Column(Numeric(18, 8), nullable=False)
    total_amount = Column(Numeric(15, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="USD")

    # Tax information
    tax_withheld = Column(Numeric(15, 2), default=0.00)
    net_amount = Column(Numeric(15, 2))

    # Reinvestment tracking
    is_reinvested = Column(Boolean, default=False, nullable=False)
    reinvestment_holding_id = Column(
        UUID(as_uuid=True), ForeignKey("portfolio_holdings.id"), nullable=True
    )
    reinvestment_shares = Column(Numeric(18, 8))
    reinvestment_price = Column(Numeric(12, 4))

    # Status
    status = Column(
        String(20), nullable=False, default="received"
    )  # received, pending, estimated

    # Notes
    notes = Column(Text)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=datetime.utcnow,
    )

    # Relationships
    holding = relationship(
        "PortfolioHolding", foreign_keys=[holding_id], back_populates="dividends"
    )
    reinvestment_holding = relationship(
        "PortfolioHolding", foreign_keys=[reinvestment_holding_id]
    )

    # Indexes
    __table_args__ = (
        Index("idx_dividends_user_payment_date", "user_id", "payment_date"),
        Index("idx_dividends_symbol_payment_date", "symbol", "payment_date"),
        Index("idx_dividends_holding_id", "holding_id"),
    )

    def __repr__(self):
        return f"<Dividend(symbol={self.symbol}, payment_date={self.payment_date}, amount={self.total_amount})>"
