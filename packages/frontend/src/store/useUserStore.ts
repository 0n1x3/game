import { create } from 'zustand';
import { UserData } from '@/types/user';
import { API_BASE_URL } from '@/config';

interface UserState {
  telegramId: number | null;
  username: string | null;
  avatarUrl: string | null;
  balance: number;
  level: number;
  experience: number;
  isActive: boolean;
  isCurrentTurn: boolean;
  setUserData: (data: { balance: number; level: number; experience: number }) => void;
  fetchUserData: () => Promise<void>;
  updateUser: (data: UserData) => void;
  updateAvatar: (url: string) => void;
  updateBalance: (amount: number) => void;
  setIsCurrentTurn: (isTurn: boolean) => void;
}

export const useUserStore = create<UserState>((set) => ({
  telegramId: null,
  username: null,
  avatarUrl: null,
  balance: 0,
  level: 1,
  experience: 0,
  isActive: false,
  isCurrentTurn: false,
  setUserData: (data) => {
    console.log('Setting user data:', data);
    set(data);
  },
  fetchUserData: async () => {
    try {
      const webApp = window.Telegram?.WebApp;
      if (!webApp) return;

      const initData = (webApp as any).initData;
      const response = await fetch(`${API_BASE_URL}/users/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });

      if (response.ok) {
        const data = await response.json();
        set({ 
          balance: data.balance || 0,
          level: data.level || 1,
          experience: data.experience || 0
        });
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  },
  updateUser: (data: UserData) => set({
    telegramId: data.telegramId,
    username: data.username,
    avatarUrl: data.avatarUrl,
    balance: data.balance || 0,
    isActive: data.isActive || false,
  }),
  updateAvatar: (url: string) => set({ avatarUrl: url }),
  updateBalance: (amount: number) => set((state) => ({ 
    balance: state.balance + amount 
  })),
  setIsCurrentTurn: (isTurn: boolean) => set({ isCurrentTurn: isTurn }),
})); 
