'use client';

import React, { useEffect, useState, useRef, useCallback, useContext } from 'react';
import { io, Socket } from 'socket.io-client';
import { Icon } from '@iconify/react';
import { useUserStore } from '@/store/useUserStore';
import { Dice } from '../Dice';
import { toast } from 'react-hot-toast';
import { getUserId, getOrCreateGuestId } from '@/utils/telegramWebApp';
import './style.css';
import { PageContainer } from '@/components/_layout/PageContainer';
import { WaitingRoom } from './WaitingRoom/index';
import { Balance } from '@/components/_common/Balance';
import { 
  MAX_ATTEMPTS, 
  MAX_AUTO_JOIN_ATTEMPTS, 
  MAX_ROUNDS, 
  
} from './gameConfig';
import { API_BASE_URL, API_URL, TELEGRAM_BOT_URL, createTelegramGameLink } from '@/config';

// Удаляем объявление глобального интерфейса, так как оно определено в global.d.ts

interface MultiplayerDiceGameProps {
  gameId: string;
  betAmount: number;
  onGameEnd?: (result: 'win' | 'lose' | 'draw') => void;
}

// Типы для игровых данных
type GameState = 'waiting' | 'playing' | 'finished';
type GameResult = 'win' | 'lose' | 'draw' | null;
type ConnectionStatus = 'connecting' | 'connected' | 'error';

interface PlayerData {
  id: string;
  username?: string;
  avatarUrl?: string;
  score?: number;
}

interface Player {
  telegramId: string;
  username?: string;
  avatarUrl?: string;
}

