#!/bin/sh

echo "========================================"
echo "Cleaning meimiku resources..."
echo "========================================"
echo ""
echo "WARNING: This will delete:"
echo "  - All database data (volumes)"
echo "  - Unused images"
echo "  - Unused containers"
echo "  - Build cache"
echo ""
echo -n "Are you sure? (y/N): "
read -r answer

case "$answer" in
    [Yy]*)
        ./stop.sh
        echo ""
        echo "Removing volumes..."
        podman volume prune -f
        echo ""
        echo "Cleaning up system (images, containers, cache)..."
        podman system prune -af
        echo ""
        echo "✓ All resources cleaned."
        echo ""
        echo "To start fresh: ./start.sh"
        ;;
    *)
        echo "Cancelled."
        ;;
esac

echo "========================================"
