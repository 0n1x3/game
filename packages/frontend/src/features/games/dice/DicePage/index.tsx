'use client';

import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { useTranslation } from '@/providers/i18n';
import { SafeArea } from '@/components/_layout/SafeArea';
import { PageContainer } from '@/components/_layout/PageContainer';
import { PageHeader } from '@/components/_layout/PageHeader';
import { useUserStore } from '@/store/useUserStore';
import { DiceGame } from '../components/DiceGame';
import { LobbyInterface } from '@/features/games/components/LobbyInterface';
import './style.css';
import { createBet, processGameResult } from '@/services/transactions';
import { GameType } from '@/types/game';
import { toast } from 'react-hot-toast';
import { MultiplayerDiceGame } from '../components/MultiplayerDiceGame';
import { ErrorBoundary } from '@/components/_shared/ErrorBoundary';
import { GameSetup } from '../components/GameSetup';
import { API_BASE_URL } from '@/config';

type GameMode = 'bot' | 'player';
type GameState = 'setup' | 'lobby' | 'playing';
type BetType = 'tokens' | 'real';

export function DicePage() {
  const { t } = useTranslation();
  const [betType, setBetType] = useState<BetType>('tokens');
  const [gameMode, setGameMode] = useState<GameMode>('bot');
  const [gameState, setGameState] = useState<GameState>('setup');
  const [betAmount, setBetAmount] = useState<number>(100);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [showLobby, setShowLobby] = useState<boolean>(true);

  const updateUserBalance = useUserStore(state => state.updateBalance);

  const handleStartGame = async () => {
    try {
      const userBalance = useUserStore.getState().balance;
      
      if (betType === 'tokens' && userBalance < betAmount) {
        window.Telegram?.WebApp?.showPopup({
          title: t('common.error'),
          message: t('pages.games.dice.errors.insufficientBalance'),
          buttons: [{ type: 'ok' }]
        });
        return;
      }

      if (gameMode === 'bot') {
        await createBet(betAmount, GameType.DICE);
        updateUserBalance(-betAmount);
        setGameState('playing');
      } else {
        // Создаем игру и перенаправляем на отдельную страницу
        try {
          const tg = window.Telegram?.WebApp;
          if (!tg?.initData) {
            toast.error(t('pages.games.dice.errors.notAuthenticated'));
            return;
          }
          
          console.log('Создание игры со ставкой:', betAmount, typeof betAmount);
          
          const response = await fetch('/api/games/create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              type: 'dice', // Измените gameType на type для соответствия ожиданиям сервера
              betAmount: Number(betAmount),
              initData: tg.initData
            }),
          });
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Ошибка сервера при создании игры:', errorData);
            throw new Error(errorData.message || 'Ошибка сервера');
          }
          
          const data = await response.json();
          
          if (data.success) {
            // Перенаправляем на отдельную страницу
            window.location.href = `/game/${data.game._id}`;
          } else {
            toast.error(t('pages.games.dice.errors.createGame'));
          }
        } catch (error) {
          console.error('Ошибка при создании игры:', error);
          toast.error(t('pages.games.dice.errors.createGame'));
        }
      }
    } catch (error) {
      console.error('Ошибка при начале игры:', error);
      toast.error(t('pages.games.dice.errors.startGame'));
    }
  };

  const handleGameEnd = async (result: 'win' | 'lose' | 'draw') => {
    if (result !== 'draw') {
      try {
        await processGameResult(GameType.DICE, result, betAmount);
        if (result === 'win') {
          updateUserBalance(betAmount * 2);
        }
      } catch (error: unknown) {
        console.error('Error processing game result:', error);
        window.Telegram?.WebApp?.showPopup({
          title: t('common.error'),
          message: error instanceof Error ? error.message : t('pages.games.dice.errors.resultFailed'),
          buttons: [{ type: 'ok' }]
        });
      }
    }
    setGameState('setup');
  };

  const handleCreateGame = async () => {
    try {
      await createBet(betAmount, GameType.DICE);
      updateUserBalance(-betAmount);
      setGameState('playing');
    } catch (error) {
      console.error('Error creating multiplayer game:', error);
    }
  };

  const handleJoinGame = async (gameId: string) => {
    try {
      const tg = window.Telegram?.WebApp;
      
      if (!tg?.initData) {
        console.error('Telegram WebApp initData недоступен');
        toast.error('Не удалось получить данные Telegram');
        return;
      }
      
      console.log(`Отправка запроса на присоединение к игре: ${gameId}`);
      
      const response = await fetch(`${API_BASE_URL}/games/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId: gameId.startsWith('game_') ? gameId.replace('game_', '') : gameId,
          initData: tg.initData
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Ошибка при присоединении к игре';
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || `Ошибка ${response.status}: ${response.statusText}`;
        } catch (parseError) {
          console.error('Не удалось разобрать ответ с ошибкой:', parseError);
        }
        
        tg?.showPopup({
          title: t('common.error'),
          message: errorMessage,
          buttons: [{ type: 'ok' }]
        });
        
        return;
      }

      const data = await response.json();
      console.log('Успешное присоединение к игре:', data);
      
      if (data.success) {
        setTimeout(() => {
          setActiveGameId(gameId);
          setGameMode('player');
          setGameState('playing');
        }, 0);
      }
    } catch (error) {
      console.error('Ошибка при обработке присоединения к игре:', error);
      
      const tg = window.Telegram?.WebApp;
      tg?.showPopup({
        title: t('common.error'),
        message: error instanceof Error ? error.message : t('game.joinError'),
        buttons: [{ type: 'ok' }]
      });
    }
  };

  // Добавляем useEffect для проверки сохраненного gameId
  useEffect(() => {
    const checkPendingGame = async () => {
      const pendingGameId = localStorage.getItem('pendingGameJoin');
      
      if (pendingGameId) {
        console.log('Found pending game join:', pendingGameId);
        localStorage.removeItem('pendingGameJoin'); // Удаляем сохраненный ID
        
        // Устанавливаем режим игры с игроком
        setGameMode('player');
        setGameState('lobby');
        
        // С небольшой задержкой присоединяемся к игре
        setTimeout(() => {
          handleJoinGame(pendingGameId);
        }, 1000);
      }
    };
    
    checkPendingGame();
  }, []);

  // Добавьте в useEffect для просмотра рендеров
  useEffect(() => {
    console.log('DicePage rendered');
  }, []);

  // Разделяем рендеринг на отдельные компоненты для каждого состояния
  const renderGameContent = () => {
    switch (gameState) {
      case 'setup':
        return (
          <div className="dice-page">
            <div className="game-mode-tabs">
              <button 
                className={`mode-tab ${showLobby ? 'active' : ''}`}
                onClick={() => setShowLobby(true)}
              >
                Активные игры
              </button>
              <button 
                className={`mode-tab ${!showLobby ? 'active' : ''}`}
                onClick={() => setShowLobby(false)}
              >
                Создать игру
              </button>
            </div>
            
            {showLobby ? (
              <LobbyInterface 
                gameType={GameType.DICE}
                onJoin={(gameId: string) => {
                  window.location.href = `/game/${gameId}`;
                }}
                onCreate={() => setShowLobby(false)}
              />
            ) : (
              <GameSetup
                betType={betType}
                setBetType={setBetType}
                gameMode={gameMode}
                setGameMode={setGameMode}
                betAmount={betAmount}
                setBetAmount={setBetAmount}
                onStartGame={handleStartGame}
              />
            )}
          </div>
        );
        
      case 'lobby':
        return <LobbyInterface
          gameType={GameType.DICE}
          onJoin={handleJoinGame}
          onCreate={handleCreateGame}
        />;
        
      case 'playing':
        if (gameMode === 'bot') {
          return <DiceGame 
            betAmount={betAmount} 
            onGameEnd={handleGameEnd} 
          />;
        } else if (activeGameId) {
          return (
            <ErrorBoundary>
              <div className="isolated-game-container">
                <MultiplayerDiceGame 
                  key={`game-${activeGameId}`}
                  gameId={activeGameId} 
                  betAmount={betAmount} 
                  onGameEnd={handleGameEnd} 
                />
              </div>
            </ErrorBoundary>
          );
        } else {
          return (
            <div className="game-error">
              <h3>Ошибка при загрузке игры</h3>
              <button 
                className="back-button"
                onClick={() => setGameState('setup')}
              >
                Вернуться к настройкам
              </button>
            </div>
          );
        }
        
      default:
        return null;
    }
  };

  // Упрощаем основной рендеринг
  return (
    <SafeArea>
      <PageContainer>
        <PageHeader title={t('pages.games.dice.title')} />
        {renderGameContent()}
      </PageContainer>
    </SafeArea>
  );
} 
