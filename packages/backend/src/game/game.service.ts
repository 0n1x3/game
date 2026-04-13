import { Injectable } from '@nestjs/common';
import { Game, GameType, GameState, User } from '@game/shared';
import { Server } from 'socket.io';
import { TransactionsService } from '../transactions/transactions.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserDocument, toUser } from '../schemas/user.schema';

@Injectable()
export class GameService {
  private games: Map<string, Game> = new Map();
  private gameStates: Map<string, GameState> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private server: Server;

  constructor(
    private transactionsService: TransactionsService,
    @InjectModel('Game') private gameModel: Model<Game>,
    @InjectModel('User') private userModel: Model<UserDocument>
  ) {}

  setServer(server: Server) {
    this.server = server;
  }

  async createGame(type: GameType, creator: UserDocument, betAmount: number) {
    try {
      console.log('Creating game with:', { 
        type, 
        creator: { 
          id: creator._id, 
          telegramId: creator.telegramId,
          username: creator.username 
        }, 
        betAmount 
      });
      
      await this.transactionsService.createBet(creator.telegramId, betAmount, type);
      
      const game = new this.gameModel({
        type,
        name: `${creator.username}'s game`,
        players: [creator._id],
        betAmount,
        status: 'waiting',
        createdBy: creator.telegramId.toString() // Используем telegramId как createdBy
      });
      
      const savedGame = await game.save();
      console.log('Saved game with createdBy:', { 
        id: savedGame._id, 
        name: savedGame.name, 
        createdBy: savedGame.createdBy,
        creatorTelegramId: creator.telegramId
      });
      return savedGame;
    } catch (error) {
      console.error('Error in createGame:', error);
      throw error;
    }
  }

  async validateUser(userId: number): Promise<UserDocument> {
    const user = await this.userModel.findOne({ telegramId: userId });
    if (!user) throw new Error('User not found');
    return user;
  }

  async joinGame(gameId: string, user: UserDocument) {
    try {
      console.log(`Попытка присоединиться к игре с ID: ${gameId}`);
      const game = await this.gameModel.findById(gameId).exec();
      
      if (!game) {
        console.log(`Игра с ID ${gameId} не найдена`);
        throw new Error('Game not found');
      }
      
      console.log(`Игра найдена: ${game.name}, тип: ${game.type}, статус: ${game.status}`);
      
      // Проверяем, не является ли пользователь уже игроком
      const isAlreadyPlayer = game.players.some(
        (playerId) => playerId.toString() === user._id.toString()
      );
      
      // Если пользователь уже присоединился, просто возвращаем успех
      if (isAlreadyPlayer) {
        console.log(`Игрок ${user.username} уже присоединен к игре ${gameId}`);
        return game;
      }
      
      // Проверяем статус игры и количество игроков
      if (game.status !== 'waiting') {
        console.log(`Невозможно присоединиться к игре ${gameId} в статусе ${game.status}`);
        throw new Error(`Cannot join game in status ${game.status}`);
      }
      
      if (game.players.length >= 2) {
        console.log(`Игра ${gameId} уже заполнена (${game.players.length} игроков)`);
        throw new Error('Game is full');
      }
      
      // Проверяем баланс пользователя
      if (user.balance < game.betAmount) {
        console.log(`У игрока ${user.username} недостаточно средств для ставки ${game.betAmount}. Текущий баланс: ${user.balance}`);
        throw new Error('Insufficient balance for bet');
      }
      
      // Списываем ставку у второго игрока
      if (game.players.length === 1) {
        // Проверяем, не является ли пользователь создателем игры
        const creatorId = String(game.createdBy);
        const joinerId = String(user.telegramId);
        
        if (creatorId !== joinerId) {
          // Списываем ставку у второго игрока (не создателя)
          console.log(`Списываем ставку ${game.betAmount} у второго игрока ${user.username} (${user.telegramId})`);
          await this.transactionsService.createBet(user.telegramId, game.betAmount, GameType.DICE);
        } else {
          console.log(`Пользователь ${user.username} является создателем игры, ставка уже списана`);
        }
      }
      
      // Добавляем игрока в игру
      console.log(`Добавляем игрока ${user.username} в игру ${gameId}`);
      game.players.push(user._id);
      
      // Сохраняем игру перед потенциальным запуском
      await game.save();
      console.log(`Игрок ${user.username} успешно присоединился к игре ${gameId}`);
      
      // Если у нас уже 2 игрока, автоматически запускаем игру в кости
      if (game.players.length === 2 && game.type === 'dice') {
        console.log(`Игра ${gameId} готова к началу с 2 игроками, автоматически запускаем...`);
        
        try {
          // Асинхронно запускаем игру, но не ждем результата здесь
          // чтобы не замедлять ответ на запрос присоединения
          this.startDiceGame(gameId).then(startedGame => {
            console.log(`Игра ${gameId} успешно запущена автоматически`);
          }).catch(error => {
            console.error(`Ошибка при автоматическом запуске игры ${gameId}:`, error);
          });
        } catch (startError) {
          console.error(`Ошибка при подготовке к автоматическому запуску игры ${gameId}:`, startError);
          // Мы не будем выбрасывать ошибку здесь, так как игрок уже успешно присоединился
        }
      } else {
        // Если игра не запускается автоматически, отправляем событие о готовности игры
        if (this.server) {
          this.server.to(`game_${gameId}`).emit('gameReadyToStart', {
            gameId,
            players: game.players.length
          });
        }
      }
      
      return game;
    } catch (error) {
      console.error(`Ошибка при присоединении к игре ${gameId}:`, error);
      throw error;
    }
  }

