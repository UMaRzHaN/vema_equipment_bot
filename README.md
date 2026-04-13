# VEMA Equipment Bot

Telegram-бот для учёта оборудования.

## Быстрый старт

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка окружения

Скопируй `.env.example` в `.env` и заполни:

```bash
cp .env.example .env
```

| Переменная | Описание |
|---|---|
| `BOT_TOKEN` | Токен бота от @BotFather |
| `DB_PATH` | Путь к SQLite-файлу (по умолч. `./data/inventory.db`) |
| `SESSION_PATH` | Путь к файлу сессий (по умолч. `./data/sessions.json`) |
| `ADMIN_IDS` | Telegram ID администраторов через запятую |
| `LOG_LEVEL` | Уровень логов: `error`, `warn`, `info`, `debug` |

### 3. Запуск

```bash
# Напрямую
npm start

# Через PM2 (рекомендуется для продакшена)
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 4. Docker

```bash
docker build -t vema-bot .
docker run -d \
  --name vema-bot \
  --restart unless-stopped \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  vema-bot
```

## Структура проекта

```
src/
  app.js                  — точка входа, запуск и graceful shutdown
  bot/
    index.js              — инициализация бота, middleware, сессии
    config.js             — ADMIN_IDS, assertBotConfig
    labels.js             — тексты кнопок
    handlers/
      equipment.handlers  — выдача, возврат, ремонт, редактирование
      flow.handlers       — пошаговые флоу (добавление/редактирование оборудования)
      navigation.handlers — главное меню, категории, отчёты
      profile.handlers    — регистрация и редактирование профиля
      user.middleware      — автосохранение ctx.from в БД
    middlewares/
      registration.guard  — редирект незарегистрированных на профиль
    views/
      equipment.view      — карточка оборудования, кнопки
      menus.js            — клавиатуры
  db/                     — инициализация SQLite, миграции
  repositories/           — SQL-запросы
  services/               — бизнес-логика
  utils/
    logger.js             — структурированный JSON-логгер
    formatters.js         — форматирование дат, статусов
    constants.js          — STATUS enum
```

## Логи

Все логи выводятся в JSON-формате. В продакшене удобно перенаправить в файл:

```bash
pm2 logs vema-bot
# или
node src/app.js >> logs/out.log 2>> logs/error.log
```
