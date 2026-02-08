#!/bin/sh
set -e

echo "========================================"
echo "Starting meimiku services..."
echo "========================================"

# Build chat-server
echo ""
echo "[1/3] Building chat-server image..."
cd chat-server
podman build -t localhost/chat-server:latest .
cd ..

# Stop and remove existing pod (ignore errors)
echo ""
echo "[2/3] Stopping existing pod..."
podman pod stop meimiku 2>/dev/null || true
podman pod rm meimiku 2>/dev/null || true

# Start pod with path replacement
echo ""
echo "[3/3] Starting pod..."
sed "s|__PWD__|$(pwd)|g" podman.yaml | podman play kube -

echo ""
echo "========================================"
echo "✓ Services are running!"
echo "========================================"
echo "PostgreSQL:  localhost:5432"
echo "PostgREST:   http://localhost:3000"
echo "WebSocket:   ws://localhost:3001"
echo "App:         Open index.html in browser"
echo ""
echo "To stop: ./stop.sh"
echo "========================================"
