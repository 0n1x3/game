const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const CONTRACT_ADDRESS = 'EQBUXnGbhnUSd5-Uzk7j4yW_UM9qa_L2ZNoB5FyYRS9hBK-w';

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Game';
export const APP_URL = trimTrailingSlash(
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
);
export const API_URL = trimTrailingSlash(
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005'
);
export const API_BASE_URL = API_URL.endsWith('/api') ? API_URL : `${API_URL}/api`;
export const TELEGRAM_BOT_USERNAME = (
  process.env.NEXT_PUBLIC_BOT_USERNAME || 'game_bot'
).replace(/^@/, '');
export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

export function createTelegramGameLink(gameId: string): string {
  return `${TELEGRAM_BOT_URL}?startapp=game_${gameId}`;
}
