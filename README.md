# Telegram Proxy для SimpleOne

Двунаправленный nginx reverse proxy для работы Telegram-ботов SimpleOne из России.

## Зачем

В России заблокирован трафик от/к Telegram. Без proxy:
- SimpleOne не может отправить сообщение через Telegram Bot API (`api.telegram.org` недоступен)
- Telegram не может доставить webhook (нажатие кнопки, сообщение от пользователя) на стенд SimpleOne

Proxy решает обе проблемы, проксируя трафик через сервер за пределами РФ.

## Архитектура

```
ИСХОДЯЩИЕ (SimpleOne -> Telegram):
  SimpleOne --HTTP--> nginx:8080 --HTTPS--> api.telegram.org

ВХОДЯЩИЕ (Telegram -> SimpleOne):
  Telegram --HTTPS--> nginx:8443 --HTTPS--> stand.simpleone.ru
```

Два порта:
- **8080** (HTTP) — для исходящих запросов от SimpleOne к Telegram API
- **8443** (HTTPS, self-signed cert) — для входящих webhook'ов от Telegram к SimpleOne

## Требования

- Сервер (VPS) за пределами РФ с доступом к `api.telegram.org` и к стендам SimpleOne
- Ubuntu/Debian или CentOS
- Root-доступ

## Текущие стенды

| Стенд | URL | Stand name | Webhook prefix |
|-------|-----|------------|----------------|
| Home | `https://home.simpleone.ru` | `home` | `/webhook/home/` |
| ITGlobal | `https://support.itglobal.com` | `itglobal` | `/webhook/itglobal/` |
| VStack | `https://support.vstack.com` | `vstack` | `/webhook/vstack/` |

## Установка

### Шаг 1. Установить proxy и добавить стенды

На сервере за пределами РФ:

```bash
git clone https://github.com/mi4ok/install-telegram-proxy.git
cd install-telegram-proxy
```

**Первый запуск** — создаёт конфиг и добавляет первый стенд:

```bash
sudo bash install-telegram-proxy.sh 8080 8443 https://home.simpleone.ru
```

**Добавить остальные стенды** — запустить скрипт повторно.
Для доменов где первая часть совпадает (например `support.itglobal.com` и `support.vstack.com`),
нужно указать уникальное имя стенда 4-м аргументом:

```bash
sudo bash install-telegram-proxy.sh 8080 8443 https://support.itglobal.com itglobal
sudo bash install-telegram-proxy.sh 8080 8443 https://support.vstack.com vstack
```

Параметры скрипта:

| Аргумент | По умолчанию | Описание |
|----------|-------------|----------|
| 1-й | `8080` | HTTP порт для исходящих (SimpleOne -> Telegram) |
| 2-й | `8443` | HTTPS порт для входящих webhook'ов. Telegram принимает только 443, 80, 88, 8443 |
| 3-й | — | URL стенда SimpleOne |
| 4-й | — | Уникальное имя стенда (если не указано, берётся из домена: `home.simpleone.ru` -> `home`) |

Скрипт автоматически:
- Установит nginx и openssl
- Сгенерирует self-signed SSL-сертификат (только при первом запуске)
- Создаст конфигурацию с двумя server-блоками (HTTP + HTTPS)
- Добавит `location` для webhook'ов указанного стенда
- Откроет порты в firewall
- Перезапустит nginx

### Шаг 2. Проверить proxy

С сервера proxy:
```bash
# Исходящие
curl -s http://PROXY_IP:8080/botTOKEN/getMe

# SSL
curl -vk https://PROXY_IP:8443/ 2>&1 | grep "SSL connection"
```

С сервера SimpleOne:
```bash
curl -s http://PROXY_IP:8080/botTOKEN/getMe
```

### Шаг 3. Изменения в коде SimpleOne (один раз)

В репозитории уже внесены изменения в следующие файлы. Их нужно задеплоить на каждый стенд.

**ITSM виджет** `itsm/entities/sys_widget/162616365310663943/server.js`:
- При `INIT` читает property `itsm.telegram_bot.webhook_url` — если задано, использует его как базовый URL при регистрации webhook вместо прямого адреса стенда
- `connected()` — регистрирует webhook через proxy URL
- `check()` — проверяет статус подключения, принимая оба варианта URL (proxy и прямой)

**VCSM виджет** `vcsm/entities/sys_widget/175190002100310856/server.js`:
- Аналогичные изменения для VCSM, property `vcsm.telegram_bot.webhook_url`

