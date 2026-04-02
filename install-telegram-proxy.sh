#!/bin/bash
set -e

PROXY_PORT_HTTP="${1:-8080}"
PROXY_PORT_HTTPS="${2:-8443}"
SIMPLEONE_URL="${3:-}"
CUSTOM_STAND_NAME="${4:-}"

echo "=== Telegram Bi-directional Proxy Installer ==="
echo "HTTP  port (SimpleOne -> Telegram): ${PROXY_PORT_HTTP}"
echo "HTTPS port (Telegram -> SimpleOne): ${PROXY_PORT_HTTPS}"
echo ""

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: run as root (sudo bash $0 $*)"
    exit 1
fi

echo "[1/7] Installing nginx..."
if command -v apt-get > /dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq nginx openssl > /dev/null
elif command -v yum > /dev/null 2>&1; then
    yum install -y -q nginx openssl > /dev/null
fi
echo "  nginx $(nginx -v 2>&1 | cut -d'/' -f2) installed"

CERT_DIR="/etc/nginx/ssl"
CERT_FILE="${CERT_DIR}/telegram-proxy.pem"
KEY_FILE="${CERT_DIR}/telegram-proxy.key"

echo "[2/7] Setting up SSL certificate..."
mkdir -p "$CERT_DIR"

SERVER_IP=$(hostname -I | awk '{print $1}')

if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    echo "  Certificate already exists, skipping generation"
else
    openssl req -newkey rsa:2048 -sha256 -nodes \
        -keyout "$KEY_FILE" \
        -x509 -days 3650 \
        -out "$CERT_FILE" \
        -subj "/CN=${SERVER_IP}" \
        2>/dev/null
    echo "  Self-signed certificate generated for ${SERVER_IP}"
fi

echo "[3/7] Creating nginx config..."

CONF_FILE="/etc/nginx/sites-available/telegram-proxy.conf"

if [ -n "$SIMPLEONE_URL" ]; then
    if [ -n "$CUSTOM_STAND_NAME" ]; then
        STAND_NAME="$CUSTOM_STAND_NAME"
    else
        STAND_NAME=$(echo "$SIMPLEONE_URL" | sed 's|https\?://||' | cut -d'.' -f1)
    fi
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
# =================================================================
# Server 1: HTTP - for SimpleOne outgoing requests to Telegram API
# SimpleOne -> http://THIS:${PROXY_PORT_HTTP}/bot.../sendMessage -> api.telegram.org
# =================================================================
server {
    listen ${PROXY_PORT_HTTP};
    server_name _;
    resolver 8.8.8.8 ipv6=off;

    set \$telegram_api https://api.telegram.org;

    location / {
        proxy_pass \$telegram_api;
        proxy_set_header Host api.telegram.org;
        proxy_ssl_server_name on;
        proxy_ssl_protocols TLSv1.2 TLSv1.3;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
        proxy_send_timeout 10s;
    }
}

# =================================================================
# Server 2: HTTPS - for Telegram incoming webhooks to SimpleOne
# Telegram -> https://THIS:${PROXY_PORT_HTTPS}/webhook/STAND/... -> SimpleOne
# =================================================================
server {
    listen ${PROXY_PORT_HTTPS} ssl;
    server_name _;

    ssl_certificate ${CERT_FILE};
    ssl_certificate_key ${KEY_FILE};
    ssl_protocols TLSv1.2 TLSv1.3;

${WEBHOOK_STAND_BLOCK}

    # --- WEBHOOK STANDS END ---
}
NGINX_CONF
fi

ln -sf "$CONF_FILE" /etc/nginx/sites-enabled/

echo "[4/7] Testing config..."
nginx -t

echo "[5/7] Restarting nginx..."
systemctl restart nginx
systemctl enable nginx 2>/dev/null

echo "[6/7] Opening ports..."
for PORT in "$PROXY_PORT_HTTP" "$PROXY_PORT_HTTPS"; do
    if command -v ufw > /dev/null 2>&1; then
        ufw allow "${PORT}/tcp" > /dev/null 2>&1 || true
        echo "  ufw: port ${PORT} opened"
    elif command -v firewall-cmd > /dev/null 2>&1; then
        firewall-cmd --permanent --add-port="${PORT}/tcp" > /dev/null 2>&1 || true
        echo "  firewalld: port ${PORT} opened"
    fi
done
if command -v firewall-cmd > /dev/null 2>&1; then
    firewall-cmd --reload > /dev/null 2>&1 || true
fi

echo "[7/7] Done!"
echo ""
echo "====================================="
echo "  OUTGOING: SimpleOne -> Telegram"
echo "  (HTTP, port ${PROXY_PORT_HTTP})"
echo "====================================="
echo ""
echo "Test:"
echo "  curl -s http://${SERVER_IP}:${PROXY_PORT_HTTP}/botTOKEN/getMe"
echo ""
echo "SimpleOne system properties:"
echo "  itsm.telegram_bot.url = http://${SERVER_IP}:${PROXY_PORT_HTTP}"
echo "  vcsm.telegram_bot.url = http://${SERVER_IP}:${PROXY_PORT_HTTP}"
echo ""

if [ -n "$SIMPLEONE_URL" ]; then
    echo "====================================="
    echo "  INCOMING: Telegram -> SimpleOne"
    echo "  (HTTPS, port ${PROXY_PORT_HTTPS})"
    echo "====================================="
    echo ""
    echo "SimpleOne system properties:"
    echo "  itsm.telegram_bot.webhook_url = https://${SERVER_IP}:${PROXY_PORT_HTTPS}/webhook/${STAND_NAME}"
    echo "  vcsm.telegram_bot.webhook_url = https://${SERVER_IP}:${PROXY_PORT_HTTPS}/webhook/${STAND_NAME}"
    echo ""
    echo "====================================="
    echo "  REGISTER WEBHOOK (once per bot)"
    echo "====================================="
    echo ""
    echo "  curl -F \"url=https://${SERVER_IP}:${PROXY_PORT_HTTPS}/webhook/${STAND_NAME}/v1/api/SLUG/MODULE/VERSION/ACTION\" \\"
    echo "       -F \"certificate=@${CERT_FILE}\" \\"
    echo "       https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook"
    echo ""
fi

echo "====================================="
echo "  SSL CERTIFICATE"
echo "====================================="
echo ""
echo "  ${CERT_FILE}"
echo ""
echo "====================================="
echo "  ADD MORE STANDS"
echo "====================================="
echo ""
echo "Re-run with a different SimpleOne URL:"
echo "  sudo bash $0 ${PROXY_PORT_HTTP} ${PROXY_PORT_HTTPS} https://OTHER.simpleone.ru"
echo ""
echo "For non-standard domains, specify stand name as 4th argument:"
echo "  sudo bash $0 ${PROXY_PORT_HTTP} ${PROXY_PORT_HTTPS} https://support.itglobal.com itglobal"
echo ""
echo "Config: ${CONF_FILE}"
echo ""
