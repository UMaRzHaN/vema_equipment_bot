# Equipment Bot

Telegram-бот для учёта оборудования на базе Node.js, PostgreSQL и Redis.

## Возможности

- Учёт оборудования по категориям: выдача, возврат, ремонт, списание
- Пагинация списков, подсказки при добавлении (фильтруются по категории)
- Отчёты: сводка по статусам, экспорт категории в Excel, изображение-карточка
- История каждой единицы оборудования
- Ролевая система: `user` / `manager` / `admin` (назначается через бота)
- Управление пользователями с поиском телефона
- Профиль с возможностью редактирования и удаления
- Redis rate limiter, сессии, оптимистичная блокировка статусов
- Circuit breaker + exponential backoff retry для PostgreSQL и Redis
- Feature flags с Redis runtime override (без перезапуска)
- Метрики Prometheus `/metrics`, liveness `/health`, readiness `/ready`
- Версионированные FSM-сессии с автомиграцией при деплое
- Автоматические миграции БД при старте
- Опциональный OpenTelemetry трейсинг

---

## Локальный запуск (Docker)

### 1. Клонировать репозиторий

```bash
git clone https://github.com/твой-юзер/vema_equipment_bot.git
cd vema_equipment_bot
```

### 2. Создать `.env`

```bash
cp .env.example .env
```

Заполнить обязательные поля:

```env
BOT_TOKEN=токен_от_BotFather          # получить у @BotFather
ADMIN_IDS=123456789                    # твой Telegram ID (узнать у @userinfobot)
POSTGRES_PASSWORD=надёжный_пароль
```

Остальные переменные можно оставить по умолчанию для локального запуска.

### 3. Запустить

```bash
docker compose up -d --build
```

Docker автоматически:
1. Поднимет PostgreSQL 16 и Redis 7
2. Дождётся готовности БД (healthcheck)
3. Применит все миграции (`npm run migrate`)
4. Запустит бота в режиме **polling** (`app.polling.js`)

### Полезные команды

```bash
# Логи бота в реальном времени
docker compose logs -f app

# Остановить всё
docker compose down

# Остановить и удалить данные БД (осторожно!)
docker compose down -v

# Пересобрать после изменений кода
docker compose up -d --build app
```

---

## Переменные окружения

### Обязательные

| Переменная | Описание |
|---|---|
| `BOT_TOKEN` | Токен бота от @BotFather |
| `ADMIN_IDS` | Telegram ID администраторов через запятую |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL |
| `API_KEY` | Ключ авторизации REST API (**обязателен в production**) |

### Telegram / Webhook

| Переменная | По умолчанию | Описание |
|---|---|---|
| `WEBHOOK_URL` | — | HTTPS URL сервера, напр. `https://bot.example.com` (**обязателен в production**) |
| `WEBHOOK_SECRET` | `webhook-secret-not-set` | Секрет для верификации запросов от Telegram (**обязателен в production**) |

### Сервер

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `3000` | HTTP-порт Fastify |
| `NODE_ENV` | `production` | `production` / `development` / `test` |
| `LOG_LEVEL` | `info` | `error` / `warn` / `info` / `debug` |

### PostgreSQL

| Переменная | По умолчанию | Описание |
|---|---|---|
| `POSTGRES_HOST` | `localhost` | Хост БД |
| `POSTGRES_PORT` | `5432` | Порт БД |
| `POSTGRES_DB` | `vema_bot` | Имя БД |
| `POSTGRES_USER` | `vema` | Пользователь БД |

### Redis

| Переменная | По умолчанию | Описание |
|---|---|---|
| `REDIS_HOST` | `localhost` | Хост Redis |
| `REDIS_PORT` | `6379` | Порт Redis |
| `REDIS_PASSWORD` | — | Пароль Redis (пусто = без пароля) |

### Приложение

| Переменная | По умолчанию | Описание |
|---|---|---|
| `OVERDUE_DAYS` | `7` | Дней до уведомления о просрочке |
| `SESSION_TTL` | `1800` | TTL сессии в секундах |