// Компонент для отображения игрового поля
const GameField = ({ 
  playerDice, 
  opponentDice, 
  isPlayerRolling,
  isOpponentRolling
}: { 
  playerDice: number;
  opponentDice: number;
  isPlayerRolling: boolean;
  isOpponentRolling: boolean;
}) => {
  const { telegramId } = useUserStore();
  const isPlayerTurn = useUserStore(state => state.isCurrentTurn);
  
  // Добавляем отладочные логи для понимания состояния компонента
  console.log('GameField render:', { 
    playerDice, 
    opponentDice, 
    isPlayerRolling,
    isOpponentRolling,
    isPlayerTurn,
    playerRolling: isPlayerRolling,
    opponentRolling: isOpponentRolling
  });
  
  // Логируем завершение анимации через setTimeout
  useEffect(() => {
    if (isPlayerRolling || isOpponentRolling) {
      const timer = setTimeout(() => {
        console.log('Анимация броска завершена через таймер');
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isPlayerRolling, isOpponentRolling]);
  
  return (
    <div className="game-field">
      <div className="player-side-dice">
        <div className={`dice-container ${isPlayerRolling ? 'rolling' : ''}`}>
          <Dice 
            value={playerDice} 
            size="large" 
            rolling={isPlayerRolling}
          />
        </div>
      </div>
      
      <div className="vs-indicator">VS</div>
      
      <div className="opponent-side-dice">
        <div className={`dice-container ${isOpponentRolling ? 'rolling' : ''}`}>
          <Dice 
            value={opponentDice} 
            size="large"
            rolling={isOpponentRolling}
          />
        </div>
      </div>
    </div>
  );
};

// Компонент для отображения результатов
const GameResult = ({ result }: { result: GameResult }) => {
  if (!result) return null;
  
  return (
    <div className={`game-result ${result}`}>
      {result === 'win' && 'Вы выиграли!'}
      {result === 'lose' && 'Вы проиграли!'}
      {result === 'draw' && 'Ничья!'}
    </div>
  );
};

export function MultiplayerDiceGame({ 
  gameId, 
  betAmount, 
  onGameEnd 
}: MultiplayerDiceGameProps) {
  // Отладочный вывод для входящего значения ставки
  console.log('MultiplayerDiceGame received betAmount:', betAmount);
  console.log('MultiplayerDiceGame betAmount type:', typeof betAmount);
  
  // Референсы для автоматических попыток подключения
  const autoJoinAttemptsRef = useRef(0);
  const lastPlayerCheckTimeRef = useRef(0);
  
  // Состояния игры
  const [playerData, setPlayerData] = useState<PlayerData | null>(null);
  const [opponentData, setOpponentData] = useState<PlayerData | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState>('waiting');
  const [isMyTurn, setIsMyTurn] = useState(false);
  // Заменяем общее состояние isRolling на два раздельных
  const [isPlayerRolling, setIsPlayerRolling] = useState(false);
  const [isOpponentRolling, setIsOpponentRolling] = useState(false);
  const [playerDice, setPlayerDice] = useState(1);
  const [opponentDice, setOpponentDice] = useState(1);
  const [currentRound, setCurrentRound] = useState(1);
  const [playerScore, setPlayerScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [socketError, setSocketError] = useState<string | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  
  // Добавляем ref для отслеживания последнего обработанного хода
  const lastProcessedMoveRef = useRef<string | null>(null);
  
  // Инициализируем displayedBetAmount с корректным значением из пропсов
  const [displayedBetAmount, setDisplayedBetAmount] = useState(() => {
    const numericBetAmount = Number(betAmount);
    return !isNaN(numericBetAmount) ? numericBetAmount : 0;
  });
  
  // Обновляем displayedBetAmount при изменении betAmount из пропсов
  useEffect(() => {
    const numericBetAmount = Number(betAmount);
    if (!isNaN(numericBetAmount)) {
      console.log('Updating displayedBetAmount from props:', numericBetAmount);
      setDisplayedBetAmount(numericBetAmount);
    }
  }, [betAmount]);
  
  // Для WebSocket
  const socketRef = useRef<Socket | null>(null);
  const connectionAttemptRef = useRef(0);
  const hasJoinedRoomRef = useRef(false); // Флаг для отслеживания присоединения к комнате
  const mounted = useRef(true); // Флаг для отслеживания состояния монтирования

  // Для Telegram данных
  const [userId, setUserId] = useState<string | null>(null);
  const telegramIdFromStore = useUserStore(state => state.telegramId);
  const [telegramId, setTelegramId] = useState<number | null>(
    telegramIdFromStore ? Number(telegramIdFromStore) : null
  );

  // Получение данных Telegram WebApp
  const getTelegramUserId = useCallback((): number | undefined => {
    try {
      // Сначала проверяем, есть ли у нас уже сохраненный userId
      if (userId) {
        console.log('Используем сохраненный userId:', userId);
        return parseInt(userId);
      }
      
      // Получаем userId из наших утилит
      const id = getUserId();
      if (id && id.startsWith('guest_')) {
        // Если это гостевой ID, не устанавливаем его как userId
        console.log('Получен гостевой ID:', id);
        return undefined;
      } else if (id) {
        // Если это реальный ID, устанавливаем его
        console.log('Получен userId из telegramWebApp:', id);
        setUserId(id);
        return parseInt(id);
      }
      
      // Если есть telegramId из хранилища
      if (telegramId) {
        console.log('Используем telegramId из хранилища:', telegramId);
        setUserId(telegramId.toString());
        return telegramId;
      }
      
      console.log('Не удалось получить userId, пользователь будет анонимным');
      return undefined;
    } catch (error) {
      console.error('Ошибка при получении userId:', error);
      return undefined;
    }
  }, [userId, telegramId]);
  
  // Упрощаем процесс проверки WebApp - он должен быть всегда доступен в Telegram
  useEffect(() => {
    // Получаем userId при монтировании компонента
    const id = getTelegramUserId();
    if (id) {
      setUserId(id.toString());
    }
    
    // Проверяем данные Telegram раз в секунду на случай, если они появятся позже
    const interval = setInterval(() => {
      // Проверяем только если мы ещё не получили userId
      if (!userId) {
        const newId = getTelegramUserId();
        if (newId) {
          console.log('Получен отложенный userId:', newId);
          setUserId(newId.toString());
          
          // Если у нас уже есть соединение, переподключаемся с новым ID
          if (socketRef.current) {
            console.log('Переподключение с новым userId');
            setupSocketConnection();
          }
        }
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [userId]);
  
  /**
   * Настраивает WebSocket соединение
   * Адаптировано для работы с исправленным API-путем в Nginx
   */
  const setupSocketConnection = useCallback((userIdParam?: string) => {
    console.log('Настройка соединения с сокетом, userId:', userIdParam || userId);
    
    // Проверяем, есть ли уже активное соединение
    if (socketRef.current && socketRef.current.connected) {
      console.log('Соединение уже активно, отключаем старые обработчики');
      
      // Отключаем все существующие обработчики чтобы избежать дублирования
      socketRef.current.off('connect');
      socketRef.current.off('connect_error');
      socketRef.current.off('error');
      socketRef.current.off('disconnect');
      socketRef.current.off('diceGameStarted');
      socketRef.current.off('diceMove');
      socketRef.current.off('roundResult');
      socketRef.current.off('gameResult');
      socketRef.current.off('playerJoined');
      socketRef.current.off('playerLeft');
      socketRef.current.off('updatePlayers');
      socketRef.current.off('gameInfo');
      socketRef.current.off('error');
      
      // Отключаем общий обработчик всех событий
      socketRef.current.offAny();
      
      // Закрываем соединение
      socketRef.current.disconnect();
      console.log('Старое соединение закрыто');
    }
    
    // Проверяем, есть ли уже активное соединение
    if (socketRef.current && socketRef.current.connected && hasJoinedRoomRef.current) {
      console.log('Соединение уже установлено, пропускаем повторное подключение');
      return;
    }
    
    const effectiveUserId = userIdParam || userId;
    if (!effectiveUserId) {
      console.error('userId не определен, невозможно установить соединение');
      setConnectionStatus('error');
      setSocketError('Ошибка: ID пользователя не определен');
      return;
    }
    
    // Преобразуем userId в число, т.к. сервер ожидает telegramId как number
    const numericTelegramId = parseInt(effectiveUserId, 10);
    
    if (isNaN(numericTelegramId)) {
      console.error('Невозможно преобразовать userId в число:', effectiveUserId);
      setConnectionStatus('error');
      setSocketError('Ошибка: неверный формат ID пользователя');
      return;
    }
    
    // Убедимся, что у нас установлен telegramId для последующего использования
    if (!telegramId) {
      console.log('Устанавливаем telegramId из userId перед подключением сокета:', numericTelegramId);
      setTelegramId(numericTelegramId);
      // Также сохраним в хранилище
      useUserStore.getState().updateUser({
        telegramId: numericTelegramId,
        username: 'Player', // Временное имя пользователя
        avatarUrl: undefined,
        balance: 0,
        isActive: true
      });
    } else if (telegramId !== numericTelegramId) {
      console.warn('Текущий telegramId отличается от ID для сокета:', { telegramId, numericTelegramId });
      console.log('Обновляем telegramId для соответствия:', numericTelegramId);
      setTelegramId(numericTelegramId);
      // Также сохраним в хранилище
      useUserStore.getState().updateUser({
        telegramId: numericTelegramId,
        username: 'Player', // Временное имя пользователя
        avatarUrl: undefined,
        balance: 0,
        isActive: true
      });
    }
    
    console.log('Используется telegramId для подключения:', numericTelegramId);
    
    // Конфигурация сокета
    const socketOptions = {
      // параметры для самого io подключения
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      // Параметры для запроса
      query: { 
        telegramId: numericTelegramId || '', // Передаем пустую строку вместо undefined
        userId: numericTelegramId || '',     // Дублируем для совместимости
        gameId,
        timestamp: Date.now()
      },
      auth: {
        token: `${numericTelegramId}_${gameId}`
      },
      extraHeaders: {
        'X-User-Id': String(numericTelegramId), // Заголовки должны быть строками
        'X-Telegram-Id': String(numericTelegramId),
        'X-Game-Id': gameId
      }
    };
    
    console.log('Параметры подключения:', socketOptions);
    
    try {
      // Если сокет уже существует, закрываем его
      if (socketRef.current) {
        console.log('Закрываем существующее соединение');
        socketRef.current.disconnect();
      }
    
      console.log('Создание нового соединения с параметрами:', socketOptions);
      const newSocket = io(API_URL, socketOptions);
      
      socketRef.current = newSocket;
      connectionAttemptRef.current = 0;
      
      // Добавляем детальную отладку подключения
      newSocket.on('connect', () => {
        console.log('Socket connected successfully! Socket id:', newSocket.id);
        console.log('Socket query params:', newSocket.io.opts.query);
        console.log('Socket auth:', newSocket.auth);

        // Отправляем расширенную информацию о пользователе при подключении
        newSocket.emit('userInfo', { 
          userId: numericTelegramId, 
          telegramId: numericTelegramId,
          gameId,
          username: window.Telegram?.WebApp?.initDataUnsafe?.user?.username || 'unknown'
        });
        
        setConnectionStatus('connected');
        setSocketError(null);
        
        // После успешного подключения отправляем запрос на присоединение к комнате только если еще не присоединились
        if (!hasJoinedRoomRef.current) {
          console.log('Socket connected, joining game room:', gameId);
          newSocket.emit('joinGameRoom', { 
            gameId,
            telegramId: numericTelegramId, // Явно передаем telegramId
            username: window.Telegram?.WebApp?.initDataUnsafe?.user?.username || 'unknown'
          });
          
          // Запрашиваем информацию об игре только при первом подключении
          setTimeout(() => {
            if (newSocket.connected) {
              console.log('Запрашиваем начальное состояние игры');
              newSocket.emit('getGameStatus', { gameId });
              newSocket.emit('getGamePlayers', { gameId });
              hasJoinedRoomRef.current = true; // Устанавливаем флаг присоединения
            }
          }, 500);
        }
      });

      newSocket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        setConnectionStatus('error');
        setSocketError(`Ошибка подключения: ${error.message}`);
        toast.error('Ошибка подключения к серверу');
        connectionAttemptRef.current += 1;
        
        // Добавляем автоматическое переподключение при ошибке
        // Используем MAX_ATTEMPTS вместо захардкоженного значения 5
        if (connectionAttemptRef.current < MAX_ATTEMPTS) {
          const retryDelay = 3000 + (connectionAttemptRef.current * 1000); // Увеличиваем задержку с каждой попыткой
          console.log(`Попытка переподключения #${connectionAttemptRef.current} через ${retryDelay/1000} сек...`);
          
          setTimeout(() => {
            if (mounted.current && !socketRef.current?.connected) {
              console.log('Выполняется автоматическое переподключение...');
              setupSocketConnection();
            }
          }, retryDelay);
        }
      });

      // Добавляем обработчик ошибок данных
      newSocket.on('error', (error) => {
        console.error('Ошибка сокета:', error);
        setSocketError(`Ошибка сокета: ${error.message || 'Неизвестная ошибка'}`);
      });
      
      // Обработчик отключения
      newSocket.on('disconnect', (reason) => {
        console.warn('Соединение с сервером разорвано. Причина:', reason);
        
        if (reason === 'io server disconnect') {
          // Сервер разорвал соединение, нужно переподключиться
          console.log('Сервер разорвал соединение, пробуем переподключиться...');
          setTimeout(() => {
            if (mounted.current) {
              newSocket.connect();
            }
          }, 2000);
        } else {
          // Соединение разорвано по другой причине
          setConnectionStatus('error');
          setSocketError(`Соединение разорвано: ${reason}`);
          toast.error('Соединение с сервером потеряно');
          
          // Автоматическое переподключение при потере связи
          if (connectionAttemptRef.current < 5) {
            setTimeout(() => {
              if (mounted.current && !socketRef.current?.connected) {
                console.log('Попытка восстановления соединения...');
                setupSocketConnection();
              }
            }, 3000);
          }
        }
      });

      // Добавляем обработчик для получения всех событий (отладка)
      newSocket.onAny((event, ...args) => {
        console.log(`Получено событие '${event}':`, args);
      });

      // Обработчик обновления состояния игры
      newSocket.on('gameStatus', (data) => {
        console.log('Получено состояние игры:', data);
        if (data.game && data.game.betAmount !== undefined) {
          const serverBetAmount = Number(data.game.betAmount);
          // Проверяем, нужно ли обновлять значение ставки
          if (!isNaN(serverBetAmount) && serverBetAmount > 0 && displayedBetAmount === 0) {
            setDisplayedBetAmount(serverBetAmount);
          }
        }
        
        // Проверяем состояние игры и устанавливаем текущий ход
        if (data.status === 'playing' && data.currentPlayer) {
          const currentTelegramId = telegramId || getTelegramUserId();
          if (currentTelegramId) {
            const telegramIdStr = currentTelegramId.toString();
            const isCurrentPlayerTurn = data.currentPlayer.toString() === telegramIdStr;
            
            console.log('Обновление статуса хода из gameStatus:', {
              currentPlayer: data.currentPlayer,
              myTelegramId: telegramIdStr,
              isMyTurn: isCurrentPlayerTurn
            });
            
            // Устанавливаем статус хода
            setIsMyTurn(isCurrentPlayerTurn);
            useUserStore.getState().setIsCurrentTurn(isCurrentPlayerTurn);
            
            // Устанавливаем состояние игры
            setGameState('playing');
          }
        }
      });

      // Добавляем обработчик для приема списка игроков
      newSocket.on('gamePlayers', (data) => {
        console.log('Получен список игроков от сервера:', data);
        if (data && Array.isArray(data.players)) {
          // Сохраняем предыдущий список игроков
          const prevPlayersLength = players.length;
          
          setPlayers(data.players);
          
          // Сбрасываем счетчик попыток, если список игроков изменился и увеличился
          if (data.players.length > prevPlayersLength) {
            console.log('Список игроков обновлен, сбрасываем счетчик автоматических попыток подключения');
            autoJoinAttemptsRef.current = 0;
          }
          
          // Получим строковое представление telegramId для сравнения, защищенное от null
          const currentTelegramId = telegramId || getTelegramUserId();
          const telegramIdStr = currentTelegramId?.toString() || '';
          
          console.log('Идентификация игроков. Текущий пользователь TelegramID:', telegramIdStr);
          console.log('Список игроков в игре:', data.players.map((p: Player) => ({ 
            telegramId: p.telegramId, 
            username: p.username 
          })));
          
          // Определяем, кто из игроков - текущий пользователь
          const currentPlayer = data.players.find(
            (player: Player) => player.telegramId?.toString() === telegramIdStr
          );
          
          if (currentPlayer) {
            console.log('Найден текущий игрок:', currentPlayer);
            setPlayerData({
              id: currentPlayer.telegramId,
              username: currentPlayer.username,
              avatarUrl: currentPlayer.avatarUrl
            });
            
            // Обновляем время последней проверки
            lastPlayerCheckTimeRef.current = Date.now();
          } else {
            console.warn('Текущий игрок не найден в списке игроков. TelegramID:', telegramIdStr);
          }
          
          // Определяем, кто из игроков - оппонент
          const opponent = data.players.find(
            (player: Player) => player.telegramId?.toString() !== telegramIdStr
          );
          
          if (opponent) {
            console.log('Найден оппонент:', opponent);
            setOpponentData({
              id: opponent.telegramId,
              username: opponent.username,
              avatarUrl: opponent.avatarUrl
            });
          } else {
            console.log('Оппонент еще не подключился к игре');
          }
          
          // Проверяем количество игроков для отладки
          if (data.players.length < 2) {
            console.log('Недостаточно игроков для начала игры:', data.players.length);
          } else {
            console.log('Достаточно игроков для начала игры:', data.players.length);
          }
        }
      });
      
      // Обработчик для начала игры в кости
      newSocket.on('diceGameStarted', (data) => {
        if (!mounted.current) return;
        
        try {
          console.log('Игра в кости началась:', data);
          console.log('Текущее состояние isMyTurn до обновления:', isMyTurn);
          console.log('Состояние в хранилище isCurrentTurn до обновления:', useUserStore.getState().isCurrentTurn);
          
          // Обязательно указываем игре, что она началась и переходим в состояние playing
          setGameState('playing');
          
          // Проверим, что telegramId установлен перед проверкой хода
          if (!telegramId) {
            // Дополнительная попытка получить ID
            const currentTelegramId = getTelegramUserId();
            if (currentTelegramId) {
              console.log('Обновляем telegramId непосредственно перед проверкой хода:', currentTelegramId);
              setTelegramId(currentTelegramId);
              
              // Получим строковое представление telegramId для сравнения
              const telegramIdStr = currentTelegramId.toString();
              
              // Определяем, чей первый ход
              const isFirstPlayer = data.firstPlayer.toString() === telegramIdStr;
              console.log('Первый ход определен с обновленным ID:', { 
                firstPlayer: data.firstPlayer, 
                myId: currentTelegramId, 
                isMyTurn: isFirstPlayer,
                telegramIdType: typeof currentTelegramId,
                telegramIdStr
              });
              
              // Явно устанавливаем ход в компоненте и хранилище
              setIsMyTurn(isFirstPlayer);
              useUserStore.getState().setIsCurrentTurn(isFirstPlayer);
              console.log('Установлен isMyTurn:', isFirstPlayer); // Добавленный лог
              console.log('Установлен isCurrentTurn в store:', isFirstPlayer); // Добавленный лог
              
              if (isFirstPlayer) {
                toast.success('Ваш ход первый!');
              } else {
                toast('Ожидайте хода соперника', { icon: '⌛' });
              }
            } else {
              console.error('Невозможно определить telegramId даже после дополнительной попытки');
              toast.error('Не удалось определить ваш идентификатор. Перезагрузите страницу.');
            }
          } else {
            // Получим строковое представление telegramId для сравнения, защищенное от null
            const telegramIdStr = telegramId.toString();
            
            // Определяем, чей первый ход
            const isFirstPlayer = data.firstPlayer.toString() === telegramIdStr;
            console.log('Первый ход определен:', { 
              firstPlayer: data.firstPlayer, 
              myId: telegramId, 
              isMyTurn: isFirstPlayer,
              telegramIdType: typeof telegramId,
              telegramIdStr
            });
            
            // Явно устанавливаем ход в компоненте и хранилище
            setIsMyTurn(isFirstPlayer);
            useUserStore.getState().setIsCurrentTurn(isFirstPlayer);
            console.log('Установлен isMyTurn:', isFirstPlayer); // Добавленный лог
            console.log('Установлен isCurrentTurn в store:', isFirstPlayer); // Добавленный лог
            
            if (isFirstPlayer) {
              toast.success('Ваш ход первый!');
            } else {
              toast('Ожидайте хода соперника', { icon: '⌛' });
            }
          }
          
          // Сбрасываем счет и кубики
          setPlayerScore(0);
          setOpponentScore(0);
          setPlayerDice(1);
          setOpponentDice(1);
          setCurrentRound(1);
          setGameResult(null);
          setGameStarted(true);
          
          // Принудительно проверяем после небольшой задержки, что статус хода корректно установлен
          setTimeout(() => {
            console.log('Статус хода через 100мс после начала игры:');
            console.log('isMyTurn:', isMyTurn);
            console.log('isCurrentTurn в хранилище:', useUserStore.getState().isCurrentTurn);
            
            // Если обнаружено несоответствие, принудительно коррекируем
            const currentTelegramId = telegramId || getTelegramUserId();
            if (currentTelegramId) {
              const telegramIdStr = currentTelegramId.toString();
              const shouldBeMyTurn = data.firstPlayer.toString() === telegramIdStr;
              
              if (isMyTurn !== shouldBeMyTurn) {
                console.warn('Обнаружено несоответствие статуса хода, исправляем:', { 
                  текущийСтатус: isMyTurn, 
                  долженБыть: shouldBeMyTurn 
                });
                setIsMyTurn(shouldBeMyTurn);
                useUserStore.getState().setIsCurrentTurn(shouldBeMyTurn);
              }
            }
          }, 100);
          
          toast.success('Игра началась!');
        } catch (error) {
          console.error('Ошибка при обработке события diceGameStarted:', error);
          toast.error('Не удалось начать игру');
        }
      });

      // Добавляем обработчик хода в игре
      newSocket.on('diceMove', (data) => {
        console.log('Получен ход в игре:', data);
        
        // Проверяем полноту полученных данных
        if (!data) {
          console.error('Получены пустые данные о ходе');
          return;
        }
        
        // Создаем уникальный идентификатор текущего хода на основе реальных данных
        // Это поможет избежать дублирования обработки одного и того же события
        const moveId = `${data.telegramId}_${data.value}_${data.timestamp || Date.now()}`;
        
        // Проверяем, не был ли уже обработан этот ход в текущей сессии
        if (lastProcessedMoveRef.current === moveId) {
          console.log('Этот ход уже был обработан, пропускаем:', moveId);
          return;
        }
        
        // Записываем текущий ход как обработанный
        lastProcessedMoveRef.current = moveId;
        
        // Получим строковое представление telegramId для сравнения, защищенное от null
        const currentTelegramId = telegramId || getTelegramUserId();
        const telegramIdStr = currentTelegramId?.toString() || '';
        
        // Для отладки проверяем и логируем все необходимые данные
        console.log('Анализ хода:', { 
          moverTelegramId: data.telegramId,
          myTelegramId: telegramIdStr,
          nextMove: data.nextMove,
          diceValue: data.value,
          moveId
        });
        
        // Проверяем, кто сделал ход: мы или оппонент
        const isMoveByCurrentPlayer = data.telegramId && data.telegramId.toString() === telegramIdStr;
        const isMoveByOpponent = data.telegramId && data.telegramId.toString() !== telegramIdStr;
        
        // Если ход сделал оппонент, обновляем его кубик и запускаем анимацию
        if (isMoveByOpponent) {
          console.log('Ход сделал оппонент, анимируем его бросок');
          // Запускаем анимацию броска оппонента
          setIsOpponentRolling(true);
          setIsMyTurn(false); // Убеждаемся, что статус текущего хода = false
          useUserStore.getState().setIsCurrentTurn(false);
          
          // Через секунду завершаем анимацию и устанавливаем результат
          setTimeout(() => {
            setOpponentDice(data.value);
            setIsOpponentRolling(false);
            console.log('Анимация броска оппонента завершена, результат:', data.value);
          }, 1000);
        }
        
        // Если наш ход уже отправлен, но ещё не обработан сервером,
        // просто обновляем значение локального кубика
        if (isMoveByCurrentPlayer) {
          console.log('Получено подтверждение нашего хода от сервера');
          setPlayerDice(data.value);
        }
        
        // Определяем, чей следующий ход
        if (data.nextMove && telegramIdStr) {
          const myNextTurn = data.nextMove.toString() === telegramIdStr;
          console.log('Определение следующего хода:', { 
            nextMove: data.nextMove, 
            myId: currentTelegramId,
            isMyTurn: myNextTurn,
            сравнение: `${data.nextMove.toString()} === ${telegramIdStr}`
          });
          
          // Явно обновляем статус хода как в компоненте, так и в хранилище
          setIsMyTurn(myNextTurn);
          useUserStore.getState().setIsCurrentTurn(myNextTurn);
          console.log(`Обновлен статус хода: isMyTurn = ${myNextTurn}, isCurrentTurn в хранилище = ${myNextTurn}`);
          
          // Создаем ключ для отслеживания последнего уведомления для каждого хода
          // Это поможет избежать дублирования уведомлений при получении дублирующихся событий
          const notificationKey = `notification_${data.telegramId}_${data.value}_${currentRound || 1}`;
          
          // Проверяем, было ли уже показано уведомление для этого хода
          const hasNotified = sessionStorage.getItem(notificationKey);
          
          if (!hasNotified) {
            // Помечаем, что уведомление было показано
            sessionStorage.setItem(notificationKey, 'true');
            
            // Добавляем уведомления о смене хода с временной задержкой для анимации
            setTimeout(() => {
              if (myNextTurn) {
                toast.success('Ваш ход!', { duration: 3000 });
              } else {
                toast('Ход соперника', {
                  icon: '🎲',
                  duration: 3000
                });
              }
            }, 1200); // Задержка больше чем длительность анимации (1000мс)
          } else {
            console.log('Пропускаем дублирующее уведомление о ходе:', notificationKey);
          }
        } else {
          console.warn('В данных хода отсутствует информация о следующем игроке или нет текущего telegramId:', {
            nextMove: data.nextMove,
            telegramId
          });
          
          // Если данных о следующем ходе нет, но мы можем определить, что текущий ход не наш
          if (isMoveByOpponent) {
            // Предполагаем, что после хода оппонента следующий ход должен быть наш
            console.log('Предполагаем, что после хода оппонента следующий ход наш');
            setTimeout(() => {
              setIsMyTurn(true);
              useUserStore.getState().setIsCurrentTurn(true);
              toast.success('Ваш ход!', { duration: 3000 });
            }, 1200);
          }
        }
      });

      // Обработчик для результата раунда
      newSocket.on('roundResult', (data: any) => {
        console.log('Получен результат раунда:', data);
        
        // Получаем ID текущего пользователя
        const currentUserId = telegramId || getTelegramUserId();
        
        if (!currentUserId) {
          console.error('Не удалось определить ID текущего пользователя');
          return;
        }
        
        // Определяем, кто есть кто в данном раунде
        // players[0] - это первый игрок в массиве игроков на сервере
        // players[1] - это второй игрок в массиве игроков на сервере
        const isCurrentUserPlayer1 = String(data.players[0]) === String(currentUserId);
        const isCurrentUserPlayer2 = String(data.players[1]) === String(currentUserId);
        
        console.log('Анализ результата раунда:', {
          currentUserId,
          players: data.players,
          isCurrentUserPlayer1,
          isCurrentUserPlayer2,
          result: data.result,
          player1Value: data.player1Value,
          player2Value: data.player2Value
        });
        
        // Определяем, выиграл ли текущий пользователь раунд
        let currentUserWon = false;
        
        if (isCurrentUserPlayer1 && data.result === 'win') {
          currentUserWon = true;
        } else if (isCurrentUserPlayer2 && data.result === 'lose') {
          currentUserWon = true;
        } else if (data.result === 'draw') {
          // Ничья - никто не получает очко
          currentUserWon = false;
        } else {
          // Текущий пользователь проиграл
          currentUserWon = false;
        }
        
        console.log('Результат для текущего пользователя:', currentUserWon ? 'победа' : 'поражение');
        
        // Обновляем счет
        if (currentUserWon) {
          setPlayerScore(prevScore => prevScore + 1);
        } else if (data.result !== 'draw') {
          setOpponentScore(prevScore => prevScore + 1);
        }
        
        // Обновляем номер текущего раунда
        setCurrentRound(data.round + 1);
      });

      // Добавляем обработчик для окончания игры
      newSocket.on('gameEnd', (data) => {
        console.log('Игра завершена:', data);
        
        // Получим строковое представление telegramId для сравнения, защищенное от null
        const currentTelegramId = telegramId || getTelegramUserId();
        const telegramIdStr = currentTelegramId?.toString() || '';
        const userBalance = useUserStore.getState().balance;
        
        console.log('Завершение игры для игрока:', { 
          telegramId: telegramIdStr, 
          winner: data.winner,
          score: data.score,
          rounds: data.rounds,
          currentBalance: userBalance
        });
        
        // Определяем результат для текущего игрока
        const isWinner = data.winner?.toString() === telegramIdStr;
        const result = isWinner ? 'win' : 'lose';
        
        // Устанавливаем результат игры
        setGameResult(result);
        setGameState('finished');
        
        // Показываем уведомление о результате игры
        if (isWinner) {
          const winAmount = displayedBetAmount * 2;
          toast.success(`Вы выиграли ${winAmount} токенов!`, { 
            duration: 5000,
            icon: '🏆'
          });
        } else {
          toast(`Вы проиграли ${displayedBetAmount} токенов`, { 
            duration: 5000,
            icon: '😔'
          });
        }
        
        // Обновляем баланс пользователя в хранилище
        setTimeout(() => {
          // Запрашиваем актуальный баланс с сервера
          fetch('/api/users/balance')
            .then(res => res.json())
            .then(data => {
              if (data.success && typeof data.balance === 'number') {
                // Используем метод updateBalance для обновления баланса
                const currentBalance = useUserStore.getState().balance;
                const balanceDiff = data.balance - currentBalance;
                useUserStore.getState().updateBalance(balanceDiff);
                console.log('Баланс пользователя обновлен:', data.balance);
              }
            })
            .catch(err => {
              console.error('Ошибка при обновлении баланса:', err);
            });
        }, 1000);
        
        // Вызываем колбэк окончания игры, если он предоставлен
        if (onGameEnd) {
          onGameEnd(result);
        }
      });

      // Добавляем обработчик статуса подключения
      newSocket.on('connectionStatus', (data) => {
        console.log('Получено обновление статуса подключения:', data);
        
        // Обновляем статус подключения
        if (data.connectedClients > 0) {
          setConnectionStatus('connected');
        } else {
          setConnectionStatus('error');
        }
        
        // Если игроков меньше 2, показываем сообщение
        if (data.connectedClients < 2 && gameState === 'playing') {
          toast.error('Соперник отключился от игры');
        } else if (data.connectedClients === 2 && gameState === 'waiting') {
          // Проверяем, что игра еще не запущена и оба игрока подключены
          console.log('Оба игрока подключены, запрашиваем статус игры');
          newSocket.emit('getGameStatus', { gameId });
          newSocket.emit('getGamePlayers', { gameId });
          
          // Запоминаем время последнего обновления состояния игроков
          const lastUpdateTime = Date.now();
          
          // Пробуем запустить игру, если она еще не началась
          if (!gameStarted) {
            console.log('Пробуем запустить игру');
            newSocket.emit('startDiceGame', { gameId });
            
            // Если есть подключение, но игрок не в списке играющих, пробуем явно присоединиться
            // Делаем это только если прошло достаточно времени с последней проверки
            if (Date.now() - lastPlayerCheckTimeRef.current > 3000) {
              lastPlayerCheckTimeRef.current = Date.now();
              
              setTimeout(() => {
                if (autoJoinAttemptsRef.current >= MAX_AUTO_JOIN_ATTEMPTS) {
                  console.log(`Достигнуто максимальное количество попыток автоматического подключения (${MAX_AUTO_JOIN_ATTEMPTS})`);
                  return;
                }
                
                if (players.length < 2 && socketRef.current && !isJoining) {
                  console.log('Обнаружено 2 подключенных клиента, но только', players.length, 'игроков в списке');
                  console.log(`Попытка автоматического подключения #${autoJoinAttemptsRef.current + 1} из ${MAX_AUTO_JOIN_ATTEMPTS}`);
                  
                  // Проверяем, присутствует ли текущий игрок в списке
                  const currentTelegramId = telegramId || getTelegramUserId();
                  const telegramIdStr = currentTelegramId?.toString() || '';
                  
                  const isPlayerInGame = players.some(player => 
                    player.telegramId?.toString() === telegramIdStr
                  );
                  
                  if (!isPlayerInGame) {
                    console.log('Текущий игрок не в списке, пробуем присоединиться к игре...');
                    autoJoinAttemptsRef.current += 1;
                    handleJoinGame();
                  } else {
                    console.log('Текущий игрок уже в списке игроков');
                  }
                }
              }, 2000);
            }
          }
        }
      });

      // Сохраняем сокет
      socketRef.current = newSocket;
      setConnectionStatus('connecting');
    } catch (error) {
      console.error('Error setting up socket connection:', error);
      setConnectionStatus('error');
      setSocketError(`Ошибка при настройке соединения: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
      toast.error('Не удалось установить соединение с сервером');
    }
  }, [gameId, userId]);

  // Обновляем данные, когда меняется playerData
  useEffect(() => {
    if (playerData && socketRef.current && gameState === 'waiting' && players.length === 2) {
      console.log('Player data updated, checking if we can start the game');
      // Если оба игрока присоединились, инициируем старт игры
      socketRef.current.emit('startDiceGame', { gameId });
    }
  }, [playerData, players.length, gameId, gameState]);

  // Функция для броска кубика
  const rollDice = () => {
    console.log('Нажата кнопка "Бросить кубик", текущее состояние:', {
      isRolling: isPlayerRolling,
      isMyTurn: isMyTurn,
      gameState: gameState,
      currentRound: currentRound,
      telegramId: telegramId,
      isPlayerTurn: useUserStore.getState().isCurrentTurn
    });
    
    // Проверяем, что сейчас наш ход и анимация не запущена
    if (isPlayerRolling) {
      console.log('Анимация броска уже запущена, ожидаем её завершения');
      return;
    }

    if (!isMyTurn) {
      console.log('Сейчас не ваш ход, кнопка должна быть неактивна');
      toast.error('Сейчас не ваш ход');
      return;
    }
    
    // Дополнительная проверка telegramId перед отправкой хода
    const currentTelegramId = telegramId || getTelegramUserId();
    if (!currentTelegramId) {
      console.error('Отсутствует telegramId пользователя, невозможно сделать ход');
      toast.error('Ошибка: не удалось определить идентификатор пользователя');
      return;
    }
    
    console.log('Начинаем бросок кубика, наш ход:', isMyTurn);
    
    // Начинаем анимацию для кубика игрока
    setIsPlayerRolling(true);
    console.log('Multiplayer roll initiated, анимируем только кубик игрока (наш)');
    
    // Генерируем случайное значение от 1 до 6
    const diceValue = Math.floor(Math.random() * 6) + 1;
    
    // Отправляем событие на сервер сразу, не дожидаясь окончания анимации
    if (socketRef.current) {
      const userTelegramId = Number(currentTelegramId);
      console.log('Отправляем ход с значением:', diceValue, 'от игрока с telegramId:', userTelegramId);
      
      // Дополнительно проверяем, что telegramId не null и не NaN после преобразования
      if (isNaN(userTelegramId)) {
        console.error('Ошибка: telegramId не является числом:', currentTelegramId);
        toast.error('Ошибка при отправке хода');
        setIsPlayerRolling(false);
        return;
      }
      
      socketRef.current.emit('diceMove', {
        gameId: gameId,
        value: diceValue,
        telegramId: userTelegramId // Явно преобразуем в число, чтобы избежать проблем с типами
      });
      
      // Обновляем значение кубика игрока на клиенте с небольшой задержкой для анимации
      setTimeout(() => {
        setPlayerDice(diceValue);
        console.log('Установлено значение кубика игрока:', diceValue);
      }, 500); // Обновляем значение на полпути анимации
      
      // Сразу же блокируем кнопку броска, передавая ход другому игроку
      // Статус хода будет обновлен сервером через событие diceMove
      setIsMyTurn(false);
      useUserStore.getState().setIsCurrentTurn(false);
      console.log('Временно блокируем кнопку броска до получения ответа от сервера');
    } else {
      console.error('Ошибка: отсутствует соединение с сервером');
      toast.error('Ошибка: нет соединения с сервером');
      setIsPlayerRolling(false);
    }
    
    // Анимация броска длится 1 секунду
    setTimeout(() => {
      setIsPlayerRolling(false);
      console.log('Multiplayer roll completed');
    }, 1000);
  };

  // Функция для присоединения к игре вручную
  const handleJoinGame = useCallback(() => {
    if (isJoining) return; // Предотвращаем повторные попытки
    
    // Получаем текущее значение telegramId
    const currentTelegramId = telegramId || getTelegramUserId();
    const username = window.Telegram?.WebApp?.initDataUnsafe?.user?.username || 'unknown';
    
    // Проверяем, не находится ли игрок уже в списке игроков
    const telegramIdStr = currentTelegramId?.toString() || '';
    const isAlreadyInGame = players.some(player => 
      player.telegramId?.toString() === telegramIdStr
    );
    
    if (isAlreadyInGame) {
      console.log('Игрок уже присоединен к игре, запрашиваем обновленные данные');
      toast.success('Вы уже присоединены к игре');
      
      // Просто запрашиваем обновленные данные
      if (socketRef.current) {
        socketRef.current.emit('getGamePlayers', { gameId });
        socketRef.current.emit('getGameStatus', { gameId });
      }
      return;
    }
    
    console.log('Попытка подключения к игре:', gameId, 'с TelegramID:', currentTelegramId, 'и именем:', username);
    setIsJoining(true);
    
    try {
      if (socketRef.current) {
        // Отправляем полные данные для авторизации
        socketRef.current.emit('joinGameRoom', { 
          gameId,
          telegramId: currentTelegramId,
          username: username
        }, (response: any) => {
          setIsJoining(false);
          if (response.success) {
            console.log('Успешное подключение к игре');
            toast.success('Успешное подключение к игре');
            
            // Запрашиваем обновленные данные игры после успешного подключения
            setTimeout(() => {
              if (socketRef.current?.connected) {
                socketRef.current.emit('getGamePlayers', { gameId });
                socketRef.current.emit('getGameStatus', { gameId });
              }
            }, 500);
          } else {
            console.error('Ошибка при подключении к игре:', response.error);
            toast.error(`Ошибка при подключении к игре: ${response.error || 'Неизвестная ошибка'}`);
            
            // Сбрасываем счетчик автоматических попыток, если была ошибка при ручном подключении
            if (autoJoinAttemptsRef.current > 0) {
              autoJoinAttemptsRef.current = MAX_AUTO_JOIN_ATTEMPTS; // Блокируем дальнейшие автоматические попытки
              console.log('Сброшен счетчик автоматических попыток после ошибки ручного подключения');
            }
          }
        });
      } else {
        setIsJoining(false);
        toast.error('Ошибка подключения: сокет не инициализирован');
        
        // Попробуем переинициализировать сокет
        console.log('Попытка переподключения сокета...');
        setupSocketConnection();
      }
    } catch (error) {
      console.error('Неожиданная ошибка при подключении к игре:', error);
      setIsJoining(false);
      toast.error('Произошла неожиданная ошибка при подключении');
    }
  }, [gameId, isJoining, telegramId, setupSocketConnection, players]);

  // Функция для копирования пригласительной ссылки
  const copyInviteLink = () => {
    const inviteLink = createTelegramGameLink(gameId);
    console.log('Copying invite link:', inviteLink);
    
    if (navigator.clipboard) {
      navigator.clipboard.writeText(inviteLink)
        .then(() => {
          toast.success('Ссылка скопирована!');
        })
        .catch(err => {
          console.error('Ошибка при копировании:', err);
          toast.error('Не удалось скопировать ссылку');
        });
    } else {
      // Fallback для старых браузеров
      const textArea = document.createElement('textarea');
      textArea.value = inviteLink;
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      try {
        document.execCommand('copy');
        toast.success('Ссылка скопирована!');
      } catch (err) {
        console.error('Ошибка при копировании:', err);
        toast.error('Не удалось скопировать ссылку');
      }
      
      document.body.removeChild(textArea);
    }
  };

  // Функция для перехода к игре по приглашению через Telegram
  const handleManualJoin = () => {
    // Формируем полную ссылку на приложение
    const fullGameId = `game_${gameId}`;
    
    // Получаем текущий telegramId, если доступен
    const userId = telegramId || getTelegramUserId();
    
    // Логируем действие для отладки
    console.log(`Создаем ссылку для подключения к игре:`, {
      gameId,
      fullGameId,
      userId
    });
    
    // Формируем URL с дополнительным параметром для идентификации пользователя
    const url = `${TELEGRAM_BOT_URL}?startapp=${fullGameId}`;
    
    console.log(`Открываем URL для входа в игру: ${url}`);
    
    // Проверяем, доступен ли Telegram WebApp API
    if (window.Telegram?.WebApp) {
      try {
        // Проверяем наличие метода openTelegramLink
        if (typeof window.Telegram.WebApp.openTelegramLink === 'function') {
          console.log('Используем Telegram.WebApp.openTelegramLink для открытия ссылки');
          // Для t.me ссылок используем openTelegramLink
          window.Telegram.WebApp.openTelegramLink(url);
        } 
        // Проверяем наличие метода openLink
        else if (typeof window.Telegram.WebApp.openLink === 'function') {
          console.log('Используем Telegram.WebApp.openLink для открытия ссылки');
          window.Telegram.WebApp.openLink(url);
        } 
        // Резервный вариант - обычное перенаправление
        else {
          console.log('Методы Telegram WebApp для открытия ссылок недоступны, используем обычное перенаправление');
          window.location.href = url;
        }
      } catch (error) {
        console.error('Ошибка при использовании Telegram WebApp API:', error);
        // В случае ошибки делаем обычное перенаправление
        window.location.href = url;
      }
    } else {
      console.log('Telegram WebApp API недоступен, используем обычное перенаправление');
      window.location.href = url;
    }
    
    // Показываем уведомление пользователю
    toast.success('Переходим в Telegram для присоединения к игре');
  };

  // Эффект для инициализации компонента
  useEffect(() => {
    console.log('MultiplayerDiceGame component mounted with gameId:', gameId);
    
    // Устанавливаем флаг монтирования
    mounted.current = true;
    
    // Обязательно загружаем данные пользователя для корректного отображения баланса
    useUserStore.getState().fetchUserData();
    
    // Пытаемся получить ID пользователя из Telegram WebApp
    const currentUserId = getTelegramUserId();
    if (currentUserId) {
      console.log('userId сразу получен из WebApp:', currentUserId);
      // Важно: устанавливаем состояние и передаём userId напрямую в функцию подключения
      setUserId(currentUserId.toString());
      setTelegramId(currentUserId);
      
      // Получаем данные пользователя
      fetch(`${API_BASE_URL}/users/${currentUserId}`)
        .then(response => response.json())
        .then(userData => {
          if (userData) {
            console.log('Получены данные пользователя:', userData);
            
            // Более надежный способ обновления данных в хранилище
            if (userData.balance !== undefined) {
              console.log('Обновляем баланс пользователя:', userData.balance);
              useUserStore.setState(state => ({
                ...state,
                telegramId: userData.telegramId || state.telegramId,
                username: userData.username || state.username,
                avatarUrl: userData.avatarUrl || state.avatarUrl,
                balance: userData.balance,
                level: userData.level || state.level,
                experience: userData.experience || state.experience,
                isActive: userData.isActive || state.isActive
              }));
            }
          }
        })
        .catch(error => {
          console.error('Ошибка при получении данных пользователя:', error);
        });
      
      // Проверяем, есть ли уже активное соединение
      if (socketRef.current && socketRef.current.connected && hasJoinedRoomRef.current) {
        console.log('Соединение уже установлено, пропускаем повторное подключение');
      } else {
        setupSocketConnection(currentUserId.toString());
      }
    } else {
      console.log('userId не получен при первой загрузке, ожидаем...');
      // Если userId не получен, ждем 1 секунду и пробуем снова
      const timer = setTimeout(() => {
        const delayedUserId = getTelegramUserId();
        if (delayedUserId) {
          console.log('userId получен с задержкой:', delayedUserId);
          setUserId(delayedUserId.toString());
          setTelegramId(delayedUserId);
          
          // Проверяем, есть ли уже активное соединение
          if (socketRef.current && socketRef.current.connected && hasJoinedRoomRef.current) {
            console.log('Соединение уже установлено, пропускаем повторное подключение');
          } else {
            setupSocketConnection(delayedUserId.toString());
          }
        } else {
          console.log('userId не получен даже после задержки, используем пользователя-гостя');
          // Если всё ещё не удалось получить userId, создаем гостевой ID
          const guestId = getOrCreateGuestId();
          setUserId(guestId);
          
          // Проверяем, есть ли уже активное соединение
          if (socketRef.current && socketRef.current.connected && hasJoinedRoomRef.current) {
            console.log('Соединение уже установлено, пропускаем повторное подключение');
          } else {
            setupSocketConnection(guestId);
          }
        }
      }, 1000);
      
      return () => {
        clearTimeout(timer);
        if (socketRef.current) {
          console.log('MultiplayerDiceGame component unmounting, disconnecting socket');
          socketRef.current.disconnect();
        }
      };
    }
    
    // Функция для предотвращения свайпа при игре
    const preventSwipe = (e: TouchEvent) => {
      // Проверяем, находимся ли мы в режиме игры
      if (gameState === 'playing') {
        e.preventDefault();
      }
    };
    
    // Добавляем обработчик события touchstart для предотвращения свайпа
    document.addEventListener('touchstart', preventSwipe, { passive: false });
    
    // Очищаем ресурсы при размонтировании компонента
    return () => {
      console.log('MultiplayerDiceGame component unmounting, cleanup');
      mounted.current = false;
      
      if (socketRef.current) {
        console.log('Closing socket connection on unmount');
        socketRef.current.disconnect();
      }
      
      document.removeEventListener('touchstart', preventSwipe);
    };
  }, [gameId]);

  // Добавляем эффект для запроса обновления списка игроков после подключения
  useEffect(() => {
    if (connectionStatus === 'connected' && socketRef.current && userId) {
      console.log('Соединение установлено, запрашиваем список игроков');
      
      // Преобразуем userId в число
      const telegramId = parseInt(userId, 10);
      
      // Сначала пробуем запросить игроков
      socketRef.current.emit('getGamePlayers', { 
        gameId, 
        userId: telegramId,
        telegramId: telegramId
      });
      
      // Затем пробуем присоединиться, если ещё не присоединились
      if (!hasJoinedRoomRef.current) {
        socketRef.current.emit('joinGameRoom', { 
          gameId,
          telegramId, // Явно передаем telegramId
          username: window.Telegram?.WebApp?.initDataUnsafe?.user?.username || 'unknown'
        });
        
        // Отправляем информацию о пользователе (вдруг сервер ее использует)
        socketRef.current.emit('userInfo', { 
          userId: telegramId, 
          telegramId: telegramId,
          gameId,
          username: window.Telegram?.WebApp?.initDataUnsafe?.user?.username || 'unknown'
        });
        
        hasJoinedRoomRef.current = true;
      }
      
      // Устанавливаем интервал для периодического обновления списка игроков
      const interval = setInterval(() => {
        if (socketRef.current && socketRef.current.connected) {
          console.log('Периодическое обновление списка игроков');
          socketRef.current.emit('getGamePlayers', { 
            gameId,
            userId: telegramId,
            telegramId: telegramId
          });
        }
      }, 5000); // Запрашиваем обновление каждые 5 секунд
      
      return () => clearInterval(interval);
    }
  }, [connectionStatus, gameId, userId]);

  // Добавляем эффект для обновления telegramId при изменении в хранилище
  useEffect(() => {
    if (telegramIdFromStore) {
      const numericId = Number(telegramIdFromStore);
      if (!isNaN(numericId)) {
        console.log('Обновляем telegramId из хранилища:', numericId);
        setTelegramId(numericId);
      } else {
        console.error('TelegramId в хранилище не является числом:', telegramIdFromStore);
      }
    }
  }, [telegramIdFromStore]);

  // При загрузке компонента, попытаемся сразу определить telegramId пользователя
  useEffect(() => {
    // Функция для безопасного обновления telegramId
    const updateTelegramId = (id: number | null | undefined) => {
      if (id && !isNaN(Number(id))) {
        console.log('Обновляем telegramId:', id);
        const numericId = Number(id);
        setTelegramId(numericId);
        
        // Также сохраним в хранилище для последующего использования
        useUserStore.getState().updateUser({
          telegramId: numericId,
          username: 'Player', // Временное имя пользователя
          avatarUrl: undefined,
          balance: 0,
          isActive: true
        });
        
        // Обновим также userId для единообразия
        setUserId(numericId.toString());
        
        return numericId;
      } else {
        console.warn('Получен некорректный telegramId:', id);
        return null;
      }
    };
    
    // Сначала проверим, есть ли уже установленный telegramId
    if (!telegramId) {
      // Проверяем наличие в хранилище
      if (telegramIdFromStore) {
        updateTelegramId(Number(telegramIdFromStore));
      } else {
        // Пытаемся получить из Telegram WebApp
        const webAppId = getTelegramUserId();
        if (webAppId) {
          updateTelegramId(webAppId);
        } else {
          // Если не получилось, логируем предупреждение
          console.warn('Не удалось получить telegramId пользователя. Это может вызвать проблемы при игре.');
        }
      }
    }
  }, [telegramId, telegramIdFromStore]);

  // Проверяем, получаем ли мы информацию о ставке через socket
  useEffect(() => {
    // Используем существующее соединение, а не создаем новое
    if (socketRef.current && socketRef.current.connected) {
      console.log('Запрашиваем информацию об игре через существующее соединение');
      
      // Отключаем предыдущий обработчик gameInfo, если он был
      socketRef.current.off('gameInfo');
      
      // Регистрируем новый обработчик
      const handleGameInfo = (gameInfo: any) => {
        console.log('Получена информация об игре:', gameInfo);
        if (gameInfo && gameInfo.betAmount) {
          console.log('Полученная ставка через сокет:', gameInfo.betAmount);
        }
      };
      
      // Добавляем обработчик для получения информации об игре
      socketRef.current.on('gameInfo', handleGameInfo);
      
      // Отправляем запрос
      socketRef.current.emit('getGameInfo', { gameId });
      
      return () => {
        // Удаляем обработчик при размонтировании
        if (socketRef.current) {
          socketRef.current.off('gameInfo', handleGameInfo);
        }
      };
    } else {
      console.log('Соединение не установлено, информация о ставке будет запрошена позже');
    }
  }, [gameId, socketRef.current?.connected]);

  // Обработчик для возврата в лобби
  const handleBackToLobby = useCallback(() => {
    // Перенаправляем на страницу лобби
    if (window.Telegram?.WebApp) {
      // Закрываем WebApp Telegram
      window.Telegram.WebApp.close();
    } else {
      // В случае тестирования в браузере
      window.location.href = '/games';
    }
  }, []);

  const renderGameInterface = () => {
    // Получаем актуальный баланс из хранилища
    const userBalance = useUserStore.getState().balance;
    const isPlayerCurrentTurn = useUserStore.getState().isCurrentTurn;
    
    console.log('Render game interface with balance:', userBalance);
    console.log('Current turn state:', { isMyTurn, isPlayerCurrentTurn });
    
    return (
      <div className="dice-game">
        <div className="game-header">
          <div className="score">
            <div className="player-side">
              <div className={`player-avatar ${isMyTurn ? 'active-turn' : ''}`}>
                {playerData?.avatarUrl ? (
                  <img src={playerData.avatarUrl} alt={playerData.username || 'Player'} />
                ) : (
                  <Icon icon="mdi:account-circle" />
                )}
                {isMyTurn && <div className="turn-indicator">Ваш ход</div>}
              </div>
              <div className="player-score">{playerScore}</div>
            </div>
            
            <div className="round-info">
              <div className="round-number">Раунд {currentRound}/{MAX_ROUNDS}</div>
              <div className="bet-amount">
                <Icon icon="material-symbols:diamond-rounded" />
                <span>{displayedBetAmount}</span>
              </div>
              <div className="vs-indicator">VS</div>
            </div>
            
            <div className="opponent-side">
              <div className={`opponent-avatar ${!isMyTurn ? 'active-turn' : ''}`}>
                {opponentData?.avatarUrl ? (
                  <img src={opponentData.avatarUrl} alt={opponentData.username || 'Opponent'} />
                ) : (
                  <Icon icon="mdi:account-circle" />
                )}
                {!isMyTurn && <div className="turn-indicator">Ходит</div>}
              </div>
              <div className="opponent-score">{opponentScore}</div>
            </div>
          </div>
        </div>

        <div className="dice-area">
          <div className="player-dice-area">
            <div className={`dice-container ${isPlayerRolling ? 'rolling' : ''}`}>
              <Dice 
                value={playerDice} 
                size="large" 
                rolling={isPlayerRolling}
                enhancedAnimation={true}
              />
            </div>
          </div>
          
          <div className="opponent-dice-area">
            <div className={`dice-container ${isOpponentRolling ? 'rolling' : ''}`}>
              <Dice 
                value={opponentDice} 
                size="large"
                rolling={isOpponentRolling}
                enhancedAnimation={true}
              />
            </div>
          </div>
        </div>

        <div className="controls-area">
          {gameResult ? (
            <GameResult result={gameResult} />
          ) : (
            <button 
              className={`roll-button ${isMyTurn && !isPlayerRolling ? 'active' : 'inactive'}`}
              onClick={rollDice}
              disabled={isPlayerRolling || !isMyTurn}
            >
              {isMyTurn ? (isPlayerRolling ? 'Бросаем...' : 'Бросить кубик') : 'Ожидание хода соперника'}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderGameResult = () => {
    // Получаем актуальный баланс из хранилища
    const userBalance = useUserStore.getState().balance;
    
    console.log('Render game result with balance:', userBalance);
    
    return (
      <div className="dice-game">
        <div className="game-info">
          <h1>Игра завершена</h1>
          <div className="bet-info">
            <Icon icon="material-symbols:diamond-rounded" />
            <span>{displayedBetAmount}</span>
          </div>
          <GameResult result={gameResult} />
          <button 
            className="back-button"
            onClick={handleBackToLobby}
          >
            Вернуться в лобби
          </button>
        </div>
      </div>
    );
  };

  // Если есть проблемы с соединением
  if (connectionStatus === 'error') {
    return (
      <PageContainer>
        <div className="dice-game">
          <div className="game-info">
            <h1>Ошибка соединения</h1>
          </div>
          <div className="error-container">
            <p>{socketError || 'Не удалось подключиться к серверу'}</p>
            <button 
              className="reload-button"
              onClick={() => {
                connectionAttemptRef.current = 0;
                setupSocketConnection();
              }}
            >
              Переподключиться
            </button>
          </div>
        </div>
      </PageContainer>
    );
  }

  // Если соединение устанавливается
  if (connectionStatus === 'connecting') {
    return (
      <PageContainer>
        <div className="dice-game">
          <div className="game-info">
            <h1>Подключение к игре</h1>
          </div>
          <div className="connecting-container">
            <div className="loading-spinner"></div>
            <p>Устанавливается соединение с сервером...</p>
          </div>
        </div>
      </PageContainer>
    );
  }

  // Если игра в режиме ожидания
  if (gameState === 'waiting') {
    console.log('Rendering WaitingRoom with betAmount:', displayedBetAmount);
    return (
      <PageContainer>
        <WaitingRoom
          gameId={gameId}
          betAmount={displayedBetAmount}
          players={players}
          connectionStatus={connectionStatus}
          socketError={socketError}
          onCopyInviteLink={copyInviteLink}
          onReconnect={() => setupSocketConnection()}
          isJoining={isJoining}
        />
      </PageContainer>
    );
  }

  // Если игра в процессе
  if (gameState === 'playing') {
    return (
      <PageContainer>
        {renderGameInterface()}
      </PageContainer>
    );
  }

  // Если игра закончена
  if (gameState === 'finished') {
    return (
      <PageContainer>
        {renderGameResult()}
      </PageContainer>
    );
  }

  // Обновляем возвращаемый JSX для лучшей интеграции с макетом
  return (
    <PageContainer>
      {renderGameInterface()}
    </PageContainer>
  );
} 
