import { GameType, GameTransaction } from '@/types/game';
import { API_BASE_URL } from '@/config';

function getTelegramInitData(): { userId: number; initData: string } {
  const tg = window.Telegram?.WebApp;
  
  if (!tg?.initDataUnsafe?.user?.id || !tg?.initData) {
    console.error('Telegram WebApp data:', {
      initDataUnsafe: tg?.initDataUnsafe,
      initData: tg?.initData
    });
    throw new Error('User not authenticated');
  }

  console.log('Using Telegram data:', {
    userId: tg.initDataUnsafe.user.id,
    initData: tg.initData
  });

  return {
    userId: tg.initDataUnsafe.user.id,
    initData: tg.initData
  };
}

export async function createBet(amount: number, game: GameType): Promise<GameTransaction> {
  const { userId, initData } = getTelegramInitData();

  const response = await fetch(`${API_BASE_URL}/transactions/bet`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${initData}`
    },
    body: JSON.stringify({ 
      userId,
      amount, 
      game
    })
  });
  
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Failed to create bet');
  }
  return data.transaction;
}

export async function processGameResult(
  game: GameType,
  result: 'win' | 'lose',
  betAmount: number
): Promise<void> {
  const { userId, initData } = getTelegramInitData();

  const response = await fetch(`${API_BASE_URL}/transactions/result`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${initData}`
    },
    body: JSON.stringify({ 
      userId,
      game, 
      result, 
      betAmount
    })
  });
  
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Failed to process game result');
  }
} 