  startTurnTimer(lobbyId: string) {
    const timer = setTimeout(() => {
      this.handleTimeout(lobbyId);
    }, 30000); // 30 секунд на ход
    this.timers.set(lobbyId, timer);
  }

  private handleTimeout(lobbyId: string) {
    const game = this.games.get(lobbyId);
    if (game) {
      // Логика обработки таймаута
      this.server.emit('TIMEOUT', { lobbyId });
    }
  }

  startGame(lobbyId: string): Game {
    const game = this.games.get(lobbyId);
    if (!game) throw new Error('Game not found');
    
    game.status = 'playing';
    this.gameStates.set(lobbyId, {
      gameId: lobbyId,
      currentPlayer: game.players[0].id,
      moves: []
    });
    
    return game;
  }

  async getActiveGames(gameType: GameType) {
    const games = await this.gameModel.find({ 
      type: gameType,
      status: 'waiting'
    })
    .populate('players')
    .lean()
    .exec();
    
    // Преобразуем результаты, чтобы убедиться, что createdBy доступно
    const formattedGames = games.map(game => {
      // Убедимся, что createdBy существует и является строкой
      if (!game.createdBy) {
        console.log(`Game ${game._id} has no createdBy field`);
      }
      
      return {
        ...game,
        createdBy: game.createdBy || null // Гарантируем, что поле существует
      };
    });
    
    console.log('Active games with createdBy field:', formattedGames.map(game => ({
      id: game._id,
      name: game.name,
      createdBy: game.createdBy,
      players: game.players.length
    })));
    
    return formattedGames;
  }

  // Получение игры по ID
  async getDiceGameById(gameId: string): Promise<Game | null> {
    try {
      const game = await this.gameModel.findById(gameId)
        .populate('players')
        .exec();
      
      return game;
    } catch (error) {
      console.error('Error getting dice game by ID:', error);
      return null;
    }
  }

