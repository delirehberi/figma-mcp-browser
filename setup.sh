#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "===================================================="
echo "  Figma MCP Bridge - 1-Click Automated Setup (macOS/Linux)"
echo "===================================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not found in PATH!"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

if [ ! -d "$DIR/server/node_modules" ]; then
    echo "[*] Installing server dependencies..."
    (cd "$DIR/server" && npm install --no-audit --no-fund)
fi

echo "[*] Configuring AI agent harnesses..."
node "$DIR/scripts/setup-harness.js"

echo ""
echo "===================================================="
echo "  Setup Complete!"
echo "===================================================="
echo "1. Open Google Chrome and go to: chrome://extensions"
echo "2. Enable 'Developer mode' (top right toggle)"
echo "3. Click 'Load unpacked' and select this folder:"
echo "   $DIR"
echo "4. Restart Claude Desktop / Cursor / Antigravity"
echo "===================================================="
