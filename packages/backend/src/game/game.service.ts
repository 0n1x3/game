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
        createdBy: creator.telegramId.toString() // РСЃРїРѕР»СЊР·СѓРµРј telegramId РєР°Рє createdBy
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
      console.log(`РџРѕРїС‹С‚РєР° РїСЂРёСЃРѕРµРґРёРЅРёС‚СЊСЃСЏ Рє РёРіСЂРµ СЃ ID: ${gameId}`);
      const game = await this.gameModel.findById(gameId).exec();
      
      if (!game) {
        console.log(`РРіСЂР° СЃ ID ${gameId} РЅРµ РЅР°Р№РґРµРЅР°`);
        throw new Error('Game not found');
      }
      
      console.log(`РРіСЂР° РЅР°Р№РґРµРЅР°: ${game.name}, С‚РёРї: ${game.type}, СЃС‚Р°С‚СѓСЃ: ${game.status}`);
      
      // РџСЂРѕРІРµСЂСЏРµРј, РЅРµ СЏРІР»СЏРµС‚СЃСЏ Р»Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СѓР¶Рµ РёРіСЂРѕРєРѕРј
      const isAlreadyPlayer = game.players.some(
        (playerId) => playerId.toString() === user._id.toString()
      );
      
      // Р•СЃР»Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СѓР¶Рµ РїСЂРёСЃРѕРµРґРёРЅРёР»СЃСЏ, РїСЂРѕСЃС‚Рѕ РІРѕР·РІСЂР°С‰Р°РµРј СѓСЃРїРµС…
      if (isAlreadyPlayer) {
        console.log(`РРіСЂРѕРє ${user.username} СѓР¶Рµ РїСЂРёСЃРѕРµРґРёРЅРµРЅ Рє РёРіСЂРµ ${gameId}`);
        return game;
      }
      
      // РџСЂРѕРІРµСЂСЏРµРј СЃС‚Р°С‚СѓСЃ РёРіСЂС‹ Рё РєРѕР»РёС‡РµСЃС‚РІРѕ РёРіСЂРѕРєРѕРІ
      if (game.status !== 'waiting') {
        console.log(`РќРµРІРѕР·РјРѕР¶РЅРѕ РїСЂРёСЃРѕРµРґРёРЅРёС‚СЊСЃСЏ Рє РёРіСЂРµ ${gameId} РІ СЃС‚Р°С‚СѓСЃРµ ${game.status}`);
        throw new Error(`Cannot join game in status ${game.status}`);
      }
      
      if (game.players.length >= 2) {
        console.log(`РРіСЂР° ${gameId} СѓР¶Рµ Р·Р°РїРѕР»РЅРµРЅР° (${game.players.length} РёРіСЂРѕРєРѕРІ)`);
        throw new Error('Game is full');
      }
      
      // РџСЂРѕРІРµСЂСЏРµРј Р±Р°Р»Р°РЅСЃ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
      if (user.balance < game.betAmount) {
        console.log(`РЈ РёРіСЂРѕРєР° ${user.username} РЅРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЃСЂРµРґСЃС‚РІ РґР»СЏ СЃС‚Р°РІРєРё ${game.betAmount}. РўРµРєСѓС‰РёР№ Р±Р°Р»Р°РЅСЃ: ${user.balance}`);
        throw new Error('Insufficient balance for bet');
      }
      
      // РЎРїРёСЃС‹РІР°РµРј СЃС‚Р°РІРєСѓ Сѓ РІС‚РѕСЂРѕРіРѕ РёРіСЂРѕРєР°
      if (game.players.length === 1) {
        // РџСЂРѕРІРµСЂСЏРµРј, РЅРµ СЏРІР»СЏРµС‚СЃСЏ Р»Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃРѕР·РґР°С‚РµР»РµРј РёРіСЂС‹
        const creatorId = String(game.createdBy);
        const joinerId = String(user.telegramId);
        
        if (creatorId !== joinerId) {
          // РЎРїРёСЃС‹РІР°РµРј СЃС‚Р°РІРєСѓ Сѓ РІС‚РѕСЂРѕРіРѕ РёРіСЂРѕРєР° (РЅРµ СЃРѕР·РґР°С‚РµР»СЏ)
          console.log(`РЎРїРёСЃС‹РІР°РµРј СЃС‚Р°РІРєСѓ ${game.betAmount} Сѓ РІС‚РѕСЂРѕРіРѕ РёРіСЂРѕРєР° ${user.username} (${user.telegramId})`);
          await this.transactionsService.createBet(user.telegramId, game.betAmount, GameType.DICE);
        } else {
          console.log(`РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ ${user.username} СЏРІР»СЏРµС‚СЃСЏ СЃРѕР·РґР°С‚РµР»РµРј РёРіСЂС‹, СЃС‚Р°РІРєР° СѓР¶Рµ СЃРїРёСЃР°РЅР°`);
        }
      }
      
      // Р”РѕР±Р°РІР»СЏРµРј РёРіСЂРѕРєР° РІ РёРіСЂСѓ
      console.log(`Р”РѕР±Р°РІР»СЏРµРј РёРіСЂРѕРєР° ${user.username} РІ РёРіСЂСѓ ${gameId}`);
      game.players.push(user._id);
      
      // РЎРѕС…СЂР°РЅСЏРµРј РёРіСЂСѓ РїРµСЂРµРґ РїРѕС‚РµРЅС†РёР°Р»СЊРЅС‹Рј Р·Р°РїСѓСЃРєРѕРј
      await game.save();
      console.log(`РРіСЂРѕРє ${user.username} СѓСЃРїРµС€РЅРѕ РїСЂРёСЃРѕРµРґРёРЅРёР»СЃСЏ Рє РёРіСЂРµ ${gameId}`);
      
      // Р•СЃР»Рё Сѓ РЅР°СЃ СѓР¶Рµ 2 РёРіСЂРѕРєР°, Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё Р·Р°РїСѓСЃРєР°РµРј РёРіСЂСѓ РІ РєРѕСЃС‚Рё
      if (game.players.length === 2 && game.type === 'dice') {
        console.log(`РРіСЂР° ${gameId} РіРѕС‚РѕРІР° Рє РЅР°С‡Р°Р»Сѓ СЃ 2 РёРіСЂРѕРєР°РјРё, Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё Р·Р°РїСѓСЃРєР°РµРј...`);
        
        try {
          // РђСЃРёРЅС…СЂРѕРЅРЅРѕ Р·Р°РїСѓСЃРєР°РµРј РёРіСЂСѓ, РЅРѕ РЅРµ Р¶РґРµРј СЂРµР·СѓР»СЊС‚Р°С‚Р° Р·РґРµСЃСЊ
          // С‡С‚РѕР±С‹ РЅРµ Р·Р°РјРµРґР»СЏС‚СЊ РѕС‚РІРµС‚ РЅР° Р·Р°РїСЂРѕСЃ РїСЂРёСЃРѕРµРґРёРЅРµРЅРёСЏ
          this.startDiceGame(gameId).then(startedGame => {
            console.log(`РРіСЂР° ${gameId} СѓСЃРїРµС€РЅРѕ Р·Р°РїСѓС‰РµРЅР° Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё`);
          }).catch(error => {
            console.error(`РћС€РёР±РєР° РїСЂРё Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРј Р·Р°РїСѓСЃРєРµ РёРіСЂС‹ ${gameId}:`, error);
          });
        } catch (startError) {
          console.error(`РћС€РёР±РєР° РїСЂРё РїРѕРґРіРѕС‚РѕРІРєРµ Рє Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРјСѓ Р·Р°РїСѓСЃРєСѓ РёРіСЂС‹ ${gameId}:`, startError);
          // РњС‹ РЅРµ Р±СѓРґРµРј РІС‹Р±СЂР°СЃС‹РІР°С‚СЊ РѕС€РёР±РєСѓ Р·РґРµСЃСЊ, С‚Р°Рє РєР°Рє РёРіСЂРѕРє СѓР¶Рµ СѓСЃРїРµС€РЅРѕ РїСЂРёСЃРѕРµРґРёРЅРёР»СЃСЏ
        }
      } else {
        // Р•СЃР»Рё РёРіСЂР° РЅРµ Р·Р°РїСѓСЃРєР°РµС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё, РѕС‚РїСЂР°РІР»СЏРµРј СЃРѕР±С‹С‚РёРµ Рѕ РіРѕС‚РѕРІРЅРѕСЃС‚Рё РёРіСЂС‹
        if (this.server) {
          this.server.to(`game_${gameId}`).emit('gameReadyToStart', {
            gameId,
            players: game.players.length
          });
        }
      }
      
      return game;
    } catch (error) {
      console.error(`РћС€РёР±РєР° РїСЂРё РїСЂРёСЃРѕРµРґРёРЅРµРЅРёРё Рє РёРіСЂРµ ${gameId}:`, error);
      throw error;
    }
  }

  startTurnTimer(lobbyId: string) {
    const timer = setTimeout(() => {
      this.handleTimeout(lobbyId);
    }, 30000); // 30 СЃРµРєСѓРЅРґ РЅР° С…РѕРґ
    this.timers.set(lobbyId, timer);
  }

  private handleTimeout(lobbyId: string) {
    const game = this.games.get(lobbyId);
    if (game) {
      // Р›РѕРіРёРєР° РѕР±СЂР°Р±РѕС‚РєРё С‚Р°Р№РјР°СѓС‚Р°
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
    
    // РџСЂРµРѕР±СЂР°Р·СѓРµРј СЂРµР·СѓР»СЊС‚Р°С‚С‹, С‡С‚РѕР±С‹ СѓР±РµРґРёС‚СЊСЃСЏ, С‡С‚Рѕ createdBy РґРѕСЃС‚СѓРїРЅРѕ
    const formattedGames = games.map(game => {
      // РЈР±РµРґРёРјСЃСЏ, С‡С‚Рѕ createdBy СЃСѓС‰РµСЃС‚РІСѓРµС‚ Рё СЏРІР»СЏРµС‚СЃСЏ СЃС‚СЂРѕРєРѕР№
      if (!game.createdBy) {
        console.log(`Game ${game._id} has no createdBy field`);
      }
      
      return {
        ...game,
        createdBy: game.createdBy || null // Р“Р°СЂР°РЅС‚РёСЂСѓРµРј, С‡С‚Рѕ РїРѕР»Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚
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

  // РџРѕР»СѓС‡РµРЅРёРµ РёРіСЂС‹ РїРѕ ID
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

  // Р—Р°РїРёСЃС‹РІР°РµРј С…РѕРґ РёРіСЂРѕРєР°
  async recordDiceMove(gameId: string, telegramId: number, value: number): Promise<Game> {
    console.log(`Р—Р°РїРёСЃСЊ С…РѕРґР° РґР»СЏ РёРіСЂС‹ ${gameId}, РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃ Telegram ID ${telegramId}, Р·РЅР°С‡РµРЅРёРµ ${value}`);
    
    const game = await this.gameModel.findById(gameId)
      .populate('players')
      .exec();
    
    if (!game) {
      console.error(`РРіСЂР° СЃ ID ${gameId} РЅРµ РЅР°Р№РґРµРЅР°`);
      throw new Error('Game not found');
    }
    
    // РџСЂРѕРІРµСЂСЏРµРј СЃС‚Р°С‚СѓСЃ РёРіСЂС‹
    if (game.status !== 'playing') {
      console.error(`РРіСЂР° РЅРµ РІ СЃС‚Р°С‚СѓСЃРµ playing: ${game.status}`);
      throw new Error(`Game is not in playing status: ${game.status}`);
    }
    
    // РџСЂРµРѕР±СЂР°Р·СѓРµРј telegramId РІ СЃС‚СЂРѕРєСѓ РґР»СЏ РµРґРёРЅРѕРѕР±СЂР°Р·РёСЏ
    const playerTelegramIdStr = String(telegramId);
    
    // РџСЂРѕРІРµСЂСЏРµРј, С‡РµР№ С…РѕРґ (СЃСЂР°РІРЅРёРІР°РµРј telegramId СЃ currentPlayer)
    if (game.currentPlayer && game.currentPlayer !== playerTelegramIdStr) {
      console.error(`РќРµ РІР°С€ С…РѕРґ: С‚РµРєСѓС‰РёР№ РёРіСЂРѕРє ${game.currentPlayer}, РІС‹ РїС‹С‚Р°РµС‚РµСЃСЊ С…РѕРґРёС‚СЊ РєР°Рє ${playerTelegramIdStr}`);
      throw new Error('Not your turn');
    }
    
    console.log(`РРіСЂРѕРєРё РІ РёРіСЂРµ:`, game.players.map(p => ({
      telegramId: p.telegramId,
      username: p.username
    })));
    
    // РџРѕР»СѓС‡РµРЅРёРµ РёРЅРґРµРєСЃР° С‚РµРєСѓС‰РµРіРѕ РёРіСЂРѕРєР°
    const playerIndex = game.players.findIndex(p => 
      String(p.telegramId) === playerTelegramIdStr
    );
    
    if (playerIndex === -1) {
      console.error(`РРіСЂРѕРє СЃ Telegram ID ${telegramId} РЅРµ РЅР°Р№РґРµРЅ РІ РёРіСЂРµ`);
      throw new Error('Player not found in game');
    }
    
    // Р•СЃР»Рё РµС‰С‘ РЅРµС‚ РёСЃС‚РѕСЂРёРё СЂР°СѓРЅРґРѕРІ, СЃРѕР·РґР°РµРј РµС‘
    if (!game.rounds) {
      game.rounds = [];
    }
    
    console.log(`РўРµРєСѓС‰РёР№ СЂР°СѓРЅРґ: ${game.currentRound}, РІСЃРµРіРѕ СЂР°СѓРЅРґРѕРІ: ${game.rounds.length}`);
    
    // Р•СЃР»Рё СЌС‚Рѕ РїРµСЂРІС‹Р№ РёРіСЂРѕРє РІ С‚РµРєСѓС‰РµРј СЂР°СѓРЅРґРµ
    if (!game.rounds[game.currentRound - 1]) {
      console.log(`РџРµСЂРІС‹Р№ С…РѕРґ РІ СЂР°СѓРЅРґРµ ${game.currentRound}`);
      // РЈР±РµР¶РґР°РµРјСЃСЏ, С‡С‚Рѕ РјР°СЃСЃРёРІ СЂР°СѓРЅРґРѕРІ РёРјРµРµС‚ РїСЂР°РІРёР»СЊРЅСѓСЋ РґР»РёРЅСѓ
      while (game.rounds.length < game.currentRound) {
        game.rounds.push({
          player1: null,
          player2: null,
          result: null
        });
      }
      // РЎРѕС…СЂР°РЅСЏРµРј С…РѕРґ РїРµСЂРІРѕРіРѕ РёРіСЂРѕРєР°
      game.rounds[game.currentRound - 1].player1 = value;
      
      // РџРµСЂРµС…РѕРґ С…РѕРґР° Рє РґСЂСѓРіРѕРјСѓ РёРіСЂРѕРєСѓ
      const nextPlayerIndex = (playerIndex + 1) % game.players.length;
      const nextPlayer = game.players[nextPlayerIndex];
      
      console.log(`РџРµСЂРµС…РѕРґ С…РѕРґР° Рє СЃР»РµРґСѓСЋС‰РµРјСѓ РёРіСЂРѕРєСѓ:`, {
        С‚РµРєСѓС‰РёР№РРіСЂРѕРє: {
          РёРЅРґРµРєСЃ: playerIndex,
          telegramId: game.players[playerIndex].telegramId,
          username: game.players[playerIndex].username
        },
        СЃР»РµРґСѓСЋС‰РёР№РРіСЂРѕРє: {
          РёРЅРґРµРєСЃ: nextPlayerIndex,
          telegramId: nextPlayer.telegramId,
          username: nextPlayer.username
        }
      });
      
      game.currentPlayer = String(nextPlayer.telegramId);
      
      console.log(`РҐРѕРґ РїРµСЂРµС…РѕРґРёС‚ Рє РёРіСЂРѕРєСѓ ${game.currentPlayer}`);
      console.log(`РҐРѕРґ РїРµСЂРµС…РѕРґРёС‚ Рє РёРіСЂРѕРєСѓ ${game.currentPlayer} (${nextPlayer.username})`);
      
      // РћС‚РїСЂР°РІР»СЏРµРј СЃРѕР±С‹С‚РёРµ Рѕ С…РѕРґРµ Рё РёРЅС„РѕСЂРјР°С†РёСЋ Рѕ СЃР»РµРґСѓСЋС‰РµРј РёРіСЂРѕРєРµ
      this.server.to(`game_${gameId}`).emit('diceMove', {
        gameId,
        telegramId: telegramId,
        value,
        nextMove: nextPlayer.telegramId
      });
    } 
    // Р•СЃР»Рё СЌС‚Рѕ РІС‚РѕСЂРѕР№ РёРіСЂРѕРє РІ СЂР°СѓРЅРґРµ
    else {
      console.log(`Р’С‚РѕСЂРѕР№ С…РѕРґ РІ СЂР°СѓРЅРґРµ ${game.currentRound}`);
      // РћР±РЅРѕРІР»СЏРµРј СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёР№ СЂР°СѓРЅРґ, СЃРѕС…СЂР°РЅСЏСЏ РїСЂРµРґС‹РґСѓС‰РёРµ Р·РЅР°С‡РµРЅРёСЏ
      const currentRound = game.rounds[game.currentRound - 1];
      if (currentRound && currentRound.player1 !== null) {
        // РЎРѕС…СЂР°РЅСЏРµРј Р·РЅР°С‡РµРЅРёРµ РІС‚РѕСЂРѕРіРѕ РёРіСЂРѕРєР°
        game.rounds[game.currentRound - 1] = {
          ...currentRound,
          player2: value
        };
        
        // РћРїСЂРµРґРµР»СЏРµРј СЂРµР·СѓР»СЊС‚Р°С‚ СЂР°СѓРЅРґР°
        const player1Value = currentRound.player1;
        const player2Value = value;
        
        let result: 'win' | 'lose' | 'draw';
        
        if (player1Value > player2Value) {
          result = 'win';
          console.log(`РРіСЂРѕРє 1 РїРѕР±РµР¶РґР°РµС‚ РІ СЂР°СѓРЅРґРµ ${game.currentRound}: ${player1Value} > ${player2Value}`);
        } else if (player1Value < player2Value) {
          result = 'lose';
          console.log(`РРіСЂРѕРє 2 РїРѕР±РµР¶РґР°РµС‚ РІ СЂР°СѓРЅРґРµ ${game.currentRound}: ${player1Value} < ${player2Value}`);
        } else {
          result = 'draw';
          console.log(`РќРёС‡СЊСЏ РІ СЂР°СѓРЅРґРµ ${game.currentRound}: ${player1Value} = ${player2Value}`);
        }
        
        // РЎРѕС…СЂР°РЅСЏРµРј СЂРµР·СѓР»СЊС‚Р°С‚ СЂР°СѓРЅРґР°
        game.rounds[game.currentRound - 1].result = result;
        
        console.log(`Р РµР·СѓР»СЊС‚Р°С‚ СЂР°СѓРЅРґР° ${game.currentRound}: ${result}, Р·РЅР°С‡РµРЅРёСЏ: ${player1Value} vs ${player2Value}`);
        console.log(`Р Р°СѓРЅРґС‹ РїРµСЂРµРґ РїРѕРґСЃС‡РµС‚РѕРј РїРѕР±РµРґ:`, JSON.stringify(game.rounds));
        
        // РћС‚РїСЂР°РІР»СЏРµРј СЂРµР·СѓР»СЊС‚Р°С‚ СЂР°СѓРЅРґР°
        this.server.to(`game_${gameId}`).emit('roundResult', {
          round: game.currentRound,
          players: game.players.map(p => p.telegramId),
          result,
          player1Value,
          player2Value
        });
        
        // РџСЂРѕРІРµСЂСЏРµРј, Р·Р°РєРѕРЅС‡РёР»Р°СЃСЊ Р»Рё РёРіСЂР°
        let player1Wins = 0;
        let player2Wins = 0;
        
        // РЎС‡РёС‚Р°РµРј РїРѕР±РµРґС‹ С‚РѕР»СЊРєРѕ РґР»СЏ Р·Р°РІРµСЂС€РµРЅРЅС‹С… СЂР°СѓРЅРґРѕРІ
        game.rounds.forEach((round, index) => {
          if (round.player1 !== null && round.player2 !== null && round.result) {
            console.log(`РџСЂРѕРІРµСЂРєР° СЂР°СѓРЅРґР° ${index + 1}:`, {
              player1: round.player1,
              player2: round.player2,
              result: round.result
            });
            
            if (round.result === 'win') {
              player1Wins++;
              console.log(`РРіСЂРѕРє 1 РІС‹РёРіСЂР°Р» СЂР°СѓРЅРґ ${index + 1}, РІСЃРµРіРѕ РїРѕР±РµРґ: ${player1Wins}`);
            } else if (round.result === 'lose') {
              player2Wins++;
              console.log(`РРіСЂРѕРє 2 РІС‹РёРіСЂР°Р» СЂР°СѓРЅРґ ${index + 1}, РІСЃРµРіРѕ РїРѕР±РµРґ: ${player2Wins}`);
            } else {
              console.log(`Р Р°СѓРЅРґ ${index + 1} Р·Р°РєРѕРЅС‡РёР»СЃСЏ РІРЅРёС‡СЊСЋ`);
            }
          }
        });
        
        // РћРїСЂРµРґРµР»СЏРµРј РєРѕРЅСЃС‚Р°РЅС‚С‹ РґР»СЏ РїСЂРѕРІРµСЂРєРё РѕРєРѕРЅС‡Р°РЅРёСЏ РёРіСЂС‹
        const maxRounds = 5;
        const winsNeeded = 2;
        
        // Р”РѕР±Р°РІР»СЏРµРј РїРѕРґСЂРѕР±РЅРѕРµ Р»РѕРіРёСЂРѕРІР°РЅРёРµ РїРµСЂРµРґ РїСЂРѕРІРµСЂРєРѕР№ РїРѕР±РµРґРёС‚РµР»СЏ
        console.log('РС‚РѕРіРѕРІС‹Р№ РїРѕРґСЃС‡РµС‚ РїРѕР±РµРґ:', {
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
        
        // РџСЂРѕРІРµСЂСЏРµРј СѓСЃР»РѕРІРёСЏ РѕРєРѕРЅС‡Р°РЅРёСЏ РёРіСЂС‹
        if (player1Wins >= winsNeeded || player2Wins >= winsNeeded) {
          game.status = 'finished';
          const winner = player1Wins >= winsNeeded ? game.players[0].telegramId : game.players[1].telegramId;
          
          console.log(`РРіСЂР° Р·Р°РІРµСЂС€РµРЅР°. РџРѕР±РµРґРёС‚РµР»СЊ: ${winner}, СЃС‡РµС‚: ${player1Wins}-${player2Wins}`);
          
          // РћС‚РїСЂР°РІР»СЏРµРј СѓРІРµРґРѕРјР»РµРЅРёРµ Рѕ Р·Р°РІРµСЂС€РµРЅРёРё РёРіСЂС‹
          this.server.to(`game_${gameId}`).emit('gameEnd', {
            gameId,
            winner,
            score: [player1Wins, player2Wins],
            rounds: game.rounds
          });
          
          // РќР°С‡РёСЃР»СЏРµРј РІС‹РёРіСЂС‹С€ РїРѕР±РµРґРёС‚РµР»СЋ
          const totalBet = game.betAmount * 2;
          await this.transactionsService.processPayout(
            winner,
            totalBet,
            'dice_win'
          );
        } else if (game.currentRound >= maxRounds) {
          // Р•СЃР»Рё РґРѕСЃС‚РёРіРЅСѓС‚ РјР°РєСЃРёРјР°Р»СЊРЅС‹Р№ СЂР°СѓРЅРґ
          game.status = 'finished';
          const winner = player1Wins > player2Wins ? game.players[0].telegramId :
                        player2Wins > player1Wins ? game.players[1].telegramId :
                        game.players[Math.floor(Math.random() * 2)].telegramId;
          
          console.log(`РРіСЂР° Р·Р°РІРµСЂС€РµРЅР° РїРѕ РјР°РєСЃРёРјР°Р»СЊРЅРѕРјСѓ РєРѕР»РёС‡РµСЃС‚РІСѓ СЂР°СѓРЅРґРѕРІ. РџРѕР±РµРґРёС‚РµР»СЊ: ${winner}`);
          
          this.server.to(`game_${gameId}`).emit('gameEnd', {
            gameId,
            winner,
            score: [player1Wins, player2Wins],
            rounds: game.rounds
          });
          
          // РќР°С‡РёСЃР»СЏРµРј РІС‹РёРіСЂС‹С€ РїРѕР±РµРґРёС‚РµР»СЋ
          const totalBet = game.betAmount * 2;
          await this.transactionsService.processPayout(
            winner,
            totalBet,
            'dice_win'
          );
        } else {
          // РџРµСЂРµС…РѕРґРёРј Рє СЃР»РµРґСѓСЋС‰РµРјСѓ СЂР°СѓРЅРґСѓ
          game.currentRound++;
          game.currentPlayer = String(game.players[0].telegramId);
          
          console.log(`РџРµСЂРµС…РѕРґ Рє РЅРѕРІРѕРјСѓ СЂР°СѓРЅРґСѓ ${game.currentRound}, РїРµСЂРІС‹Рј С…РѕРґРёС‚ РёРіСЂРѕРє ${game.currentPlayer}`);
          
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

  // РќР°С‡Р°Р»Рѕ РёРіСЂС‹ РІ РєСѓР±РёРєРё
  async startDiceGame(gameId: string): Promise<any> {
    console.log(`Р—Р°РїСѓСЃРє РёРіСЂС‹ РІ РєРѕСЃС‚Рё СЃ ID: ${gameId}`);
    
    try {
      // РќР°С…РѕРґРёРј РёРіСЂСѓ РїРѕ ID
      const game = await this.gameModel.findById(gameId)
        .populate('players')
        .exec();
      
      if (!game) {
        throw new Error('Game not found');
      }
      
      // РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ Сѓ РёРіСЂС‹ РїСЂР°РІРёР»СЊРЅС‹Р№ С‚РёРї
      if (game.type !== 'dice') {
        throw new Error('This is not a dice game');
      }
      
      // РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РёРіСЂР° РµС‰Рµ РЅРµ Р·Р°РїСѓС‰РµРЅР°
      if (game.status === 'playing' || game.status === 'finished') {
        console.log(`РРіСЂР° ${gameId} СѓР¶Рµ Р·Р°РїСѓС‰РµРЅР° РёР»Рё Р·Р°РІРµСЂС€РµРЅР°`);
        return game;
      }
      
      // РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РїРѕРґРєР»СЋС‡РёР»РѕСЃСЊ 2 РёРіСЂРѕРєР°
      if (game.players.length !== 2) {
        console.error(`Р”Р»СЏ РЅР°С‡Р°Р»Р° РёРіСЂС‹ РЅРµРѕР±С…РѕРґРёРјРѕ 2 РёРіСЂРѕРєР°, С‚РµРєСѓС‰РµРµ РєРѕР»РёС‡РµСЃС‚РІРѕ: ${game.players.length}`);
        throw new Error('Not enough players to start the game');
      }
      
      // РћР±РЅРѕРІР»СЏРµРј СЃС‚Р°С‚СѓСЃ РёРіСЂС‹
      game.status = 'playing';
      game.currentRound = 1;
      
      // Р’С‹Р±РёСЂР°РµРј СЃР»СѓС‡Р°Р№РЅРѕРіРѕ РёРіСЂРѕРєР° РґР»СЏ РїРµСЂРІРѕРіРѕ С…РѕРґР°
      const randomPlayerIndex = Math.floor(Math.random() * 2);
      const firstPlayer = game.players[randomPlayerIndex];
      
      // РЈСЃС‚Р°РЅР°РІР»РёРІР°РµРј РїРµСЂРІРѕРіРѕ РёРіСЂРѕРєР°
      game.currentPlayer = firstPlayer.telegramId.toString();
      
      console.log(`РРіСЂР° ${gameId} СѓСЃРїРµС€РЅРѕ Р·Р°РїСѓС‰РµРЅР°. РџРµСЂРІС‹Рј С…РѕРґРёС‚ РёРіСЂРѕРє ${game.currentPlayer}`);
      
      // РЎРѕС…СЂР°РЅСЏРµРј РёР·РјРµРЅРµРЅРёСЏ РІ Р±Р°Р·Рµ РґР°РЅРЅС‹С…
      await game.save();
      
      // РћРїРѕРІРµС‰Р°РµРј РІСЃРµС… РёРіСЂРѕРєРѕРІ Рѕ РЅР°С‡Р°Р»Рµ РёРіСЂС‹
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
      console.error('РћС€РёР±РєР° РїСЂРё Р·Р°РїСѓСЃРєРµ РёРіСЂС‹ РІ РєРѕСЃС‚Рё:', error);
      throw error;
    }
  }

  // Р”РѕР±Р°РІР»СЏРµРј РјРµС‚РѕРґ getGameById РІ GameService
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

  // РњРµС‚РѕРґ РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ РёРјРµРЅРё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РїРѕ РµРіРѕ telegramId
  async getUsernameById(telegramId: string): Promise<string> {
    try {
      const user = await this.userModel.findOne({ telegramId: parseInt(telegramId) }).exec();
      return user ? user.username : 'unknown';
    } catch (error) {
      console.error(`Error getting username for telegramId ${telegramId}:`, error);
      return 'unknown';
    }
  }

  // РњРµС‚РѕРґ РґР»СЏ СѓРґР°Р»РµРЅРёСЏ РёРіСЂС‹
  async deleteGame(gameId: string, userId: number): Promise<boolean> {
    try {
      console.log(`РџРѕРїС‹С‚РєР° СѓРґР°Р»РµРЅРёСЏ РёРіСЂС‹ СЃ ID: ${gameId} РїРѕР»СЊР·РѕРІР°С‚РµР»РµРј: ${userId}`);
      
      // РќР°С…РѕРґРёРј РёРіСЂСѓ
      const game = await this.gameModel.findById(gameId).exec();
      
      if (!game) {
        console.log(`РРіСЂР° СЃ ID ${gameId} РЅРµ РЅР°Р№РґРµРЅР°`);
        throw new Error('Game not found');
      }
      
      console.log('Game found:', {
        id: game._id,
        name: game.name,
        createdBy: game.createdBy,
        userId: userId,
        players: game.players
      });
      
      // РќР°С…РѕРґРёРј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
      const user = await this.userModel.findOne({ telegramId: userId }).exec();
      
      if (!user) {
        console.log(`РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃ ID ${userId} РЅРµ РЅР°Р№РґРµРЅ`);
        throw new Error('User not found');
      }
      
      console.log('User found:', {
        id: user._id,
        telegramId: user.telegramId,
        username: user.username
      });
      
      // РџСЂРѕРІРµСЂСЏРµРј, СЏРІР»СЏРµС‚СЃСЏ Р»Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃРѕР·РґР°С‚РµР»РµРј РёРіСЂС‹
      // РЎРЅР°С‡Р°Р»Р° РїСЂРѕРІРµСЂСЏРµРј РїРѕ РїРѕР»СЋ createdBy
      let isCreator = false;
      
      if (game.createdBy) {
        isCreator = game.createdBy === userId.toString();
        console.log(`РџСЂРѕРІРµСЂРєР° РїРѕ createdBy: ${game.createdBy} === ${userId.toString()} = ${isCreator}`);
      }
      
      // Р•СЃР»Рё РЅРµС‚ РїРѕР»СЏ createdBy РёР»Рё РїСЂРѕРІРµСЂРєР° РЅРµ РїСЂРѕС€Р»Р°, РїСЂРѕРІРµСЂСЏРµРј РїРѕ РїРµСЂРІРѕРјСѓ РёРіСЂРѕРєСѓ
      if (!isCreator && game.players.length > 0) {
        isCreator = game.players[0].toString() === user._id.toString();
        console.log(`РџСЂРѕРІРµСЂРєР° РїРѕ РїРµСЂРІРѕРјСѓ РёРіСЂРѕРєСѓ: ${game.players[0].toString()} === ${user._id.toString()} = ${isCreator}`);
      }
      
      if (!isCreator) {
        console.log(`РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ ${userId} РЅРµ СЏРІР»СЏРµС‚СЃСЏ СЃРѕР·РґР°С‚РµР»РµРј РёРіСЂС‹ ${gameId}`);
        throw new Error('User is not the creator of this game');
      }
      
      // РџСЂРѕРІРµСЂСЏРµРј СЃС‚Р°С‚СѓСЃ РёРіСЂС‹ - РјРѕР¶РЅРѕ СѓРґР°Р»СЏС‚СЊ С‚РѕР»СЊРєРѕ РёРіСЂС‹ РІ СЃС‚Р°С‚СѓСЃРµ 'waiting'
      if (game.status !== 'waiting') {
        console.log(`РќРµРІРѕР·РјРѕР¶РЅРѕ СѓРґР°Р»РёС‚СЊ РёРіСЂСѓ ${gameId} РІ СЃС‚Р°С‚СѓСЃРµ ${game.status}`);
        throw new Error(`Cannot delete game in status ${game.status}`);
      }
      
      // РЈРґР°Р»СЏРµРј РёРіСЂСѓ
      await this.gameModel.findByIdAndDelete(gameId).exec();
      console.log(`РРіСЂР° ${gameId} СѓСЃРїРµС€РЅРѕ СѓРґР°Р»РµРЅР°`);
      
      // Р’РѕР·РІСЂР°С‰Р°РµРј СЃС‚Р°РІРєСѓ СЃРѕР·РґР°С‚РµР»СЋ
      if (game.betAmount > 0) {
        await this.transactionsService.refundBet(user.telegramId, game.betAmount, game.type);
        console.log(`РЎС‚Р°РІРєР° ${game.betAmount} РІРѕР·РІСЂР°С‰РµРЅР° РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ ${userId}`);
      }
      
      // Р•СЃР»Рё РµСЃС‚СЊ WebSocket СЃРµСЂРІРµСЂ, РѕС‚РїСЂР°РІР»СЏРµРј СѓРІРµРґРѕРјР»РµРЅРёРµ РѕР± СѓРґР°Р»РµРЅРёРё РёРіСЂС‹
      if (this.server) {
        this.server.emit('gameDeleted', { gameId });
      }
      
      return true;
    } catch (error) {
      console.error(`РћС€РёР±РєР° РїСЂРё СѓРґР°Р»РµРЅРёРё РёРіСЂС‹ ${gameId}:`, error);
      throw error;
    }
  }

  // Р”СЂСѓРіРёРµ РјРµС‚РѕРґС‹ РґР»СЏ СѓРїСЂР°РІР»РµРЅРёСЏ РёРіСЂР°РјРё
} 