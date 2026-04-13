# TON Multiplayer Game Platform

Монорепозиторий Telegram Mini App для игровой платформы с мультиплеерными матчами, внутренним балансом, интеграцией TON Connect и серверной логикой на NestJS.

Проект построен как `pnpm workspace` и разделен на три основные части:

- `packages/frontend` - клиентское Mini App приложение на Next.js.
- `packages/backend` - API, WebSocket-шлюз, Telegram-бот и бизнес-логика.
- `packages/shared` - общие типы и контракты между фронтендом и бэкендом.

## Что умеет проект

- Инициализирует пользователя через `Telegram WebApp initData`.
- Хранит пользовательский профиль, баланс, уровень и прогресс в MongoDB.
- Позволяет создавать игровые комнаты и приглашать второго игрока через deep-link Telegram.
- Поддерживает мультиплеерную игру в кости через `socket.io`.
- Поддерживает локальный режим игры в `RPS` со ставками.
- Работает с транзакциями ставок, выплатами выигрышей и возвратом ставок.
- Подключает TON-кошелек через `TonConnect UI`.
- Содержит экран кошелька, страницу друзей, турнирный и income-разделы, legal-страницы.

## Архитектура

### Общая схема

1. Telegram открывает Mini App и передает `initData`.
2. `frontend` сохраняет Telegram-данные и запрашивает инициализацию пользователя.
3. `backend` создает или обновляет пользователя в MongoDB.
4. Игрок создает матч или присоединяется к существующему.
5. Для матчей в кости клиент подключается к WebSocket-шлюзу.
6. Сервер управляет состоянием игры, ходами, раундами и выплатой победителю.
7. `shared` обеспечивает согласованность типов `User`, `Game`, `GameType`, событий и игровых структур.

### Технологический стек

- Frontend: `Next.js 14`, `React 18`, `TypeScript`, `Zustand`, `socket.io-client`, `react-hot-toast`
- Telegram: `telegram-web-app.js`, Mini App deep-links, `node-telegram-bot-api`
- TON: `@tonconnect/ui-react`, `@ton/core`, `@ton/ton`, `@orbs-network/ton-access`
- Backend: `NestJS`, `socket.io`, `Mongoose`
- Database: `MongoDB`
- Infra: `pnpm workspace`, `Docker`, `docker-compose`, `PM2`

## Структура репозитория

```text
game/
|-- package.json
|-- pnpm-workspace.yaml
|-- Dockerfile
|-- docker-compose.yml
|-- DEPLOYMENT.md
`-- packages/
    |-- backend/
    |   |-- Dockerfile
    |   |-- src/
    |   |   |-- main.ts
    |   |   |-- app.module.ts
    |   |   |-- bot/
    |   |   |-- game/
    |   |   |-- tasks/
    |   |   |-- transactions/
    |   |   |-- users/
    |   |   `-- schemas/
    |-- frontend/
    |   |-- Dockerfile
    |   |-- app/
    |   |-- public/
    |   `-- src/
    |       |-- components/
    |       |-- features/
    |       |-- hooks/
    |       |-- providers/
    |       |-- services/
    |       |-- store/
    |       `-- utils/
    `-- shared/
        `-- src/
            |-- index.ts
            `-- types.ts
