# Используем официальный образ Node.js
FROM node:18-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

ARG NEXT_PUBLIC_APP_NAME=Game
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_API_URL=http://localhost:3005
ARG NEXT_PUBLIC_BOT_USERNAME=game_bot

ENV NODE_ENV=production
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_BOT_USERNAME=${NEXT_PUBLIC_BOT_USERNAME}

# Копируем файлы package.json
COPY package.json .
COPY pnpm-lock.yaml .
COPY pnpm-workspace.yaml .
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json

# Используем альтернативный способ установки pnpm
RUN wget -qO /bin/pnpm "https://github.com/pnpm/pnpm/releases/latest/download/pnpm-linuxstatic-x64" && \
    chmod +x /bin/pnpm

# Или можно использовать npm с указанием registry
# RUN npm install -g pnpm --registry=https://registry.npmjs.org

RUN pnpm install --frozen-lockfile

# Копируем исходники
COPY packages/shared ./packages/shared
COPY packages/frontend ./packages/frontend

# Собираем приложение
RUN pnpm --filter frontend build

# Запускаем
CMD ["pnpm", "--filter", "frontend", "start"]
