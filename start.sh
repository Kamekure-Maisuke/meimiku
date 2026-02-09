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

# Wait for SeaweedFS and initialize bucket
echo ""
echo "[4/4] Initializing SeaweedFS bucket..."
echo "Waiting for SeaweedFS to be ready..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:8333 | grep -q "404\|200"; then
    echo "SeaweedFS is ready!"
    break
  fi
  echo "Waiting... ($i/10)"
  sleep 2
done

echo "Creating 'meimiku' bucket..."
curl -X PUT http://localhost:8333/meimiku 2>/dev/null || echo "Bucket may already exist"

echo ""
echo "========================================"
echo "✓ Services are running!"
echo "========================================"
echo "PostgreSQL:  localhost:5432"
echo "PostgREST:   http://localhost:3000"
echo "WebSocket:   ws://localhost:3001"
echo "SeaweedFS:   http://localhost:8333 (S3), http://localhost:8888 (Master)"
echo "App:         Open index.html in browser"
echo ""
echo "To stop: ./stop.sh"
echo "========================================"