**TgBot Script Include** `itsm/entities/sys_script_include/162877053817906313.js`:
- `__setDefaultPOSTRequest()` — добавлено логирование исходящих запросов (URL, статус, ответ)
- `__getApiUrl()` — добавлено логирование формируемого URL

**API Action (webhook handler)** `itsm/entities/sys_api_action/162695541316594595.js`:
- Добавлен `try/catch` для отлова ошибок
- Добавлено логирование входящих webhook'ов, авторизации, шагов обработки

### Шаг 4. Настроить system properties на каждом стенде

На каждом стенде создайте записи в таблице `sys_property`:

**Для стенда `home.simpleone.ru`:**

| Property | Значение |
|----------|---------|
| `itsm.telegram_bot.url` | `http://PROXY_IP:8080` |
| `vcsm.telegram_bot.url` | `http://PROXY_IP:8080` |
| `itsm.telegram_bot.webhook_url` | `https://PROXY_IP:8443/webhook/home` |
| `vcsm.telegram_bot.webhook_url` | `https://PROXY_IP:8443/webhook/home` |

**Для стенда `support.itglobal.com`:**

| Property | Значение |
|----------|---------|
| `itsm.telegram_bot.url` | `http://PROXY_IP:8080` |
| `vcsm.telegram_bot.url` | `http://PROXY_IP:8080` |
| `itsm.telegram_bot.webhook_url` | `https://PROXY_IP:8443/webhook/itglobal` |
| `vcsm.telegram_bot.webhook_url` | `https://PROXY_IP:8443/webhook/itglobal` |

**Для стенда `support.vstack.com`:**

| Property | Значение |
|----------|---------|
| `itsm.telegram_bot.url` | `http://PROXY_IP:8080` |
| `vcsm.telegram_bot.url` | `http://PROXY_IP:8080` |
| `itsm.telegram_bot.webhook_url` | `https://PROXY_IP:8443/webhook/vstack` |
| `vcsm.telegram_bot.webhook_url` | `https://PROXY_IP:8443/webhook/vstack` |

**Важно:**
- `*.telegram_bot.url` — **HTTP** (порт 8080), без SSL. Используется для исходящих запросов (`sendMessage`, `getWebhookInfo` и т.д.)
- `*.telegram_bot.webhook_url` — **HTTPS** (порт 8443), с SSL. Используется только при регистрации webhook в Telegram

### Шаг 5. Зарегистрировать webhook (один раз для каждого бота)

Telegram требует передать self-signed сертификат при первой регистрации webhook.
Выполните **с сервера proxy** (где лежит `.pem` файл):

```bash
curl -F "url=https://PROXY_IP:8443/webhook/STAND_NAME/v1/api/APP_SLUG/MODULE_PATH/VERSION_PATH/ACTION_PATH" \
     -F "certificate=@/etc/nginx/ssl/telegram-proxy.pem" \
     https://api.telegram.org/botBOT_TOKEN/setWebhook
```

**Примеры:**

Стенд `home`, ITSM-бот:
```bash
curl -F "url=https://185.209.49.26:8443/webhook/home/v1/api/itsm_itsm/telegram_bot/v1/endpoint" \
     -F "certificate=@/etc/nginx/ssl/telegram-proxy.pem" \
     https://api.telegram.org/botBOT_TOKEN/setWebhook
```

Стенд `itglobal`, ITSM-бот:
```bash
curl -F "url=https://185.209.49.26:8443/webhook/itglobal/v1/api/itsm_itsm/telegram_bot/v1/endpoint" \
     -F "certificate=@/etc/nginx/ssl/telegram-proxy.pem" \
     https://api.telegram.org/botBOT_TOKEN/setWebhook
```

Ответ: `{"ok":true,"result":true,"description":"Webhook was set"}`

**Как узнать webhook URL:**
- `APP_SLUG` — поле `slug` из `sys_application` (для ITSM: `itsm_itsm`, для VCSM: смотреть в таблице)
- `MODULE_PATH` — поле `path` из `sys_api_module` (например: `telegram_bot`)
- `VERSION_PATH` — поле `path` из `sys_api_version` (например: `v1`)
- `ACTION_PATH` — поле `path` из `sys_api_action` (например: `endpoint`)

Эти значения видны в виджете Telegram Connection при подключении бота.

### Шаг 6. Проверить

```bash
curl -s http://PROXY_IP:8080/botBOT_TOKEN/getWebhookInfo | python3 -m json.tool
```

Успешный результат:
- `url` — содержит `https://PROXY_IP:8443/webhook/STAND_NAME/...`
- `has_custom_certificate` — `true`
- `last_error_message` — пустой
- `pending_update_count` — `0`

