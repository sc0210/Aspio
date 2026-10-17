#!/usr/bin/env python3
"""
Aspiro FastAPI Backend - Main Application Entry Point

This is the production entry point for the Aspiro personal finance FastAPI backend.
It imports the FastAPI app from the app module and runs it with uvicorn.
"""

import uvicorn
from app.main import app

if __name__ == "__main__":
    """Run the application with uvicorn for production"""
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=True
    )