  // Записываем ход игрока
  async recordDiceMove(gameId: string, telegramId: number, value: number): Promise<Game> {
    console.log(`Запись хода для игры ${gameId}, пользователь с Telegram ID ${telegramId}, значение ${value}`);
    
    const game = await this.gameModel.findById(gameId)
      .populate('players')
      .exec();
    
    if (!game) {
      console.error(`Игра с ID ${gameId} не найдена`);
      throw new Error('Game not found');
    }
    
    // Проверяем статус игры
    if (game.status !== 'playing') {
      console.error(`Игра не в статусе playing: ${game.status}`);
      throw new Error(`Game is not in playing status: ${game.status}`);
    }
    
    // Преобразуем telegramId в строку для единообразия
    const playerTelegramIdStr = String(telegramId);
    
    // Проверяем, чей ход (сравниваем telegramId с currentPlayer)
    if (game.currentPlayer && game.currentPlayer !== playerTelegramIdStr) {
      console.error(`Не ваш ход: текущий игрок ${game.currentPlayer}, вы пытаетесь ходить как ${playerTelegramIdStr}`);
      throw new Error('Not your turn');
    }
    
    console.log(`Игроки в игре:`, game.players.map(p => ({
      telegramId: p.telegramId,
      username: p.username
    })));
    
    // Получение индекса текущего игрока
    const playerIndex = game.players.findIndex(p => 
      String(p.telegramId) === playerTelegramIdStr
    );
    
    if (playerIndex === -1) {
      console.error(`Игрок с Telegram ID ${telegramId} не найден в игре`);
      throw new Error('Player not found in game');
    }
    
    // Если ещё нет истории раундов, создаем её
    if (!game.rounds) {
      game.rounds = [];
    }
    
    console.log(`Текущий раунд: ${game.currentRound}, всего раундов: ${game.rounds.length}`);
    
    // Если это первый игрок в текущем раунде
    if (!game.rounds[game.currentRound - 1]) {
      console.log(`Первый ход в раунде ${game.currentRound}`);
      // Убеждаемся, что массив раундов имеет правильную длину
      while (game.rounds.length < game.currentRound) {
        game.rounds.push({
          player1: null,
          player2: null,
          result: null
        });
      }
      // Сохраняем ход первого игрока
      game.rounds[game.currentRound - 1].player1 = value;
      
      // Переход хода к другому игроку
      const nextPlayerIndex = (playerIndex + 1) % game.players.length;
      const nextPlayer = game.players[nextPlayerIndex];
      
      console.log(`Turn moves to the next player:`, {
        currentPlayer: {
          index: playerIndex,
          telegramId: game.players[playerIndex].telegramId,
          username: game.players[playerIndex].username
        },
        nextPlayer: {
          index: nextPlayerIndex,
          telegramId: nextPlayer.telegramId,
          username: nextPlayer.username
        }
      });
      
      game.currentPlayer = String(nextPlayer.telegramId);
      
      console.log(`Ход переходит к игроку ${game.currentPlayer}`);
      console.log(`Ход переходит к игроку ${game.currentPlayer} (${nextPlayer.username})`);
      
      // Отправляем событие о ходе и информацию о следующем игроке
      this.server.to(`game_${gameId}`).emit('diceMove', {
        gameId,
        telegramId: telegramId,
        value,
        nextMove: nextPlayer.telegramId
      });
    } 
    // Если это второй игрок в раунде
    else {
      console.log(`Второй ход в раунде ${game.currentRound}`);
      // Обновляем существующий раунд, сохраняя предыдущие значения
      const currentRound = game.rounds[game.currentRound - 1];
      if (currentRound && currentRound.player1 !== null) {
        // Сохраняем значение второго игрока
        game.rounds[game.currentRound - 1] = {
          ...currentRound,
          player2: value
        };
        
        // Определяем результат раунда
        const player1Value = currentRound.player1;
        const player2Value = value;
        
        let result: 'win' | 'lose' | 'draw';
        
        if (player1Value > player2Value) {
          result = 'win';
          console.log(`Игрок 1 побеждает в раунде ${game.currentRound}: ${player1Value} > ${player2Value}`);
        } else if (player1Value < player2Value) {
          result = 'lose';
          console.log(`Игрок 2 побеждает в раунде ${game.currentRound}: ${player1Value} < ${player2Value}`);
        } else {
          result = 'draw';
          console.log(`Ничья в раунде ${game.currentRound}: ${player1Value} = ${player2Value}`);
        }
        
        // Сохраняем результат раунда
        game.rounds[game.currentRound - 1].result = result;
        
        console.log(`Результат раунда ${game.currentRound}: ${result}, значения: ${player1Value} vs ${player2Value}`);
        console.log(`Раунды перед подсчетом побед:`, JSON.stringify(game.rounds));
        
        // Отправляем результат раунда
        this.server.to(`game_${gameId}`).emit('roundResult', {
          round: game.currentRound,
          players: game.players.map(p => p.telegramId),
          result,
          player1Value,
          player2Value
        });
        
        // Проверяем, закончилась ли игра
        let player1Wins = 0;
        let player2Wins = 0;
        
        // Считаем победы только для завершенных раундов
        game.rounds.forEach((round, index) => {
          if (round.player1 !== null && round.player2 !== null && round.result) {
            console.log(`Проверка раунда ${index + 1}:`, {
              player1: round.player1,
              player2: round.player2,
              result: round.result
            });
            
            if (round.result === 'win') {
              player1Wins++;
              console.log(`Игрок 1 выиграл раунд ${index + 1}, всего побед: ${player1Wins}`);
            } else if (round.result === 'lose') {
              player2Wins++;
              console.log(`Игрок 2 выиграл раунд ${index + 1}, всего побед: ${player2Wins}`);
            } else {
              console.log(`Раунд ${index + 1} закончился вничью`);
            }
          }
        });
        
        // Определяем константы для проверки окончания игры
        const maxRounds = 5;
        const winsNeeded = 2;
        
        // Добавляем подробное логирование перед проверкой победителя
        console.log('Итоговый подсчет побед:', {
          player1Wins,
          player2Wins,
          currentRound: game.currentRound,
          winsNeeded,
          maxRounds,
          rounds: game.rounds.map(r => ({
            player1: r.player1,
            player2: r.player2,
            result: r.result
          }))
        });
        
        // Проверяем условия окончания игры
        if (player1Wins >= winsNeeded || player2Wins >= winsNeeded) {
          game.status = 'finished';
          const winner = player1Wins >= winsNeeded ? game.players[0].telegramId : game.players[1].telegramId;
          
          console.log(`Игра завершена. Победитель: ${winner}, счет: ${player1Wins}-${player2Wins}`);
          
          // Отправляем уведомление о завершении игры
          this.server.to(`game_${gameId}`).emit('gameEnd', {
            gameId,
            winner,
            score: [player1Wins, player2Wins],
            rounds: game.rounds
          });
          
          // Начисляем выигрыш победителю
          const totalBet = game.betAmount * 2;
          await this.transactionsService.processPayout(
            winner,
            totalBet,
            'dice_win'
          );
        } else if (game.currentRound >= maxRounds) {
          // Если достигнут максимальный раунд
          game.status = 'finished';
          const winner = player1Wins > player2Wins ? game.players[0].telegramId :
                        player2Wins > player1Wins ? game.players[1].telegramId :
                        game.players[Math.floor(Math.random() * 2)].telegramId;
          
          console.log(`Игра завершена по максимальному количеству раундов. Победитель: ${winner}`);
          
          this.server.to(`game_${gameId}`).emit('gameEnd', {
            gameId,
            winner,
            score: [player1Wins, player2Wins],
            rounds: game.rounds
          });
          
          // Начисляем выигрыш победителю
          const totalBet = game.betAmount * 2;
          await this.transactionsService.processPayout(
            winner,
            totalBet,
            'dice_win'
          );
        } else {
          // Переходим к следующему раунду
          game.currentRound++;
          game.currentPlayer = String(game.players[0].telegramId);
          
          console.log(`Переход к новому раунду ${game.currentRound}, первым ходит игрок ${game.currentPlayer}`);
          
          this.server.to(`game_${gameId}`).emit('diceMove', {
            gameId,
            telegramId: telegramId,
            value,
            nextMove: game.players[0].telegramId
          });
        }
      }
    }
    
    await game.save();
    return game;
  }

