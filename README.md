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
| ITPod | `https://my.itpod.com` | `itpod` | `/webhook/itpod/` |

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
| 3-й | — | URL стенда SimpleOne (любой домен, например `https://crm.company.org`) |
| 4-й | — | Уникальное имя стенда для маршрутизации webhook'ов. Если не указано, берётся из домена: `home.simpleone.ru` -> `home`. **Указывайте явно**, если первая часть домена не уникальна или неинформативна |

Домен стенда может быть **любым** — `simpleone.ru`, `itglobal.com`, `company.org` и т.д.
Скрипт не привязан к конкретным доменам. Примеры:

```bash
# Стандартный домен — имя берётся автоматически
sudo bash install-telegram-proxy.sh 8080 8443 https://home.simpleone.ru
# -> stand name: home, location: /webhook/home/

# Кастомный домен — нужно указать имя
sudo bash install-telegram-proxy.sh 8080 8443 https://support.itglobal.com itglobal
# -> stand name: itglobal, location: /webhook/itglobal/

# Полностью произвольный домен
sudo bash install-telegram-proxy.sh 8080 8443 https://crm.company.org company-crm
# -> stand name: company-crm, location: /webhook/company-crm/
```

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

Ответ: `{"ok":true,"result":true,"description":"Webhook was set"}`

**Стандартные webhook URL по типу бота:**

В SimpleOne два приложения с Telegram-ботами — ITSM и VCSM. У каждого свой slug и endpoint path:

| Приложение | APP_SLUG | MODULE_PATH | VERSION_PATH | ACTION_PATH |
|------------|----------|-------------|--------------|-------------|
| ITSM | `itsm_itsm` | `telegram_bot` | `v1` | `endpoint` |
| VCSM | `vcsm_vcsm` | `vcsm_telegram_bot` | `v1` | `vcsm_endpoint` |

Полные webhook URL для регистрации:

```bash
# ITSM бот (for_client)
curl -F "url=https://PROXY_IP:8443/webhook/STAND_NAME/v1/api/itsm_itsm/telegram_bot/v1/endpoint" \
     -F "certificate=@/etc/nginx/ssl/telegram-proxy.pem" \
     https://api.telegram.org/botITSM_BOT_TOKEN/setWebhook

# VCSM бот (vcsm_for_client)
curl -F "url=https://PROXY_IP:8443/webhook/STAND_NAME/v1/api/vcsm_vcsm/vcsm_telegram_bot/v1/vcsm_endpoint" \
     -F "certificate=@/etc/nginx/ssl/telegram-proxy.pem" \
     https://api.telegram.org/botVCSM_BOT_TOKEN/setWebhook
```

**Несколько ботов на одном стенде:**

У каждого бота свой токен и может быть свой endpoint (`ACTION_PATH`).
Nginx location при этом один — `/webhook/STAND_NAME/`.
Регистрировать webhook нужно **для каждого бота отдельно**.

На стенде может быть до 4 ботов: ITSM for_client, ITSM router, VCSM for_client, VCSM router.
Каждому нужна отдельная регистрация с тем же сертификатом.

**Если endpoint на стенде отличается от стандартного** (например `compliance` вместо `endpoint`),
используйте значение из виджета Telegram Connection или из таблицы `sys_api_action`.

**Как узнать webhook URL для каждого бота:**

Webhook URL состоит из: `https://PROXY_IP:8443/webhook/STAND_NAME/v1/api/APP_SLUG/MODULE_PATH/VERSION_PATH/ACTION_PATH`

| Часть | Откуда | ITSM | VCSM |
|-------|--------|------|------|
| `STAND_NAME` | Имя стенда (4-й аргумент скрипта) | `home` | `home` |
| `APP_SLUG` | `sys_application.slug` | `itsm_itsm` | `vcsm_vcsm` |
| `MODULE_PATH` | `sys_api_module.path` | `telegram_bot` | `vcsm_telegram_bot` |
| `VERSION_PATH` | `sys_api_version.path` | `v1` | `v1` |
| `ACTION_PATH` | `sys_api_action.path` | `endpoint` | `vcsm_endpoint` |

Эти значения видны в виджете **Telegram Connection** при подключении бота — каждый бот привязан к своему endpoint.

