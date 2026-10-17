#!/usr/bin/env python3
"""
Add performance optimization indexes for dashboard queries.
Run this script to add the new indexes to your database.
"""

import asyncio
import asyncpg
import os
from app.core.config import settings

# SQL statements to add new indexes
INDEX_STATEMENTS = [
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_user_status_deleted
    ON transactions (user_id, status, is_deleted);
    """,
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_user_date_type_status
    ON transactions (user_id, transaction_date, type, status, is_deleted);
    """,
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_category_date
    ON transactions (category_id, transaction_date);
    """,
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_breakdown
    ON transactions (user_id, category_id, type, status, is_deleted, transaction_date);
    """,
]

async def add_indexes():
    """Add performance indexes to the database"""
    database_url = settings.database_url

    # Parse database URL
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "")
    elif database_url.startswith("postgresql+asyncpg://"):
        database_url = database_url.replace("postgresql+asyncpg://", "")

    # Extract connection parameters
    parts = database_url.split("@")
    if len(parts) != 2:
        print("Error: Invalid database URL format")
        return

    auth_part, host_part = parts
    username, password = auth_part.split(":")
    host_db = host_part.split("/")
    host = host_db[0]
    database = host_db[1] if len(host_db) > 1 else "aspiro"

    # Handle port
    if ":" in host:
        host, port = host.split(":")
        port = int(port)
    else:
        port = 5432

    try:
        # Connect to database
        print(f"Connecting to database: {host}:{port}/{database}")
        conn = await asyncpg.connect(
            host=host,
            port=port,
            user=username,
            password=password,
            database=database
        )

        print("Connected successfully!")

        # Add each index
        for i, statement in enumerate(INDEX_STATEMENTS, 1):
            try:
                print(f"Adding index {i}/{len(INDEX_STATEMENTS)}...")
                await conn.execute(statement)
                print(f"✅ Index {i} added successfully")
            except Exception as e:
                print(f"❌ Error adding index {i}: {e}")
                continue

        await conn.close()
        print("🎉 Database optimization complete!")

    except Exception as e:
        print(f"❌ Database connection error: {e}")
        print("\nTroubleshooting:")
        print("1. Make sure your database is running")
        print("2. Check your DATABASE_URL environment variable")
        print("3. Verify your database credentials")

if __name__ == "__main__":
    print("🚀 Adding performance indexes to Aspiro database...")
    asyncio.run(add_indexes())