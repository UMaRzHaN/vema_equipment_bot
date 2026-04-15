# VEMA Equipment Bot

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
- Метрики Prometheus `/metrics`, health-check `/health`
- Автоматические миграции БД при старте

---

## Запуск через Docker (локально)

### 1. Клонировать репозиторий

```bash
git clone https://github.com/твой-юзер/vema_equipment_bot.git
cd vema_equipment_bot
```

### 2. Создать `.env`

```bash
cp .env.example .env
```

Открыть `.env` и заполнить обязательные поля:

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
4. Запустит бота в режиме polling

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

| Переменная | Обязательная | Описание |
|---|---|---|
| `BOT_TOKEN` | ✅ | Токен бота от @BotFather |
| `ADMIN_IDS` | ✅ | Telegram ID администраторов через запятую |
| `POSTGRES_PASSWORD` | ✅ | Пароль PostgreSQL |
| `POSTGRES_USER` | — | Пользователь БД (по умолч. `vema`) |
| `POSTGRES_DB` | — | Имя БД (по умолч. `vema_bot`) |
| `REDIS_HOST` | — | Хост Redis (по умолч. `redis`) |
| `REDIS_PASSWORD` | — | Пароль Redis (пусто = без пароля) |
| `LOG_LEVEL` | — | `error` / `warn` / `info` / `debug` (по умолч. `info`) |
| `OVERDUE_DAYS` | — | Дней до уведомления о просрочке (по умолч. `7`) |
| `SESSION_TTL` | — | TTL сессии в секундах (по умолч. `1800`) |

---

## Деплой на Digital Ocean

### 1. Создать Droplet

- **OS:** Ubuntu 24.04 LTS
- **Plan:** Basic — 2 GB RAM / 1 CPU (~$12/мес) — достаточно
- **Region:** ближайший к пользователям (например, Frankfurt)
- При создании добавить SSH-ключ для подключения

### 2. Настроить сервер

Подключиться по SSH и выполнить:

```bash
# Обновить систему
apt update && apt upgrade -y

# Установить Docker
curl -fsSL https://get.docker.com | sh

# Установить Docker Compose plugin
apt install docker-compose-plugin -y

# Установить git
apt install git -y

# Закрыть все порты кроме SSH (бот работает в режиме polling — открытые порты не нужны)
ufw allow 22
ufw enable
```

### 3. Развернуть приложение

```bash
# Клонировать репозиторий
git clone https://github.com/твой-юзер/vema_equipment_bot.git /opt/vema-bot
cd /opt/vema-bot

# Создать .env с реальными данными
cp .env.example .env
nano .env
```

Заполнить `.env` на сервере:

```env
BOT_TOKEN=токен_от_BotFather
ADMIN_IDS=твой_telegram_id
NODE_ENV=production
POSTGRES_PASSWORD=очень_надёжный_пароль
POSTGRES_USER=vema
POSTGRES_DB=vema_bot
DATABASE_URL=postgresql://vema:очень_надёжный_пароль@postgres:5432/vema_bot
REDIS_HOST=redis
LOG_LEVEL=info
OVERDUE_DAYS=7
```

### 4. Запустить

```bash
docker compose up -d --build
```

Проверить что бот запустился:

```bash
docker compose logs -f app
# Должно появиться: Bot started in polling mode
```

### 5. Автозапуск при перезагрузке сервера

Docker уже настроен на `restart: unless-stopped` — бот поднимется сам. Убедись что служба Docker стартует автоматически:

```bash
systemctl enable docker
```

---

## Автодеплой через GitHub Actions

В репозитории уже есть `.github/workflows/deploy.yml`. При каждом пуше в `main` он автоматически деплоит новую версию на сервер.

### Настройка

Добавить секреты в GitHub (`Settings → Secrets and variables → Actions`):

| Секрет | Значение |
|---|---|
| `DO_HOST` | IP-адрес Droplet |
| `DO_SSH_KEY` | Приватный SSH-ключ (содержимое `~/.ssh/id_rsa`) |

После этого достаточно сделать `git push origin main` — сервер обновится автоматически.

---

## Резервные копии

### Установить автоматический ежедневный бэкап (03:00)

```bash
chmod +x /opt/vema-bot/scripts/backup.sh
chmod +x /opt/vema-bot/scripts/install-cron.sh
bash /opt/vema-bot/scripts/install-cron.sh
```

Бэкапы сохраняются в `./backups/` и хранятся 7 дней.

### Ручной бэкап

```bash
bash /opt/vema-bot/scripts/backup.sh
```

### Восстановление из бэкапа

```bash
bash /opt/vema-bot/scripts/restore.sh backups/vema_20260415_030000.sql.gz
```

---

## Структура проекта

```
src/
  app.js                    — точка входа (webhook-режим)
  app.polling.js            — точка входа (polling-режим, используется в Docker)
  api/                      — Fastify HTTP-сервер (webhook, /health, /metrics)
  bot/
    index.js                — инициализация бота, middleware-цепочка
    config.js               — isAdmin, isEffectiveAdmin, hasRole
    labels.js               — тексты кнопок
    fsm/                    — конечный автомат: состояния и схема сессии
    handlers/
      equipment.handlers.js — выдача, возврат, ремонт, списание, удаление
      flow.handlers.js      — многошаговые флоу (добавление/редактирование)
      navigation.handlers.js — меню, категории, экспорт, управление пользователями
      profile.handlers.js   — регистрация, редактирование и удаление профиля
      user.middleware.js    — кеширование роли в сессии
    helpers/
      equipmentHints.js     — подсказки при вводе (с фильтром по категории)
    middlewares/
      error.handler.js      — обёртка safe() для всех хендлеров
      rate.limiter.js       — Redis rate limiter
      registration.guard.js — редирект незарегистрированных
      session.middleware.js — Redis-сессии
    validation/
      equipment.schema.js   — Zod-схемы для валидации ввода
    views/
      equipment.view.js     — карточка оборудования, роль-зависимые кнопки
      menus.js              — все клавиатуры
  db/
    index.js                — пул PostgreSQL, transaction()
  migrations/               — node-pg-migrate миграции
  repositories/             — SQL-запросы (equipment, user, history)
  services/                 — бизнес-логика
  utils/
    constants.js            — STATUS enum
    formatters.js           — форматирование дат и статусов
    logger.js               — pino JSON-логгер
    metrics.js              — Prometheus счётчики
  workers/
    notification.worker.js  — BullMQ воркер уведомлений
scripts/
  backup.sh                 — создание резервной копии БД
  restore.sh                — восстановление из резервной копии
  install-cron.sh           — установка cron-задачи для бэкапов
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

В продакшене логи выводятся в JSON-формате (pino). Для удобного чтения локально установи `pino-pretty`:

```bash
docker compose logs -f app | npx pino-pretty
```

---

## Тесты

```bash
npm test
```
