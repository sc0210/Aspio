#!/bin/bash
# scripts/start-local.sh - Quick start Aspiro (localhost only, no ngrok)
# Usage: ./scripts/start-local.sh

set -e
cd "$(dirname "$0")/.."

echo "Starting Aspiro (localhost)..."

docker compose up -d

echo ""
echo "Aspiro is running!"
echo ""
echo "Access:"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:8000"
echo "   API Docs: http://localhost:8000/docs"
echo "   pgAdmin:  http://localhost:5050"
echo ""
echo "Note: Your database is persistent and will be preserved when stopping"
echo ""
echo "To stop: docker compose down (keeps data)"
echo "To stop and remove data: docker compose down -v (deletes database!)"
