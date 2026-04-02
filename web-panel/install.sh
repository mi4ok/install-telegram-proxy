#!/bin/bash
set -e

PANEL_DIR="$(cd "$(dirname "$0")" && pwd)"
PANEL_PORT="${1:-9090}"
PANEL_USER="${2:-admin}"
PANEL_PASS="${3:-}"

echo "=== Telegram Proxy Panel Installer ==="
echo "Directory: ${PANEL_DIR}"
echo "Port:      ${PANEL_PORT}"
echo "User:      ${PANEL_USER}"
echo "Password:  ${PANEL_PASS:+(set)}"
echo ""

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: run as root (sudo bash $0 $*)"
    exit 1
fi

if [ -z "$PANEL_PASS" ]; then
    echo "Usage: sudo bash $0 PORT USER PASSWORD"
    echo "Example: sudo bash $0 9090 admin MySecretPass"
    exit 1
fi

echo "[1/4] Checking Node.js..."
if ! command -v node > /dev/null 2>&1; then
    echo "  Installing Node.js..."
    if command -v apt-get > /dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
        apt-get install -y -qq nodejs > /dev/null
    elif command -v yum > /dev/null 2>&1; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
        yum install -y -q nodejs > /dev/null
    fi
fi
echo "  Node.js $(node -v) installed"

echo "[2/4] Installing dependencies..."
cd "$PANEL_DIR"
npm install --production --silent 2>/dev/null
echo "  Done"

echo "[3/4] Creating systemd service..."
cat > /etc/systemd/system/telegram-proxy-panel.service <<SERVICE
[Unit]
Description=Telegram Proxy Web Panel
After=network.target nginx.service

[Service]
Type=simple
WorkingDirectory=${PANEL_DIR}
ExecStart=$(which node) ${PANEL_DIR}/server.js
Restart=always
RestartSec=5
Environment=PANEL_PORT=${PANEL_PORT}
Environment=PANEL_USER=${PANEL_USER}
Environment=PANEL_PASS=${PANEL_PASS}

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable telegram-proxy-panel
systemctl restart telegram-proxy-panel

echo ""
echo "[4/4] Opening firewall port..."
if command -v ufw > /dev/null 2>&1; then
    ufw allow "${PANEL_PORT}/tcp" > /dev/null 2>&1 || true
    echo "  ufw: port ${PANEL_PORT} opened"
elif command -v firewall-cmd > /dev/null 2>&1; then
    firewall-cmd --permanent --add-port="${PANEL_PORT}/tcp" > /dev/null 2>&1 || true
    firewall-cmd --reload > /dev/null 2>&1 || true
    echo "  firewalld: port ${PANEL_PORT} opened"
fi

echo ""
echo "====================================="
echo "  Panel is running!"
echo "====================================="
echo ""
echo "  URL:  http://$(hostname -I | awk '{print $1}'):${PANEL_PORT}"
echo "  User: ${PANEL_USER}"
echo ""
echo "  Management:"
echo "    systemctl status telegram-proxy-panel"
echo "    systemctl restart telegram-proxy-panel"
echo "    journalctl -u telegram-proxy-panel -f"
echo ""
echo "  To change password:"
echo "    Edit /etc/systemd/system/telegram-proxy-panel.service"
echo "    systemctl daemon-reload && systemctl restart telegram-proxy-panel"
echo ""
