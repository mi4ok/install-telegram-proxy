#!/bin/bash
set -e

PROXY_PORT="${1:-8443}"
SIMPLEONE_URL="${2:-}"

echo "=== Telegram Bi-directional Proxy Installer ==="
echo "Port: ${PROXY_PORT}"
echo ""

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: run as root (sudo bash $0 $*)"
    exit 1
fi

echo "[1/6] Installing nginx..."
if command -v apt-get > /dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq nginx > /dev/null
elif command -v yum > /dev/null 2>&1; then
    yum install -y -q nginx > /dev/null
fi
echo "  nginx $(nginx -v 2>&1 | cut -d'/' -f2) installed"

echo "[2/6] Creating config..."

CONF_FILE="/etc/nginx/sites-available/telegram-proxy.conf"

if [ -n "$SIMPLEONE_URL" ]; then
    STAND_NAME=$(echo "$SIMPLEONE_URL" | sed 's|https\?://||' | cut -d'.' -f1)
    STAND_HOST=$(echo "$SIMPLEONE_URL" | sed 's|https\?://||' | cut -d'/' -f1)
    echo "  Adding webhook proxy for stand: ${STAND_NAME} -> ${SIMPLEONE_URL}"
fi

if [ -f "$CONF_FILE" ] && [ -n "$SIMPLEONE_URL" ]; then
    if grep -q "location /webhook/${STAND_NAME}/" "$CONF_FILE"; then
        echo "  Stand '${STAND_NAME}' already configured, skipping"
    else
        TEMP_FILE=$(mktemp)
        while IFS= read -r line; do
            if echo "$line" | grep -q "# --- WEBHOOK STANDS END ---"; then
                cat >> "$TEMP_FILE" <<WEBHOOK_BLOCK
    # --- Stand: ${STAND_NAME} ---
    location /webhook/${STAND_NAME}/ {
        proxy_pass ${SIMPLEONE_URL}/;
        proxy_set_header Host ${STAND_HOST};
        proxy_ssl_server_name on;
        proxy_ssl_protocols TLSv1.2 TLSv1.3;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
        proxy_send_timeout 10s;
    }

WEBHOOK_BLOCK
            fi
            echo "$line" >> "$TEMP_FILE"
        done < "$CONF_FILE"
        mv "$TEMP_FILE" "$CONF_FILE"
    fi
else
    WEBHOOK_STAND_BLOCK=""
    if [ -n "$SIMPLEONE_URL" ]; then
        read -r -d '' WEBHOOK_STAND_BLOCK <<WEBHOOK_BLOCK || true
    # --- Stand: ${STAND_NAME} ---
    location /webhook/${STAND_NAME}/ {
        proxy_pass ${SIMPLEONE_URL}/;
        proxy_set_header Host ${STAND_HOST};
        proxy_ssl_server_name on;
        proxy_ssl_protocols TLSv1.2 TLSv1.3;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
        proxy_send_timeout 10s;
    }
WEBHOOK_BLOCK
    fi

    cat > "$CONF_FILE" <<NGINX_CONF
server {
    listen ${PROXY_PORT};
    server_name _;

    # ============================================================
    # Direction 1: SimpleOne -> Telegram API (outgoing)
    # ============================================================
    location / {
        proxy_pass https://api.telegram.org;
        proxy_set_header Host api.telegram.org;
        proxy_ssl_server_name on;
        proxy_ssl_protocols TLSv1.2 TLSv1.3;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
        proxy_send_timeout 10s;
    }

    # ============================================================
    # Direction 2: Telegram -> SimpleOne (incoming webhooks)
    # ============================================================

${WEBHOOK_STAND_BLOCK}

    # --- WEBHOOK STANDS END ---
}
NGINX_CONF
fi

ln -sf "$CONF_FILE" /etc/nginx/sites-enabled/

echo "[3/6] Testing config..."
nginx -t

echo "[4/6] Restarting nginx..."
systemctl restart nginx
systemctl enable nginx 2>/dev/null

echo "[5/6] Opening port ${PROXY_PORT}..."
if command -v ufw > /dev/null 2>&1; then
    ufw allow "${PROXY_PORT}/tcp" > /dev/null 2>&1 || true
    echo "  ufw: port ${PROXY_PORT} opened"
elif command -v firewall-cmd > /dev/null 2>&1; then
    firewall-cmd --permanent --add-port="${PROXY_PORT}/tcp" > /dev/null 2>&1 || true
    firewall-cmd --reload > /dev/null 2>&1 || true
    echo "  firewalld: port ${PROXY_PORT} opened"
else
    echo "  No firewall manager found, skipping"
fi

SERVER_IP=$(hostname -I | awk '{print $1}')

echo "[6/6] Done!"
echo ""
echo "====================================="
echo "  OUTGOING (SimpleOne -> Telegram)"
echo "====================================="
echo ""
echo "Test:"
echo "  curl -s http://${SERVER_IP}:${PROXY_PORT}/botTOKEN/getMe"
echo ""
echo "SimpleOne system properties:"
echo "  itsm.telegram_bot.url = http://${SERVER_IP}:${PROXY_PORT}"
echo "  vcsm.telegram_bot.url = http://${SERVER_IP}:${PROXY_PORT}"
echo ""

if [ -n "$SIMPLEONE_URL" ]; then
    echo "====================================="
    echo "  INCOMING (Telegram -> SimpleOne)"
    echo "====================================="
    echo ""
    echo "Webhook URL prefix for stand '${STAND_NAME}':"
    echo "  http://${SERVER_IP}:${PROXY_PORT}/webhook/${STAND_NAME}"
    echo ""
    echo "SimpleOne system properties:"
    echo "  itsm.telegram_bot.webhook_url = http://${SERVER_IP}:${PROXY_PORT}/webhook/${STAND_NAME}"
    echo "  vcsm.telegram_bot.webhook_url = http://${SERVER_IP}:${PROXY_PORT}/webhook/${STAND_NAME}"
    echo ""
fi

echo "====================================="
echo "  ADD MORE STANDS"
echo "====================================="
echo ""
echo "Re-run with a different SimpleOne URL:"
echo "  sudo bash $0 ${PROXY_PORT} https://OTHER_STAND.simpleone.ru"
echo ""
echo "Config file:"
echo "  ${CONF_FILE}"
echo ""
