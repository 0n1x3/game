import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import { Game, User, WSEvents, verifyToken } from '@game/shared';
import { GameType } from '@game/shared';
import { UserDocument } from '../schemas/user.schema';
import { getAllowedOrigins } from '../config/runtime';

const allowedOrigins = getAllowedOrigins();

@WebSocketGateway({
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  port: 3005,
  path: '/socket.io'
})
export class GameGateway {
  @WebSocketServer()
  server!: Server;

  // Карта для отслеживания активных подключений по gameId
  private activeConnections: Map<string, Set<string>> = new Map();

  constructor(private gameService: GameService) {}

  afterInit() {
    this.gameService.setServer(this.server);
    console.log('WebSocket Gateway initialized');
  }

  @SubscribeMessage('createGame')
  async handleCreateGame(
    @MessageBody() data: { 
      gameType: GameType,
      creator: UserDocument,
      betAmount: number 
    },
  ) {
    try {
      console.log('Creating game with data:', data);
      const game = await this.gameService.createGame(
        data.gameType,
        data.creator,
        data.betAmount
      );
      console.log('Created game:', game);
      this.server.emit(WSEvents.GAME_STATE_UPDATE, game.toObject());
      return { success: true, game: game.toObject() };
    } catch (error) {
      console.error('Error creating game:', error);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('joinGame')
  async handleJoinGame(@MessageBody() data: { gameId: string; user: User }) {
    const userDoc = await this.gameService.validateUser(data.user.telegramId);
    const game = await this.gameService.joinGame(data.gameId, userDoc);
    this.server.to(game.id).emit(WSEvents.PLAYER_JOINED, { game });
    return { success: true, game };
  }

  @SubscribeMessage('startGame')
  async handleStartGame(
    @MessageBody() data: { gameId: string },
  ) {
    const game = this.gameService.startGame(data.gameId);
    this.server.to(game.id).emit(WSEvents.GAME_STARTED, { game });
  }

  @SubscribeMessage('getGames')
  async handleGetGames() {
    // Здесь должна быть логика получения списка игр
    return { games: [] };
  }

  @SubscribeMessage('getGameStatus')
  async handleGetGameStatus(@MessageBody() data: { gameId: string }) {
    try {
      const game = await this.gameService.getGameById(data.gameId);
      
      if (!game) {
        return { success: false, error: 'Game not found' };
      }
      
      return { 
        success: true, 
        status: game.status,
        currentRound: game.currentRound,
        currentPlayer: game.currentPlayer,
        players: game.players.map(p => ({
          telegramId: p.telegramId,
          username: p.username,
          avatarUrl: p.avatarUrl
        }))
      };
    } catch (error) {
      console.error('Error getting game status:', error);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('updateGame')
  async handleUpdateGame(@MessageBody() data: { gameId: string }) {
    try {
      console.log(`Запрос на обновление игры с ID: ${data.gameId}`);
      
      const game = await this.gameService.getGameById(data.gameId);
      
      if (!game) {
        console.error(`Игра с ID ${data.gameId} не найдена`);
        return { success: false, error: 'Game not found' };
      }
      
      // Отправляем данные игры клиенту, который запросил обновление
      return { 
        success: true, 
        game: {
          id: game.id,
          _id: game._id,
          status: game.status,
          currentRound: game.currentRound,
          currentPlayer: game.currentPlayer,
          players: game.players,
          betAmount: game.betAmount,
          type: game.type,
          rounds: game.rounds
        }
      };
    } catch (error) {
      console.error('Error updating game:', error);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('getGamePlayers')
  async handleGetGamePlayers(@MessageBody() data: { gameId: string }) {
    try {
      console.log(`Получен запрос на получение игроков для игры с ID: ${data.gameId}`);
      
      const game = await this.gameService.getGameById(data.gameId);
      
      if (!game) {
        console.error(`Игра с ID ${data.gameId} не найдена`);
        return { success: false, error: 'Game not found' };
      }
      
      // Получаем данные игроков
      const players = [];
      for (const playerId of game.players) {
        const player = await this.gameService.validateUser(playerId.telegramId);
        if (player) {
          players.push({
            telegramId: player.telegramId,
            username: player.username,
            avatarUrl: player.avatarUrl
          });
        }
      }
      
      // Отправляем игрокам
      this.server.to(`game_${data.gameId}`).emit('gamePlayers', {
        players
      });
      
      return { success: true, players };
    } catch (error) {
      console.error('Error getting game players:', error);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('diceMove')
  async handleDiceMove(
    @MessageBody() data: { gameId: string; value: number; telegramId: number }
  ) {
    try {
      console.log('Получен запрос на ход в игре:', data);
      
      // Проверка наличия всех необходимых данных
      if (!data || !data.gameId) {
        console.error('Отсутствует gameId в запросе diceMove');
        return { success: false, error: 'Missing gameId' };
      }
      
      if (data.value === undefined || data.value === null) {
        console.error('Отсутствует значение броска в запросе diceMove');
        return { success: false, error: 'Missing dice value' };
      }
      
      if (!data.telegramId && data.telegramId !== 0) {
        console.error('Отсутствует telegramId в запросе diceMove:', data);
        return { success: false, error: 'Missing telegramId' };
      }
      
      const game = await this.gameService.getDiceGameById(data.gameId);
      
      if (!game) {
        console.error(`Игра с ID ${data.gameId} не найдена`);
        return { success: false, error: 'Game not found' };
      }
      
      // Проверяем, что игра в статусе 'playing'
      if (game.status !== 'playing') {
        console.error(`Попытка хода в игре, которая не в статусе playing: ${game.status}`);
        return { success: false, error: 'Game is not in playing status' };
      }
      
      // Преобразуем telegramId в строку для корректного сравнения
      const playerTelegramId = String(data.telegramId);
      
      // Проверяем, чей ход
      if (game.currentPlayer && game.currentPlayer !== playerTelegramId) {
        console.error(`Не ваш ход: текущий игрок ${game.currentPlayer}, вы пытаетесь ходить как ${playerTelegramId}`);
        return { success: false, error: 'Not your turn' };
      }
      
      console.log(`Игрок ${playerTelegramId} выполняет ход со значением ${data.value}`);
      
      try {
        // Обновляем состояние игры
        const updatedGame = await this.gameService.recordDiceMove(
          data.gameId,
          data.telegramId,
          data.value
        );
        
        // Получаем индекс следующего игрока
        const nextPlayerIndex = updatedGame.players.findIndex(
          p => String(p.telegramId) === String(updatedGame.currentPlayer)
        );
        
        // Имя следующего игрока
        const nextPlayerName = nextPlayerIndex >= 0 ? 
          await this.gameService.getUsernameById(String(updatedGame.currentPlayer)) : 
          'unknown';
        
        console.log(`Ход переходит к игроку ${updatedGame.currentPlayer} (${nextPlayerName})`);
        
        // Сообщаем всем подключенным клиентам о ходе
        this.server.to(`game_${data.gameId}`).emit('diceMove', {
          gameId: data.gameId,
          telegramId: data.telegramId,
          value: data.value,
          nextMove: updatedGame.currentPlayer,
          round: updatedGame.currentRound,
          timestamp: Date.now()
        });
        
        return { success: true };
      } catch (moveError) {
        console.error('Ошибка при обработке хода:', moveError);
        return { success: false, error: moveError.message };
      }
    } catch (error) {
      console.error('Общая ошибка при обработке события diceMove:', error);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('startDiceGame')
  async handleStartDiceGame(
    @MessageBody() data: { gameId: string }
  ) {
    try {
      // Сначала проверяем текущий статус игры
      const existingGame = await this.gameService.getGameById(data.gameId);
      
      // Если игра уже в процессе или завершена, не запускаем её снова
      if (existingGame && existingGame.status === 'playing') {
        console.log(`Игра ${data.gameId} уже запущена, пропускаем запрос на запуск`);
        return { 
          success: true, 
          message: 'Game is already started', 
          game: existingGame 
        };
      }
      
      if (existingGame && existingGame.status === 'finished') {
        console.log(`Игра ${data.gameId} уже завершена, пропускаем запрос на запуск`);
        return { 
          success: false, 
          error: 'Game is already finished'
        };
      }
      
      // Если игра в статусе 'waiting' или статус не определен, запускаем игру
      const game = await this.gameService.startDiceGame(data.gameId);
      
      console.log('Игра успешно запущена, отправляем событие diceGameStarted:', {
        gameId: data.gameId,
        firstPlayer: game.currentPlayer,
        players: game.players.map(p => ({
          telegramId: p.telegramId,
          username: p.username
        }))
      });
      
      // Используем оператор опционального доступа для предотвращения ошибок
      this.server.to(`game_${data.gameId}`).emit('diceGameStarted', {
        gameId: data.gameId,
        status: 'playing',
        firstPlayer: game.currentPlayer ?? '',
        players: game.players.map(p => ({
          telegramId: p.telegramId,
          username: p.username || 'Unknown',
          avatarUrl: p.avatarUrl
        })),
        timestamp: Date.now()
      });
      
      return { success: true, game };
    } catch (error) {
      console.error('Error starting dice game:', error);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('joinGameRoom')
  async handleJoinGameRoom(
    @MessageBody() data: { gameId: string; telegramId?: number; username?: string },
    @ConnectedSocket() client: Socket
  ) {
    try {
      const { gameId } = data;
      console.log(`Клиент ${client.id} пытается присоединиться к комнате игры ${gameId}`);
      
      // Проверяем, есть ли данные пользователя
      const userId = data.telegramId || (client.data?.user?.telegramId);
      
      if (!userId) {
        console.warn('Нет данных пользователя в сокете или запросе:', client.id);
        return { success: false, error: 'Не авторизован' };
      }
      
      // Пробуем получить имя пользователя
      const username = data.username || client.data?.user?.username || 'unknown';
      
      console.log(`Пользователь ${username} (${userId}) присоединяется к комнате ${gameId}`);
      
      // Проверяем, существует ли игра
      const game = await this.gameService.getGameById(gameId);
      if (!game) {
        console.error(`Игра с ID ${gameId} не найдена`);
        return { success: false, error: 'Игра не найдена' };
      }
      
      // Присоединяем клиента к комнате игры
      await client.join(`game_${gameId}`);
      console.log(`Клиент ${client.id} успешно присоединился к комнате game_${gameId}`);
      
      // Обновляем данные клиента
      client.data = {
        ...client.data,
        user: {
          telegramId: userId,
          username
        },
        gameId
      };
      
      // Отправляем текущее состояние игры 
      this.server.to(`game_${gameId}`).emit('gameStatus', {
        gameId,
        status: game.status,
        currentRound: game.currentRound,
        currentPlayer: game.currentPlayer,
        players: game.players.map(p => ({
          telegramId: p.telegramId,
          username: p.username,
          avatarUrl: p.avatarUrl
        }))
      });
      
      // Проверяем, является ли клиент игроком в этой игре
      const isPlayerInGame = game.players.some(p => String(p.telegramId) === String(userId));
      
      if (!isPlayerInGame && game.status === 'waiting') {
        console.log(`Игрок ${userId} не присоединен к игре, пробуем присоединить автоматически`);
        
        try {
          // Находим пользователя
          const user = await this.gameService.validateUser(Number(userId));
          if (user) {
            // Присоединяем к игре
            await this.gameService.joinGame(gameId, user);
            console.log(`Игрок ${username} (${userId}) успешно присоединен к игре ${gameId}`);
          }
        } catch (joinError) {
          console.error(`Ошибка при присоединении игрока ${userId} к игре:`, joinError);
        }
      }
      
      // Обновляем статус подключения для всех клиентов в комнате
      this.updateConnectionStatus(gameId);
      
      return { success: true };
    } catch (error) {
      console.error('Ошибка при присоединении к комнате игры:', error);
      return { success: false, error: error.message };
    }
  }

  // Обработчик подключения клиента
  handleConnection(client: Socket) {
    try {
      console.log(`Новое WebSocket соединение: ${client.id}`);
      
      // Получаем параметры из запроса
      const { telegramId, gameId } = client.handshake.query;
      
      if (!telegramId || !gameId) {
        console.warn(`Соединение без необходимых параметров: ${client.id}, параметры:`, client.handshake.query);
        return;
      }
      
      // Проверяем, что telegramId является строкой/числом
      const userTelegramId = typeof telegramId === 'string' 
        ? telegramId 
        : Array.isArray(telegramId) ? telegramId[0] : null;
      
      if (!userTelegramId) {
        console.error(`Некорректный формат telegramId:`, telegramId);
        return;
      }
      
      // Преобразуем gameId в строку
      const gameIdStr = typeof gameId === 'string' 
        ? gameId 
        : Array.isArray(gameId) ? gameId[0] : null;
      
      if (!gameIdStr) {
        console.error(`Некорректный формат gameId:`, gameId);
        return;
      }
      
      console.log(`Аутентифицированный пользователь: ${userTelegramId}`);
      
      // Сохраняем данные соединения
      client.data = { 
        ...client.data,
        user: { telegramId: userTelegramId },
        gameId: gameIdStr
      };
      
      // Обновляем статус подключения для игры
      this.updateConnectionStatus(gameIdStr);
    } catch (error) {
      console.error('Ошибка при обработке нового соединения:', error);
    }
  }

  // Обработчик отключения клиента
  handleDisconnect(client: Socket) {
    try {
      console.log(`WebSocket соединение закрыто: ${client.id}`);
      
      // Получаем gameId из данных клиента
      const gameId = client.data?.gameId;
      
      if (!gameId) {
        console.log(`Соединение без gameId закрыто: ${client.id}`);
        return;
      }
      
      // Обновляем статус подключения
      this.updateConnectionStatus(gameId);
    } catch (error) {
      console.error('Ошибка при обработке отключения:', error);
    }
  }

  // Метод для отправки обновления о статусе подключения
  private async updateConnectionStatus(gameId: string) {
    try {
      // Получаем количество клиентов в комнате
      const room = await this.server.in(`game_${gameId}`).fetchSockets();
      const connectedClients = room.length;
      
      console.log(`Обновление статуса подключения для игры ${gameId}: ${connectedClients} активных клиентов`);
      
      // Отправляем всем клиентам в комнате обновленный статус подключения
      this.server.to(`game_${gameId}`).emit('connectionStatus', {
        gameId,
        connectedClients,
        timestamp: Date.now()
      });
      
      return connectedClients;
    } catch (error) {
      console.error(`Ошибка при обновлении статуса подключения для игры ${gameId}:`, error);
      return 0;
    }
  }
} 