```

## Корневые файлы

### `package.json`

Корневой пакет управляет workspace-сценариями:

- `pnpm dev` - запускает фронтенд в режиме разработки.
- `pnpm build` - последовательно собирает `shared`, `backend`, `frontend`.
- `pnpm start` - одновременно поднимает прод-сервер backend и frontend.
- `pnpm test`, `pnpm lint` - проксируют команды в пакеты.

### `pnpm-workspace.yaml`

Подключает все пакеты из `packages/*` и делает проект полноценным монорепозиторием.

### `Dockerfile`

Корневой Dockerfile использует multi-stage build:

- в `builder`-слое устанавливает зависимости workspace;
- сначала собирает `packages/shared`;
- затем собирает весь монорепозиторий;
- в `runner`-слое копирует только собранные артефакты и production-зависимости;
- открывает порты `3000` и `3005`;
- запускает приложение через `pnpm start`.

Это основной сценарий упаковки всего монорепозитория в один образ.

### `docker-compose.yml`

Файл поднимает два сервиса:

- `frontend` на порту `3000`
- `backend` на порту `3005`

Также задаются:

- `BOT_TOKEN` для backend;
- `NEXT_PUBLIC_API_URL` для frontend;
- отдельная bridge-сеть `game-network`.

Важно: `docker-compose.yml` использует пакетные Dockerfile внутри `packages/backend` и `packages/frontend`, тогда как корневой `Dockerfile` собирает весь монорепозиторий как единое приложение. Это два разных сценария контейнеризации.

### `DEPLOYMENT.md`

Содержит заметки по ручной сборке, локальному запуску, чек-листу проверки, PM2 и деплой-процессу. Документ полезен как operational runbook, но актуальная архитектурная карта проекта описана в этом `README.md`.

## Пакет `packages/shared`

Общий пакет нужен для согласования доменной модели между клиентом и сервером.

### Что лежит внутри

- `src/index.ts` - точка экспорта.
- `src/types.ts` - основные типы и enum:
  - `GameType`
  - `User`
  - `BaseUser`
  - `Game`
  - `GameState`
  - `WSEvents`

### Зачем он нужен

- устраняет дублирование типов;
- делает API и WebSocket-контракты явными;
- снижает риск рассинхронизации между фронтендом и бэкендом.

## Пакет `packages/backend`

Backend реализован на `NestJS` и сочетает несколько ролей:

- REST API для инициализации пользователя, игр, задач и транзакций;
- WebSocket Gateway для мультиплеерных матчей;
- Telegram-бот;
- слой доступа к MongoDB через `Mongoose`.

### Точка входа

Файл `src/main.ts`:

- создает Nest-приложение;
- включает CORS для origin-списка, собранного из env-конфига;
- задает глобальный префикс `api`;
- инициализирует стандартные задания через `TasksService`;
- запускает HTTP/WebSocket сервер на порту `3005`.

### Главный модуль

`src/app.module.ts` подключает:

- `ConfigModule`
- `MongooseModule.forRoot(process.env.MONGODB_URI)`
- `UsersModule`
- `BotModule`
- `GameModule`
- `TasksModule`
- `TransactionsModule`

Это означает, что MongoDB URI обязателен для полноценного запуска backend.

### Основные доменные модули

#### `users`

Назначение:

- инициализация пользователя по данным Telegram;
- обновление аватара;
- хранение баланса, уровня и опыта.

Ключевые файлы:

- `src/users/users.controller.ts`
- `src/users/users.service.ts`
- `src/schemas/user.schema.ts`

Что делает сервис:

- ищет или создает пользователя по `telegramId`;
- поддерживает обновление `avatarUrl` и `tonWallet`;
- возвращает данные в форме, совместимой с `shared/User`.

Что хранит схема пользователя:

- `telegramId`
- `username`
- `avatarUrl`
- `balance`
- `level`
- `experience`
- `completedTasks`
- `isActive`
- `tonWallet`

#### `game`

Назначение:

- создание игровых комнат;
- присоединение к лобби;
- запуск матча;
- обработка ходов;
- завершение игры и начисление выигрыша.

Ключевые файлы:

- `src/game/game.controller.ts`
- `src/game/game.service.ts`
- `src/game/game.gateway.ts`
- `src/schemas/game.schema.ts`

REST-слой (`game.controller.ts`) отвечает за:

- получение списка активных игр;
- создание игры;
- присоединение к игре;
- запуск игры;
- получение игры по ID;
- удаление лобби с возвратом ставки создателю.

WebSocket-слой (`game.gateway.ts`) отвечает за:

- подключение игроков к комнате `game_<id>`;
- синхронизацию статуса подключения;
- рассылку `diceGameStarted`, `diceMove`, `roundResult`, `gameEnd`;
- выдачу актуального состояния игры и списка игроков.

Сервис (`game.service.ts`) содержит основную бизнес-логику:

- списывает ставку при создании комнаты;
- валидирует баланс и участие игрока;
- автоматически запускает dice-игру после подключения второго игрока;
- хранит текущий раунд и очередь хода;
- определяет победителя по итогам серии;
- инициирует выплату через `TransactionsService`;
- возвращает ставку при удалении игры в статусе `waiting`.

Игровая схема (`game.schema.ts`) хранит:

- `name`
- `type` (`rps`, `dice`)
- `players`
- `betAmount`
- `status`
- `currentPlayer`
- `currentRound`
- `rounds`
- `createdBy`
- `inviteLink`

#### `transactions`

Назначение:

- создание транзакций ставок;
- начисление выигрышей;
- возврат ставок;
- изменение баланса пользователя.

Ключевые файлы:

- `src/transactions/transactions.controller.ts`
- `src/transactions/transactions.service.ts`
- `src/schemas/transaction.schema.ts`

Основные сценарии:

- `createBet()` - проверяет баланс, создает транзакцию ставки, уменьшает баланс.
- `processGameResult()` - базовая обработка результата для одиночных сценариев.
- `processPayout()` - записывает транзакцию выигрыша и начисляет средства победителю.
- `refundBet()` - возвращает средства при удалении не начавшейся игры.

Типы транзакций:

- `bet`
- `win`
- `loss`
- `reward`

#### `tasks`

Назначение:

- выдача активных заданий;
- отметка выполненных заданий;
- начисление награды и опыта.

Ключевые файлы:

- `src/tasks/tasks.controller.ts`
- `src/tasks/tasks.service.ts`
- `src/schemas/task.schema.ts`

Особенность текущей реализации:

- при `initDefaultTasks()` существующие задания удаляются и создается базовый набор заново;
- по умолчанию создается задание `First Task` с наградой `1000`.

#### `bot`

Назначение:

- запуск Telegram-бота на `node-telegram-bot-api`;
- обработка `/start`;
- отправка уведомлений;
- генерация invite-flow через deep-link.

Ключевой файл:

- `src/bot/bot.service.ts`
- `src/config/runtime.ts`

Для запуска обязателен `BOT_TOKEN`.

## Пакет `packages/frontend`

Фронтенд реализован на `Next.js App Router` и адаптирован под Telegram Mini App.

### Точка входа и layout

`app/layout.tsx` делает несколько важных вещей:

- загружает Telegram WebApp SDK;
- вызывает `WebApp.ready()`;
- сохраняет Telegram user/initData в `localStorage`;
- инициализирует viewport под мобильный режим;
- поднимает провайдеры i18n, TON и модальных окон;
- инициирует загрузку пользовательских данных через Zustand store.

### Основные маршруты `app/`

- `app/page.tsx` - главная страница, рендерит `HomePage`.
- `app/game/[id]/page.tsx` - отдельная страница конкретной multiplayer-игры.
- `app/games/dice/page.tsx` - интерфейс для игры в кости.
- `app/games/rps/page.tsx` - интерфейс для игры "камень-ножницы-бумага".
- `app/wallet/page.tsx` - экран кошелька.
- `app/friends/page.tsx` - раздел друзей.
- `app/income/page.tsx` - доходы и задания.
- `app/tournament/page.tsx` - турнирный экран.
- `app/(legal)/privacy/page.tsx` и `app/(legal)/terms/page.tsx` - legal-страницы.

### Провайдеры

#### `src/providers/ton`

TON-провайдер:

- определяет `manifestUrl` на основе `NEXT_PUBLIC_APP_URL`;
- инициализирует `TonConnectUIProvider`;
- конфигурирует возврат в Telegram Mini App;
- добавляет Tonkeeper в список кошельков.

#### `src/providers/i18n`

Провайдер локализации использует словари:

- `src/i18n/translations/ru.json`
- `src/i18n/translations/en.json`
- `src/i18n/translations/zh.json`

#### `src/providers/modal`

Отвечает за модальные окна и портальный контейнер.

### Слой состояния

`src/store/useUserStore.ts` хранит:

- `telegramId`
- `username`
- `avatarUrl`
- `balance`
- `level`
- `experience`
- `isActive`
- `isCurrentTurn`

Store используется как единая клиентская точка данных пользователя и состояния очереди хода в multiplayer-матчах.

### Основные feature-модули

#### `src/features/home/HomePage`

Показывает каталог игр. Активные сейчас:

- `RPS`
- `Dice`

Остальные карточки отмечены как `coming soon`.

#### `src/features/wallet/WalletPage`

Содержит:

- кнопку подключения кошелька `TonConnectButton`;
- блок баланса;
- вкладки `Deposit` / `Withdraw`.

Это UI-слой для будущих on-chain операций и интеграции с контрактом.

#### `src/features/games/rps`

Реализует локальный игровой поток:

- выбор типа ставки;
- выбор режима;
- установка размера ставки;
- создание ставки через backend;
- обработка результата игры.

#### `src/features/games/dice`

Это наиболее насыщенный модуль проекта.

Содержит:

- экран настройки новой игры;
- лобби активных игр;
- создание новой комнаты;
- открытие страницы `/game/[id]`;
- multiplayer-компонент на `socket.io`.

##### `MultiplayerDiceGame`

Ключевой клиентский компонент multiplayer-механики:

- получает Telegram user id;
- подключается к WebSocket серверу;
- присоединяется к комнате игры;
- синхронизирует список игроков и состояние матча;
- обрабатывает очередность ходов;
- показывает waiting room;
- анимирует броски кубика;
- показывает раунды, счет и финальный результат.

Этот компонент является центром real-time взаимодействия на клиенте.

### Клиентские сервисы

#### `src/services/transactions.ts`

Файл инкапсулирует REST-запросы к backend:

- `createBet()`
- `processGameResult()`

Оба сценария используют Telegram `initData` как источник идентификации пользователя.

### Конфиг и инфраструктура фронтенда

#### `next.config.js`

Содержит важные настройки:

- `reactStrictMode`;
- `transpilePackages` для workspace-пакета `shared`;
- `output: 'standalone'` для контейнеризации;
- выбор `NEXT_PUBLIC_APP_URL` в зависимости от окружения;
- rewrite для `tonconnect-manifest.json`;
- permissive headers для встраивания Mini App.

#### `src/config.ts`

Содержит клиентские runtime-настройки:

- `CONTRACT_ADDRESS`
- `APP_NAME`
- `APP_URL`
- `API_URL`
- `API_BASE_URL`
- `TELEGRAM_BOT_USERNAME`
- `createTelegramGameLink()`

Это центральная точка для URL API, deep-link Telegram-бота и frontend branding.

## Потоки данных

### Инициализация пользователя

1. Клиент получает `window.Telegram.WebApp.initData`.
2. Zustand store вызывает `POST /api/users/init`.
3. Backend парсит `initData`, извлекает Telegram-профиль и создает или обновляет запись пользователя.
4. Клиент получает баланс, уровень и опыт.

### Создание dice-игры

1. Игрок выбирает ставку на фронтенде.
2. Клиент отправляет `POST /api/games/create`.
3. Backend списывает ставку через `TransactionsService`.
4. Создается запись `Game` в MongoDB со статусом `waiting`.
5. Пользователь получает invite-link формата `t.me/...startapp=game_<id>`.

### Подключение второго игрока

1. Второй пользователь открывает deep-link Telegram.
2. Frontend распознает `start_param`.
3. Клиент открывает `/game/[id]`.
4. Backend добавляет игрока в матч и при необходимости списывает вторую ставку.
5. WebSocket-комната синхронизирует обоих участников.

### Завершение матча

1. Игроки отправляют ходы через `diceMove`.
2. Backend формирует раунды и считает победы.
3. После выполнения условий победы игра переводится в `finished`.
4. Победитель получает выплату `betAmount * 2`.
5. Фронтенд обновляет баланс и отображает результат.

## API и real-time компоненты

### Основные REST endpoint'ы

- `POST /api/users/init`
- `POST /api/users/update-avatar`
- `DELETE /api/users/reset`
- `GET /api/games/list`
- `GET /api/games/active`
- `GET /api/games/:id`
- `POST /api/games/create`
- `POST /api/games/join`
- `POST /api/games/start`
- `DELETE /api/games/:id`
- `POST /api/tasks/active`
- `GET /api/tasks/completed`
- `POST /api/tasks/complete`
- `POST /api/transactions/bet`
- `POST /api/transactions/result`

### Ключевые WebSocket события

- `joinGameRoom`
- `getGameStatus`
- `getGamePlayers`
- `startDiceGame`
- `diceMove`
- `diceGameStarted`
- `roundResult`
- `gameEnd`
- `connectionStatus`

## Переменные окружения

Минимально важные переменные, которые используются в коде:

### Backend

Шаблон:

- `packages/backend/.env.example`

```env
NODE_ENV=development
APP_NAME=Game
MONGODB_URI=mongodb://localhost:27017/game
BOT_TOKEN=telegram_bot_token
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
TELEGRAM_BOT_USERNAME=game_bot
```

### Frontend

Шаблон:

- `packages/frontend/.env.example`

```env
NODE_ENV=development
NEXT_PUBLIC_APP_NAME=Game
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3005
NEXT_PUBLIC_BOT_USERNAME=game_bot
```

Быстрый старт для локальной разработки:

```bash
copy .env.example .env
copy packages\backend\.env.example packages\backend\.env
copy packages\frontend\.env.example packages\frontend\.env
```

Корневой шаблон:

- `.env.example`

Примечания:

- корневой `.env.example` нужен для `docker-compose` и содержит как backend-, так и frontend-переменные;
- TonConnect manifest для production/dev использует placeholder-домены и должен быть адаптирован под реальный домен перед боевым деплоем;
- адрес контракта сейчас хранится в `src/config.ts`, а не в `.env`.

## Локальный запуск

### Установка зависимостей

```bash
pnpm install
```

### Разработка по пакетам

Сначала соберите общие типы:

```bash
pnpm --filter ./packages/shared build
```

Запустите backend:

```bash
pnpm --filter ./packages/backend start:dev
```

В отдельном терминале запустите frontend:

```bash
pnpm --filter ./packages/frontend dev
```

### Сборка всего проекта

```bash
pnpm build
```

### Прод-запуск из монорепозитория

```bash
pnpm start
```

## Docker

### Вариант 1. Единый образ из корня

```bash
docker build -t ton-game-platform .
docker run -p 3000:3000 -p 3005:3005 ton-game-platform
```

### Вариант 2. Отдельные сервисы через compose

```bash
docker-compose up --build
```

Compose-сценарий полезен, если frontend и backend должны собираться раздельно.

## Основные каталоги фронтенда

Ниже карта по назначению, чтобы быстрее ориентироваться в коде:

- `src/components/_layout` - базовые layout-компоненты, safe area, header, bottom nav.
- `src/components/_common` - переиспользуемые UI-элементы.
- `src/components/_wallet` - UI блоки кошелька и контрактных операций.
- `src/components/_shared` - общие инфраструктурные компоненты вроде `ErrorBoundary`.
- `src/features` - продуктовые сценарии по доменам: `games`, `wallet`, `home`, `income`, `friends`, `tournament`.
- `src/hooks/wallet` - hooks для TonConnect, клиента TON и баланса.
- `src/providers` - системные провайдеры приложения.
- `src/services` - клиентские API-обертки.
- `src/store` - глобальное состояние пользователя.
- `src/utils` - Telegram/viewport/platform-утилиты.
- `public` - статические ресурсы и манифесты TonConnect.

## Основные каталоги backend

- `src/users` - пользовательский профиль и инициализация по Telegram.
- `src/game` - игровая логика, REST API и WebSocket.
- `src/transactions` - операции со ставками и балансом.
- `src/tasks` - задания и награды.
- `src/bot` - Telegram-бот и уведомления.
- `src/schemas` - Mongoose-схемы доменных сущностей.

## Что важно знать перед развитием проекта

- В проекте уже есть хорошее разделение на UI, доменную логику и общие типы.
- Multiplayer-функциональность сконцентрирована вокруг dice-режима; именно он сейчас является центральной real-time фичей.
- `RPS` реализован проще и не использует тот же уровень real-time синхронизации.
- Branding и deep-link Telegram-бота теперь настраиваются через env-переменные.
- `TasksService.initDefaultTasks()` пересоздает задачи, что важно учитывать при продакшн-данных.
- Корневой Dockerfile и `docker-compose.yml` описывают разные модели деплоя.

## Рекомендации по следующим улучшениям

- Добавить healthcheck'и для Docker и reverse proxy.
- Закрыть заглушку `verifyToken()` в `packages/shared`.
- Формализовать DTO и валидацию входных данных на backend.
- Добавить тесты для `GameService` и критических транзакционных сценариев.
- Разделить operational-документацию и архитектурную документацию без дублирования.

## Связанные документы

- `DEPLOYMENT.md` - инструкции по деплою, PM2 и operational checklist.
- `Dockerfile` - сборка всего workspace.
- `docker-compose.yml` - раздельный запуск сервисов в контейнерах.
