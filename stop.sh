#!/bin/sh

echo "========================================"
echo "Stopping meimiku services..."
echo "========================================"

podman pod stop meimiku 2>/dev/null || true
podman pod rm meimiku 2>/dev/null || true

echo ""
echo "✓ Pod stopped."
echo ""
echo "To clean database: ./clear.sh"
echo "To restart: ./start.sh"
echo "========================================"
