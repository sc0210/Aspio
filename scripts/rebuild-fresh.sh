#!/bin/bash

# Rebuild Fresh Script
# Use this to ensure you get the latest code without any caching

echo "🧹 Cleaning up old containers and caches..."

# Stop all containers
docker compose down

# Remove the frontend container and image to force complete rebuild
docker compose rm -f frontend
docker rmi aspiro-frontend 2>/dev/null || true

# Optional: Clean Next.js cache inside the container
# This removes the .next directory which contains cached builds
echo "🔨 Building frontend with fresh cache..."
docker compose build --no-cache frontend

# Start all services
echo "🚀 Starting services..."
docker compose up -d

# Show running containers
echo "✅ Services running:"
docker compose ps

echo ""
echo "Frontend: http://localhost:3000"
echo "Backend: http://localhost:8000"
echo ""
echo "💡 Tip: Do a hard refresh in browser (Cmd+Shift+R) to clear browser cache"
