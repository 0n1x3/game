const DEFAULT_FRONTEND_URL = 'http://localhost:3000';
const DEFAULT_TELEGRAM_BOT_USERNAME = 'game_bot';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getFrontendUrl(): string {
  return trimTrailingSlash(process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL);
}

export function getAllowedOrigins(): string[] {
  const envOrigins = process.env.CORS_ORIGINS
    ?.split(',')
    .map((origin) => trimTrailingSlash(origin.trim()))
    .filter(Boolean);

  if (envOrigins && envOrigins.length > 0) {
    return [...new Set(envOrigins)];
  }

  return [...new Set([getFrontendUrl(), DEFAULT_FRONTEND_URL])];
}

export function getTelegramBotUsername(): string {
  return (process.env.TELEGRAM_BOT_USERNAME || DEFAULT_TELEGRAM_BOT_USERNAME).replace(/^@/, '');
}

export function createTelegramGameLink(gameId: string): string {
  return `https://t.me/${getTelegramBotUsername()}?startapp=game_${gameId}`;
}