**Важно:** после каждого переподключения бота через виджет SimpleOne нужно перерегистрировать webhook с сертификатом с сервера proxy (виджет вызывает `setWebhook` без `.pem`, и Telegram сбрасывает `has_custom_certificate`).

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
| `[TgBot]` | ITSM Script Include `TgBot` | URL исходящего запроса, HTTP статус, тело ответа |
| `[TgWebhook]` | ITSM API Action (webhook handler) | Входящий webhook, авторизация, шаг обработки, ошибки |
| `[VCSMTgBot]` | VCSM Script Include `TgBot` | URL исходящего запроса, HTTP статус, тело ответа |
| `[VCSMWebhook]` | VCSM API Action (webhook handler) | Входящий webhook, авторизация, шаг обработки, ошибки |
| `[TgProxy]` | Виджет Telegram Connection | Проверка статуса подключения, регистрация webhook |

## Изменённые файлы

| Файл | Что изменено |
|------|-------------|
| `scripts/install-telegram-proxy.sh` | Скрипт установки proxy |
| `scripts/README.md` | Документация |
| `itsm/entities/sys_widget/162616365310663943/server.js` | Поддержка `webhook_url` property, логирование |
| `vcsm/entities/sys_widget/175190002100310856/server.js` | Поддержка `webhook_url` property, логирование |
| `itsm/entities/sys_script_include/162877053817906313.js` | Логирование исходящих запросов (ITSM TgBot) |
| `vcsm/entities/sys_script_include/175163088001746509.js` | Логирование исходящих запросов (VCSM TgBot) |
| `itsm/entities/sys_api_action/162695541316594595.js` | try/catch, логирование входящих webhook'ов (ITSM) |
| `vcsm/entities/sys_api_action/175163124000545788.js` | try/catch, логирование входящих webhook'ов (VCSM) |

## Добавить новый стенд

Пример: добавить стенд `https://crm.newclient.ru` с именем `newclient`.

1. **На сервере proxy** — добавить стенд в nginx:
```bash
sudo bash install-telegram-proxy.sh 8080 8443 https://crm.newclient.ru newclient
```

2. **На стенде** — задеплоить изменённые файлы виджетов (ITSM/VCSM) если ещё не задеплоены

3. **На стенде** — создать 4 system property:

| Property | Значение |
|----------|---------|
| `itsm.telegram_bot.url` | `http://PROXY_IP:8080` |
| `vcsm.telegram_bot.url` | `http://PROXY_IP:8080` |
| `itsm.telegram_bot.webhook_url` | `https://PROXY_IP:8443/webhook/newclient` |
| `vcsm.telegram_bot.webhook_url` | `https://PROXY_IP:8443/webhook/newclient` |

4. **С сервера proxy** — зарегистрировать webhook с сертификатом для каждого бота:
```bash
curl -F "url=https://PROXY_IP:8443/webhook/newclient/v1/api/APP_SLUG/MODULE/VERSION/ACTION" \
     -F "certificate=@/etc/nginx/ssl/telegram-proxy.pem" \
     https://api.telegram.org/botBOT_TOKEN/setWebhook
```

5. **На стенде** — подключить бота через виджет Telegram Connection

## Веб-панель управления

Опциональный веб-интерфейс для управления proxy — просмотр стендов, регистрация webhook'ов, логи nginx.

### Установка

На сервере proxy:

```bash
cd install-telegram-proxy/scripts/web-panel
sudo bash install.sh 9090 admin MyPassword123
```

Аргументы:

| Аргумент | По умолчанию | Описание |
|----------|-------------|----------|
| 1-й | `9090` | Порт веб-панели |
| 2-й | `admin` | Имя пользователя для HTTP-авторизации |
| 3-й | — | Пароль (обязательный) |

Скрипт установит Node.js (если нет), поставит зависимости, откроет порт в firewall и создаст systemd-сервис.

### Доступ

```
http://PROXY_IP:9090
```

Не забудьте открыть порт: `ufw allow 9090/tcp`

### Функции

- **Stands** — список стендов из nginx-конфига, добавление/удаление
- **Bot Manager** — getMe, getWebhookInfo, setWebhook (с сертификатом), deleteWebhook
- **Logs** — просмотр access/error логов nginx с фильтрацией и авто-обновлением

### Управление сервисом

```bash
systemctl status telegram-proxy-panel
systemctl restart telegram-proxy-panel
journalctl -u telegram-proxy-panel -f
```