### Feature Flags

Все флаги читаются из ENV при старте. Runtime-переопределение через Redis:
```bash
redis-cli SET ff:EXCEL_REPORTS false EX 3600   # выключить на час
redis-cli DEL ff:EXCEL_REPORTS                  # вернуть к ENV-умолчанию
```

| Переменная | По умолчанию | Описание |
|---|---|---|
| `FF_RATE_LIMITER` | `true` | Redis rate limiter |
| `FF_REGISTRATION_GUARD` | `true` | Принудительная регистрация |
| `FF_EXCEL_REPORTS` | `true` | Экспорт в Excel |
| `FF_IMAGE_REPORTS` | `true` | Экспорт в PNG |
| `FF_OVERDUE_NOTIFICATIONS` | `true` | BullMQ уведомления о просрочке |
| `FF_REDIS_SESSIONS` | `true` | Redis-сессии |
| `FF_BULLMQ_WORKER` | `true` | BullMQ воркер |
| `FF_NEW_USER_FLOW` | `false` | Новый флоу регистрации (в разработке) |

### OpenTelemetry (опционально)

| Переменная | По умолчанию | Описание |
|---|---|---|
| `OTEL_ENABLED` | `false` | Включить трейсинг (`true` / `false`) |
| `OTEL_EXPORTER` | `console` | `console` или `otlp` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Endpoint для OTLP (напр. `http://jaeger:4318`) |

> При `OTEL_ENABLED=true` нужно установить: `npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node`

---

## Деплой на DigitalOcean

Если на сервере пока нет домена, nginx-конфига для webhook и заполненного `WEBHOOK_URL`, используй polling-режим через `docker-compose.do.yml`.
Webhook-вариант имеет смысл только после настройки домена и HTTPS.

### 1. Создать Droplet

- **OS:** Ubuntu 24.04 LTS
- **Plan:** Basic — 2 GB RAM / 1 CPU (~$12/мес)
- При создании добавить SSH-ключ

### 2. Настроить сервер

```bash
# Обновить систему
apt update && apt upgrade -y

# Установить Docker
curl -fsSL https://get.docker.com | sh
apt install docker-compose-plugin -y
apt install git nginx certbot python3-certbot-nginx -y

# Открыть порты: SSH, HTTP, HTTPS
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

### 3. Развернуть приложение и заполнить `.env`

```bash
git clone https://github.com/твой-юзер/vema_equipment_bot.git /opt/vema-bot
cd /opt/vema-bot
cp .env.example .env
nano .env
```

Минимально для текущего polling-деплоя:

```env
NODE_ENV=production
BOT_TOKEN=токен_от_BotFather
ADMIN_IDS=твой_telegram_id
POSTGRES_PASSWORD=очень_надёжный_пароль
REDIS_PASSWORD=надёжный_redis_пароль
API_KEY=случайный_секретный_ключ
LOG_LEVEL=info
OVERDUE_DAYS=7
SESSION_TTL=1800
WEBHOOK_URL=
WEBHOOK_SECRET=nowebhook
```

### 4. Запустить на текущем droplet (polling)

```bash
docker compose -f docker-compose.do.yml up -d --build
docker compose -f docker-compose.do.yml ps
docker compose -f docker-compose.do.yml logs -f app
```

Этот режим:

- не требует домен и nginx
- использует `src/app.polling.js`
- не зависит от `POST /webhook`
- не будет получать ложный `unhealthy` из-за HTTP healthcheck

### 5. Обновление на сервере

```bash
cd /opt/vema-bot
git pull origin main
docker compose -f docker-compose.do.yml run --rm migrate
docker compose -f docker-compose.do.yml up -d --build app
docker compose -f docker-compose.do.yml logs --tail=100 app
```

### 6. Переход на webhook позже

Когда появятся домен, nginx и HTTPS, можно перейти на `docker-compose.prod.yml`.

### 7. Настроить nginx + TLS

```bash
# Получить SSL-сертификат
certbot --nginx -d bot.example.com