  // Начало игры в кубики
  async startDiceGame(gameId: string): Promise<any> {
    console.log(`Запуск игры в кости с ID: ${gameId}`);
    
    try {
      // Находим игру по ID
      const game = await this.gameModel.findById(gameId)
        .populate('players')
        .exec();
      
      if (!game) {
        throw new Error('Game not found');
      }
      
      // Проверяем, что у игры правильный тип
      if (game.type !== 'dice') {
        throw new Error('This is not a dice game');
      }
      
      // Проверяем, что игра еще не запущена
      if (game.status === 'playing' || game.status === 'finished') {
        console.log(`Игра ${gameId} уже запущена или завершена`);
        return game;
      }
      
      // Проверяем, что подключилось 2 игрока
      if (game.players.length !== 2) {
        console.error(`Для начала игры необходимо 2 игрока, текущее количество: ${game.players.length}`);
        throw new Error('Not enough players to start the game');
      }
      
      // Обновляем статус игры
      game.status = 'playing';
      game.currentRound = 1;
      
      // Выбираем случайного игрока для первого хода
      const randomPlayerIndex = Math.floor(Math.random() * 2);
      const firstPlayer = game.players[randomPlayerIndex];
      
      // Устанавливаем первого игрока
      game.currentPlayer = firstPlayer.telegramId.toString();
      
      console.log(`Игра ${gameId} успешно запущена. Первым ходит игрок ${game.currentPlayer}`);
      
      // Сохраняем изменения в базе данных
      await game.save();
      
      // Оповещаем всех игроков о начале игры
      this.server.to(`game_${gameId}`).emit('diceGameStarted', {
        gameId,
        status: 'playing',
        firstPlayer: game.currentPlayer,
        players: game.players.map(p => ({
          telegramId: p.telegramId,
          username: p.username || 'Unknown',
          avatarUrl: p.avatarUrl
        })),
        timestamp: Date.now()
      });
      
      return game;
    } catch (error) {
      console.error('Ошибка при запуске игры в кости:', error);
      throw error;
    }
  }