### Шаг 7. Подключить бота в SimpleOne

Зайдите в admin-панель SimpleOne -> виджет **Telegram Connection**. Введите токен бота и endpoint, нажмите **Connect**.

После первичной регистрации webhook с сертификатом (шаг 5), виджет может переподключать ботов самостоятельно.

## Конфигурация nginx

Конфиг: `/etc/nginx/sites-available/telegram-proxy.conf`

```nginx
# HTTP (порт 8080) — исходящие запросы от SimpleOne к Telegram API
server {
    listen 8080;
    resolver 8.8.8.8 ipv6=off;
    set $telegram_api https://api.telegram.org;
    location / {
        proxy_pass $telegram_api;
        proxy_set_header Host api.telegram.org;
        proxy_ssl_server_name on;
        ...
    }
}

# HTTPS (порт 8443) — входящие webhook'и от Telegram
server {
    listen 8443 ssl;
    ssl_certificate /etc/nginx/ssl/telegram-proxy.pem;
    ssl_certificate_key /etc/nginx/ssl/telegram-proxy.key;

    location /webhook/home/ {
        proxy_pass https://home.simpleone.ru/;
        proxy_set_header Host home.simpleone.ru;
        ...
    }
    location /webhook/itglobal/ {
        proxy_pass https://support.itglobal.com/;
        proxy_set_header Host support.itglobal.com;
        ...
    }
    location /webhook/vstack/ {
        proxy_pass https://support.vstack.com/;
        proxy_set_header Host support.vstack.com;
        ...
    }
}
```

Особенности:
- `resolver 8.8.8.8 ipv6=off` — принудительно использует IPv4 (на некоторых VPS IPv6 недоступен, nginx по умолчанию пытается использовать его)
- `set $telegram_api` + `proxy_pass $telegram_api` — через переменную nginx резолвит DNS при каждом запросе (не кэширует IPv6 адрес при старте)

## Диагностика

### Исходящие не работают (SimpleOne -> Telegram)

```bash
# Проверить что nginx слушает оба порта
ss -tlnp | grep nginx

# Проверить подключение от SimpleOne
curl -s http://PROXY_IP:8080/botTOKEN/getMe

# Проверить error log (IPv6 ошибки = нужен resolver ipv6=off)
tail -20 /var/log/nginx/error.log
```

### Входящие не работают (кнопки в Telegram)

```bash
# Проверить webhook status
curl -s http://PROXY_IP:8080/botTOKEN/getWebhookInfo | python3 -m json.tool

# Проверить access log — есть ли запросы на /webhook/
tail -20 /var/log/nginx/access.log | grep webhook

# Проверить SSL
openssl s_client -connect PROXY_IP:8443 </dev/null 2>&1 | head -10

# Если "SSL error: packet length too long" — перерегистрировать webhook с сертификатом
```

### Логирование в SimpleOne

В коде добавлено логирование с тегами (System Logs / `sys_log`):

| Тег | Где | Что показывает |
|-----|-----|----------------|
| `[TgBot]` | Script Include `TgBot` | URL исходящего запроса, HTTP статус, тело ответа |
| `[TgWebhook]` | API Action (webhook handler) | Входящий webhook, авторизация, шаг обработки, ошибки |
| `[TgProxy]` | Виджет Telegram Connection | Проверка статуса подключения, регистрация webhook |

## Изменённые файлы

| Файл | Что изменено |
|------|-------------|
| `scripts/install-telegram-proxy.sh` | Скрипт установки proxy |
| `scripts/README.md` | Документация |
| `itsm/entities/sys_widget/162616365310663943/server.js` | Поддержка `webhook_url` property, логирование |
| `vcsm/entities/sys_widget/175190002100310856/server.js` | Поддержка `webhook_url` property, логирование |
| `itsm/entities/sys_script_include/162877053817906313.js` | Логирование исходящих запросов |
| `itsm/entities/sys_api_action/162695541316594595.js` | try/catch, логирование входящих webhook'ов |

## Добавить новый стенд

1. На сервере proxy:
```bash
sudo bash install-telegram-proxy.sh 8080 8443 https://NEW_STAND_URL STAND_NAME
```

2. На стенде: задеплоить изменённые файлы виджетов (ITSM/VCSM)

3. На стенде: создать 4 system property (шаг 4)

4. С сервера proxy: зарегистрировать webhook с сертификатом (шаг 5)

5. На стенде: подключить бота через виджет Telegram Connection (шаг 7)
