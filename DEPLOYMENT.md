# Руководство по запуску и деплою

Документ описывает практический порядок запуска и выкладки монорепозитория `game`. Архитектурное описание и карта компонентов находятся в `README.md`, а здесь собраны рабочие шаги для окружения, сборки, проверки и сопровождения.

## Состав проекта

- `packages/frontend` - Telegram Mini App на `Next.js`, порт `3000`
- `packages/backend` - `NestJS` API, `socket.io`, Telegram-бот, порт `3005`
- `packages/shared` - общие типы для frontend и backend

## Переменные окружения

### Backend

Создайте файл `packages/backend/.env` на основе шаблона:

```bash
copy packages\backend\.env.example packages\backend\.env
```

Минимальный набор:

```env
NODE_ENV=development
APP_NAME=Game
MONGODB_URI=mongodb://localhost:27017/game
BOT_TOKEN=replace_with_telegram_bot_token
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
TELEGRAM_BOT_USERNAME=game_bot
```

### Frontend

Создайте файл `packages/frontend/.env` на основе шаблона:

```bash
copy packages\frontend\.env.example packages\frontend\.env
```

Минимальный набор:

```env
NODE_ENV=development
NEXT_PUBLIC_APP_NAME=Game
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3005
NEXT_PUBLIC_BOT_USERNAME=game_bot
```

### Корневой `.env` для `docker-compose`

Если вы запускаете сервисы через `docker-compose`, создайте корневой `.env`:

```bash
copy .env.example .env
```

Шаблон `./.env.example` содержит:

- `BOT_TOKEN`
- `MONGODB_URI`
- `FRONTEND_URL`
- `CORS_ORIGINS`
- `TELEGRAM_BOT_USERNAME`
- `NEXT_PUBLIC_APP_NAME`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_BOT_USERNAME`

## Локальная разработка

### 1. Установка зависимостей

```bash
pnpm install
```

### 2. Сборка общего пакета

Перед запуском backend и frontend соберите `shared`:

```bash
pnpm --filter ./packages/shared build
```

### 3. Запуск backend

```bash
pnpm --filter ./packages/backend start:dev
```

### 4. Запуск frontend

В отдельном терминале:

```bash
pnpm --filter ./packages/frontend dev
```

### 5. Полная сборка всего проекта

```bash
pnpm build
```

## Локальный чеклист

- Открыть `http://localhost:3000`
- Проверить, что backend отвечает на `http://localhost:3005/api`
- Убедиться, что пользователь инициализируется через `users/init`
- Проверить создание комнаты и подключение второго игрока
- Проверить WebSocket-события для `dice`-игры
- Проверить подключение TonConnect
- Проверить отсутствие критических ошибок в консоли браузера и логах backend

## Docker-сценарии

В репозитории есть два варианта контейнеризации.

### Вариант 1. Один образ из корня

Корневой `Dockerfile` собирает весь монорепозиторий и запускает одновременно backend и frontend.

```bash
docker build -t ton-game-platform .
docker run -p 3000:3000 -p 3005:3005 ton-game-platform
```

### Вариант 2. Раздельные сервисы через compose

`docker-compose.yml` поднимает два сервиса: `frontend` и `backend`.

```bash
docker-compose up --build
```

Перед запуском compose убедитесь, что переменные окружения доступны Docker через shell или `.env` на уровне compose.

## Прод-сборка и запуск

### Сборка

```bash
pnpm build
```

### GitHub Actions деплой

Текущий workflow разделен на два GitHub Actions job:

- `build-and-push` - сборка пакетов и публикация Docker-образов
- `deploy` - SSH-проверка, логин в Docker Hub на сервере, запуск через `docker compose` и вывод статуса

Деплой выполняется по SSH:

- пользователь: `root`
- директория на сервере: `/root/game`
- обязательные GitHub Secrets:
  - `SERVER_HOST`
  - `SERVER_SSH_KEY`
  - `DOCKER_USERNAME`
  - `DOCKER_PASSWORD`
  - `MONGODB_URI`
  - `BOT_TOKEN`

Перед основным деплоем workflow выполняет отдельный SSH-check шаг, чтобы ошибки ключа и доступа падали раньше сборки/перезапуска контейнеров.
На сервере перед `docker pull` выполняется `docker login`, поэтому отдельная ручная авторизация не нужна.
Во время деплоя workflow выводит версии `docker` и `docker compose`, затем выполняет `pull`, `down`, `up -d --remove-orphans`, после чего печатает `docker compose ps` и `docker ps`.
Если запуск контейнеров падает, workflow автоматически печатает диагностические логи `backend` и `frontend`, чтобы причину можно было увидеть прямо в GitHub Actions.

### Запуск из корня монорепозитория

```bash
pnpm start
```

Команда использует корневой скрипт и запускает:

- `pnpm --filter backend start:prod`
- `pnpm --filter frontend start`

## PM2

Если приложение запускается без Docker, удобно использовать `PM2`.

### Просмотр логов

```bash
pm2 logs backend
pm2 logs frontend
```

### Перезапуск

```bash
pm2 restart backend
pm2 restart frontend
```

### Проверка состояния

```bash
pm2 status
```

## Проверка после деплоя

- Проверить доступность frontend-домена
- Проверить ответы backend на `/api`
- Проверить подключение Telegram Mini App
- Проверить TonConnect manifest и подключение кошелька
- Проверить создание комнаты и переход по deep-link `startapp=game_<id>`
- Проверить подключение второго игрока и запуск `dice`-матча
- Проверить выплату победителю и обновление баланса
- Проверить логи backend, WebSocket и Telegram-бота

## Обслуживание и диагностика

### Полная пересборка

```bash
pnpm --filter ./packages/shared build
pnpm --filter ./packages/backend build
pnpm --filter ./packages/frontend build
```

### Проверка зависимостей

```bash
pnpm outdated --recursive
pnpm update --recursive
```

### Если сломались workspace-зависимости

Проверьте:

- что пакет указан как `"workspace:*"` в зависимостях
- что `pnpm-workspace.yaml` включает `packages/*`
- что пакет `shared` был собран до запуска backend/frontend

После этого повторите:

```bash
pnpm install
pnpm --filter ./packages/shared build
```

## Важные замечания

- Backend не поднимется без корректного `MONGODB_URI`.
- Telegram-бот не поднимется без `BOT_TOKEN`.
- TonConnect manifest и nginx-конфиг в репозитории используют placeholder-домены и требуют замены на реальный домен перед production-деплоем.
- Для локальной отладки multiplayer-режима важно, чтобы `NEXT_PUBLIC_API_URL` указывал на backend с WebSocket-доступом.
- `TasksService.initDefaultTasks()` при старте пересоздает базовые задания, это нужно учитывать на production-среде.
- Username Telegram-бота для deep-link задается через `TELEGRAM_BOT_USERNAME` и `NEXT_PUBLIC_BOT_USERNAME`.

## Связанные файлы

- `README.md` - архитектура, структура проекта и описание компонентов
- `.env.example` - корневой шаблон для `docker-compose`
- `packages/backend/.env.example` - шаблон окружения backend
- `packages/frontend/.env.example` - шаблон окружения frontend
- `Dockerfile` - сборка всего монорепозитория
- `docker-compose.yml` - раздельный контейнерный запуск frontend и backend