  // Добавляем метод getGameById в GameService
  async getGameById(gameId: string) {
    try {
      return await this.gameModel.findById(gameId)
        .populate('players')
        .exec();
    } catch (error) {
      console.error('Error getting game by ID:', error);
      return null;
    }
  }

  // Метод для получения имени пользователя по его telegramId
  async getUsernameById(telegramId: string): Promise<string> {
    try {
      const user = await this.userModel.findOne({ telegramId: parseInt(telegramId) }).exec();
      return user ? user.username : 'unknown';
    } catch (error) {
      console.error(`Error getting username for telegramId ${telegramId}:`, error);
      return 'unknown';
    }
  }

  // Метод для удаления игры
  async deleteGame(gameId: string, userId: number): Promise<boolean> {
    try {
      console.log(`Попытка удаления игры с ID: ${gameId} пользователем: ${userId}`);
      
      // Находим игру
      const game = await this.gameModel.findById(gameId).exec();
      
      if (!game) {
        console.log(`Игра с ID ${gameId} не найдена`);
        throw new Error('Game not found');
      }
      
      console.log('Game found:', {
        id: game._id,
        name: game.name,
        createdBy: game.createdBy,
        userId: userId,
        players: game.players
      });
      
      // Находим пользователя
      const user = await this.userModel.findOne({ telegramId: userId }).exec();
      
      if (!user) {
        console.log(`Пользователь с ID ${userId} не найден`);
        throw new Error('User not found');
      }
      
      console.log('User found:', {
        id: user._id,
        telegramId: user.telegramId,
        username: user.username
      });
      
      // Проверяем, является ли пользователь создателем игры
      // Сначала проверяем по полю createdBy
      let isCreator = false;
      
      if (game.createdBy) {
        isCreator = game.createdBy === userId.toString();
        console.log(`Проверка по createdBy: ${game.createdBy} === ${userId.toString()} = ${isCreator}`);
      }
      
      // Если нет поля createdBy или проверка не прошла, проверяем по первому игроку
      if (!isCreator && game.players.length > 0) {
        isCreator = game.players[0].toString() === user._id.toString();
        console.log(`Проверка по первому игроку: ${game.players[0].toString()} === ${user._id.toString()} = ${isCreator}`);
      }
      
      if (!isCreator) {
        console.log(`Пользователь ${userId} не является создателем игры ${gameId}`);
        throw new Error('User is not the creator of this game');
      }
      
      // Проверяем статус игры - можно удалять только игры в статусе 'waiting'
      if (game.status !== 'waiting') {
        console.log(`Невозможно удалить игру ${gameId} в статусе ${game.status}`);
        throw new Error(`Cannot delete game in status ${game.status}`);
      }
      
      // Удаляем игру
      await this.gameModel.findByIdAndDelete(gameId).exec();
      console.log(`Игра ${gameId} успешно удалена`);
      
      // Возвращаем ставку создателю
      if (game.betAmount > 0) {
        await this.transactionsService.refundBet(user.telegramId, game.betAmount, game.type);
        console.log(`Ставка ${game.betAmount} возвращена пользователю ${userId}`);
      }
      
      // Если есть WebSocket сервер, отправляем уведомление об удалении игры
      if (this.server) {
        this.server.emit('gameDeleted', { gameId });
      }
      
      return true;
    } catch (error) {
      console.error(`Ошибка при удалении игры ${gameId}:`, error);
      throw error;
    }
  }

  // Другие методы для управления играми
} 