# Добавить в /etc/nginx/sites-available/vema-bot:
# location /webhook {
#     proxy_pass http://127.0.0.1:3000;
#     proxy_set_header X-Forwarded-For $remote_addr;
# }
```

Для webhook-режима `.env` должен содержать:

```env
NODE_ENV=production
BOT_TOKEN=токен_от_BotFather
ADMIN_IDS=твой_telegram_id
WEBHOOK_URL=https://bot.example.com
WEBHOOK_SECRET=<openssl rand -hex 32>
POSTGRES_PASSWORD=очень_надёжный_пароль
REDIS_PASSWORD=надёжный_redis_пароль
API_KEY=<openssl rand -hex 32>
LOG_LEVEL=info
```

### 8. Запустить webhook-вариант

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Проверить готовность:

```bash
curl http://localhost:3000/ready
# {"status":"ready","checks":{"postgres":{"status":"ok"},"redis":{"status":"ok"},...}}
```

### 9. Автозапуск при перезагрузке

```bash
systemctl enable docker
```

---

## Автодеплой через GitHub Actions

При каждом пуше в `main` GitHub Actions:
1. Запускает unit + integration тесты
2. Собирает Docker-образ и пушит в Docker Hub (теги: `git-<sha>` и `latest`)
3. Деплоит на сервер по SSH
4. Проверяет `/ready` (30 попыток × 1с)
5. При неудаче — откатывается к предыдущему образу

### Настройка секретов

`Settings → Secrets and variables → Actions`:

| Секрет | Значение |
|---|---|
| `DO_HOST` | IP-адрес Droplet |
| `DO_SSH_USER` | SSH-пользователь (обычно `root`) |
| `DO_SSH_KEY` | Приватный SSH-ключ (содержимое `~/.ssh/id_rsa`) |
| `DOCKERHUB_USERNAME` | Логин Docker Hub |
| `DOCKERHUB_TOKEN` | Access Token Docker Hub |

После настройки достаточно `git push origin main` — сервер обновится автоматически.

---

## HTTP API

Все endpoint'ы кроме `/health`, `/ready`, `/metrics`, `/webhook` требуют заголовок `X-API-Key`.

| Endpoint | Описание |
|---|---|
| `GET /health` | Liveness probe — всегда 200 если процесс жив |
| `GET /ready` | Readiness probe — 200 если БД и Redis доступны, иначе 503 |
| `GET /metrics` | Prometheus метрики |
| `POST /webhook` | Telegram webhook (защищён `secret_token`) |

---

## Тесты

```bash
# Unit-тесты (без БД и Redis)
npm test

# Integration-тесты (требуют запущенные PostgreSQL и Redis)
npm run test:integration

# Проверка целостности данных в БД
npm run verify

# С автоисправлением безопасных проблем
node scripts/verify-integrity.js --fix
```

---

## Откат

```bash
# Откат к предыдущему Docker-образу
bash scripts/rollback.sh app-previous

# Откат последней миграции БД
bash scripts/rollback.sh db-migration

# Восстановление из .dump файла
bash scripts/rollback.sh db-restore backups/vema_20260415.dump

# Очистить все Redis-сессии
bash scripts/rollback.sh redis-flush
```

---

## Резервные копии

```bash
# Установить автоматический ежедневный бэкап (03:00)
chmod +x scripts/backup.sh scripts/install-cron.sh
bash scripts/install-cron.sh

# Ручной бэкап
bash scripts/backup.sh

