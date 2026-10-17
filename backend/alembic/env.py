"""Alembic environment configuration for Aspiro FastAPI backend"""

import asyncio
import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Put the BACKEND root on the path — not backend/app — so everything here
# imports through the same `app.` package the application itself uses.
#
# This previously inserted backend/app and imported `database.base`, which
# Python loads as a SEPARATE module object from `app.database.base`. That gave
# two distinct Base classes with two distinct MetaData registries: models
# registered on `app.database.base.Base` (49 tables) while target_metadata
# pointed at the other one, which stayed EMPTY. Autogenerate then compared an
# empty metadata against the live database and emitted DROP TABLE for every
# table in it — a migration that, if applied, drops the whole schema. Keep these
# imports fully qualified.
import sys
from pathlib import Path
backend_root = Path(__file__).parent.parent
sys.path.insert(0, str(backend_root))

# Import application components
from app.core.config import get_settings
from app.database.base import Base, import_all_models

# Import all models to ensure they're registered with SQLAlchemy
import_all_models()

if not Base.metadata.tables:
    # A path or import regression has emptied the registry again. Fail loudly:
    # a silent empty metadata turns autogenerate into a schema-wipe generator.
    raise RuntimeError(
        "Alembic target_metadata is empty — no models registered on Base. "
        "Autogenerate would emit DROP TABLE for every table. Check that this "
        "module and app/modules/*/models.py both import app.database.base."
    )

# Get application settings
settings = get_settings()

# This is the Alembic Config object
config = context.config

# Override sqlalchemy.url with environment variable if available
if settings.DATABASE_URL:
    config.set_main_option("sqlalchemy.url", settings.database_url_sync)

# Interpret the config file for Python logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set target metadata for autogenerate support
target_metadata = Base.metadata



# Alembic creates its version table with VARCHAR(32), but this repo's revision ids
# run to 40 characters (2026_05_22_add_portfolio_holding_indexes), so on a fresh
# database even `alembic stamp head` fails with "value too long". Production's
# table was widened to VARCHAR(64) by hand; create it at that width up front so a
# new database matches. A no-op wherever the table already exists. Online runs only:
# offline `--sql` output still declares VARCHAR(32), so edit that DDL by hand.
def ensure_version_table(connection: Connection) -> None:
    if connection.dialect.name != "postgresql":
        return
    from sqlalchemy import text

    connection.execute(text(
        "CREATE TABLE IF NOT EXISTS alembic_version ("
        "version_num VARCHAR(64) NOT NULL, "
        "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
    ))
    connection.commit()


# Indexes Alembic cannot compare, so `alembic check` / autogenerate would report them
# as a permanent difference between a correct database and the models. This one is
# declared with postgresql_ops={"date": "DESC"}, which Postgres stores as a descending
# column, and reflection hands back as an expression the model's plain column never
# equals. It exists in the database and in the models; only the comparison is blind.
UNCOMPARABLE_INDEXES = {"idx_historical_prices_symbol_recent"}


def include_object(obj, name, type_, reflected, compare_to):
    if type_ == "index" and name in UNCOMPARABLE_INDEXES:
        return False
    return True


# ---------------------------------------------------------------------------
# Fresh-database bootstrap
#
# The migration chain cannot build a database from nothing: it has three
# parentless roots and its early revisions ALTER tables (portfolio_holdings, ...)
# that no revision ever creates, because production's schema was built before
# Alembic was introduced. Patching 55 revisions to guard every ALTER would not make
# the result trustworthy, and a rewritten history cannot be proven equal to prod.
#
# So `scripts/migrate.sh` (which sets ALEMBIC_BOOTSTRAP_EMPTY=1) on a database that
# is EMPTY (no alembic_version row and no application tables) takes a different path,
# and a bare `alembic upgrade head` on an empty database still fails on the chain,
# on purpose: create the schema from the models
# (the source of truth the app runs against), load reference data, and stamp the
# head. Every other database - one with any revision stamped, or with application
# tables already present - goes through the normal chain, unchanged. A database at
# head is therefore still a no-op.
# ---------------------------------------------------------------------------
SEED_DIR = backend_root / "scripts" / "seed"
# Applied in this order; each file is idempotent.
SEED_FILES = ("currencies.sql", "categories.sql")


def _target_is_head() -> bool:
    """True when this run is an upgrade towards head (not stamp/downgrade/other)."""
    # get_revision_argument() has already resolved "head" to a revision id. It is
    # not available at all for commands that have no destination (check, current).
    try:
        target = context.get_revision_argument()
    except KeyError:
        return False
    heads = set(context.script.get_heads())
    if target not in heads and set(target or ()) != heads:
        return False
    cmd = getattr(getattr(config, "cmd_opts", None), "cmd", None)
    # cmd is (function, positional, optional) under the CLI; None when invoked
    # through alembic.command.* programmatically (then the target check suffices).
    return cmd is None or getattr(cmd[0], "__name__", "") == "upgrade"


def wants_bootstrap(connection: Connection) -> bool:
    from sqlalchemy import inspect, text

    # Opt-in, set only by scripts/migrate.sh: a bare `alembic upgrade head` against an
    # empty database (wrong DATABASE_URL, a lost volume, a restore into the wrong DB)
    # must keep failing loudly rather than come back as a fresh app stamped at head.
    if os.environ.get("ALEMBIC_BOOTSTRAP_EMPTY") != "1":
        return False
    if not _target_is_head():
        return False
    if connection.dialect.name != "postgresql":
        return False
    if connection.execute(text("SELECT count(*) FROM alembic_version")).scalar():
        return False
    tables = set(inspect(connection).get_table_names(schema="public"))
    return not (tables - {"alembic_version"})


def bootstrap_empty_database(connection: Connection) -> None:
    from sqlalchemy import text

    print("alembic: empty database - creating schema from models (no migration chain)")
    Base.metadata.create_all(connection)
    for name in SEED_FILES:
        path = SEED_DIR / name
        if not path.exists():
            raise RuntimeError(f"seed file missing: {path}")
        connection.exec_driver_sql(path.read_text())
        print(f"alembic: seeded {name}")
    context.get_context().stamp(context.script, "heads")
    print("alembic: stamped head")


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well. By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_schemas=True,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Run migrations with database connection"""
    ensure_version_table(connection)
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        include_schemas=True,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in async mode"""
    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = settings.database_url_sync
    
    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    # Use sync engine for Alembic migrations
    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = settings.database_url_sync
    
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        ensure_version_table(connection)
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_schemas=True,
            include_object=include_object,
        )

        bootstrap = wants_bootstrap(connection)
        with context.begin_transaction():
            if bootstrap:
                bootstrap_empty_database(connection)
            else:
                context.run_migrations()

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()