# Восстановление из бэкапа
bash scripts/restore.sh backups/vema_20260415_030000.sql.gz
```

Бэкапы сохраняются в `./backups/` и хранятся 7 дней.

---

## Структура проекта

```
src/
  app.js                      — точка входа (webhook-режим, production)
  app.polling.js              — точка входа (polling-режим, docker compose dev)
  tracing.js                  — OpenTelemetry auto-instrumentation (no-op по умолчанию)
  config/
    index.js                  — Zod-валидация всех env vars, единый config объект
  api/                        — Fastify HTTP-сервер
    index.js                  — регистрация middleware и маршрутов
    middleware/
      api-auth.js             — X-API-Key аутентификация
      correlation-id.js       — UUID v4 correlation ID для каждого запроса
    routes/
      health.js               — GET /health (liveness)
      ready.js                — GET /ready (readiness: DB + Redis)
      metrics.js              — GET /metrics (Prometheus)
      webhook.js              — POST /webhook (Telegram)
  bot/
    index.js                  — инициализация бота, middleware-цепочка
    config.js                 — isAdmin, isEffectiveAdmin, hasRole
    labels.js                 — тексты кнопок
    constants.js              — ACTIONS_REGEX и прочие константы
    fsm/
      states.js               — FLOW_TYPE, ADD_STEP, EDIT_STEP константы
      session.schema.js       — defaultSession(), makeFlow(), isFlowExpired()
      state-migrator.js       — миграция сессий между версиями схемы
    handlers/
      equipment.handlers.js   — выдача, возврат, ремонт, списание, удаление
      flow.handlers.js        — многошаговые флоу (добавление/редактирование)
      navigation.handlers.js  — меню, категории, экспорт, управление пользователями
      profile.handlers.js     — регистрация, редактирование и удаление профиля
    helpers/
      equipmentHints.js       — подсказки при вводе (с фильтром по категории)
    middlewares/
      error.handler.js        — обёртка safe() для всех хендлеров
      rate.limiter.js         — Redis rate limiter
      registration.guard.js   — редирект незарегистрированных
      session.middleware.js   — Redis-сессии с автомиграцией
    utils/
      profile.utils.js        — renderProfileCard, startProfileRegistration
    validation/
      equipment.schema.js     — Zod-схемы для валидации ввода
    views/
      equipment.view.js       — карточка оборудования, роль-зависимые кнопки
      menus.js                — все клавиатуры
  db/
    index.js                  — пул PostgreSQL, circuit breaker, retry, transaction()
  lib/
    circuit-breaker.js        — Circuit Breaker (CLOSED/OPEN/HALF_OPEN)
    retry.js                  — exponential backoff retry с jitter
    feature-flags.js          — feature flags (ENV + Redis runtime override)
  migrations/                 — node-pg-migrate SQL-миграции
  redis/
    index.js                  — ioredis клиент с reconnect и событиями
  repositories/               — SQL-запросы (equipment, user, history)
  services/                   — бизнес-логика
  utils/
    constants.js              — STATUS enum
    formatters.js             — форматирование дат и статусов
    logger.js                 — pino JSON-логгер с redact чувствительных полей
    metrics.js                — Prometheus: DB, Redis, circuit breaker, сессии
  workers/
    notification.worker.js    — BullMQ воркер уведомлений о просрочке
scripts/
  verify-integrity.js         — 10 проверок целостности БД (с флагом --fix)
  rollback.sh                 — откат: образ / миграция / бэкап / Redis-сессии
  backup.sh                   — создание резервной копии БД
  restore.sh                  — восстановление из резервной копии
  install-cron.sh             — установка cron-задачи для бэкапов
tests/
  circuit-breaker.test.js
  feature-flags.test.js
  registration-guard.test.js
  retry.test.js
  session-middleware.test.js
  state-migrator.test.js
  equipment.service.test.js
  validation.test.js
  integration/                — интеграционные тесты (требуют БД + Redis)
```

---

## Логи

```bash
# Следить за логами в реальном времени
docker compose logs -f app

# Последние 100 строк
docker compose logs --tail=100 app

# Логи PostgreSQL
docker compose logs postgres
```

В production логи выводятся в JSON-формате (pino). Для удобного чтения локально:

```bash
docker compose logs -f app | npx pino-pretty
```

