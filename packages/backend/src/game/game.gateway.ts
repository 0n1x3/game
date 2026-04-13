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

  // РљР°СЂС‚Р° РґР»СЏ РѕС‚СЃР»РµР¶РёРІР°РЅРёСЏ Р°РєС‚РёРІРЅС‹С… РїРѕРґРєР»СЋС‡РµРЅРёР№ РїРѕ gameId
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
    // Р—РґРµСЃСЊ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ Р»РѕРіРёРєР° РїРѕР»СѓС‡РµРЅРёСЏ СЃРїРёСЃРєР° РёРіСЂ
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
      console.log(`Р—Р°РїСЂРѕСЃ РЅР° РѕР±РЅРѕРІР»РµРЅРёРµ РёРіСЂС‹ СЃ ID: ${data.gameId}`);
      
      const game = await this.gameService.getGameById(data.gameId);
      
      if (!game) {
        console.error(`РРіСЂР° СЃ ID ${data.gameId} РЅРµ РЅР°Р№РґРµРЅР°`);
        return { success: false, error: 'Game not found' };
      }
      
      // РћС‚РїСЂР°РІР»СЏРµРј РґР°РЅРЅС‹Рµ РёРіСЂС‹ РєР»РёРµРЅС‚Сѓ, РєРѕС‚РѕСЂС‹Р№ Р·Р°РїСЂРѕСЃРёР» РѕР±РЅРѕРІР»РµРЅРёРµ
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
      console.log(`РџРѕР»СѓС‡РµРЅ Р·Р°РїСЂРѕСЃ РЅР° РїРѕР»СѓС‡РµРЅРёРµ РёРіСЂРѕРєРѕРІ РґР»СЏ РёРіСЂС‹ СЃ ID: ${data.gameId}`);
      
      const game = await this.gameService.getGameById(data.gameId);
      
      if (!game) {
        console.error(`РРіСЂР° СЃ ID ${data.gameId} РЅРµ РЅР°Р№РґРµРЅР°`);
        return { success: false, error: 'Game not found' };
      }
      
      // РџРѕР»СѓС‡Р°РµРј РґР°РЅРЅС‹Рµ РёРіСЂРѕРєРѕРІ
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
      
      // РћС‚РїСЂР°РІР»СЏРµРј РёРіСЂРѕРєР°Рј
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
      console.log('РџРѕР»СѓС‡РµРЅ Р·Р°РїСЂРѕСЃ РЅР° С…РѕРґ РІ РёРіСЂРµ:', data);
      
      // РџСЂРѕРІРµСЂРєР° РЅР°Р»РёС‡РёСЏ РІСЃРµС… РЅРµРѕР±С…РѕРґРёРјС‹С… РґР°РЅРЅС‹С…
      if (!data || !data.gameId) {
        console.error('РћС‚СЃСѓС‚СЃС‚РІСѓРµС‚ gameId РІ Р·Р°РїСЂРѕСЃРµ diceMove');
        return { success: false, error: 'Missing gameId' };
      }
      
      if (data.value === undefined || data.value === null) {
        console.error('РћС‚СЃСѓС‚СЃС‚РІСѓРµС‚ Р·РЅР°С‡РµРЅРёРµ Р±СЂРѕСЃРєР° РІ Р·Р°РїСЂРѕСЃРµ diceMove');
        return { success: false, error: 'Missing dice value' };
      }
      
      if (!data.telegramId && data.telegramId !== 0) {
        console.error('РћС‚СЃСѓС‚СЃС‚РІСѓРµС‚ telegramId РІ Р·Р°РїСЂРѕСЃРµ diceMove:', data);
        return { success: false, error: 'Missing telegramId' };
      }
      
      const game = await this.gameService.getDiceGameById(data.gameId);
      
      if (!game) {
        console.error(`РРіСЂР° СЃ ID ${data.gameId} РЅРµ РЅР°Р№РґРµРЅР°`);
        return { success: false, error: 'Game not found' };
      }
      
      // РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РёРіСЂР° РІ СЃС‚Р°С‚СѓСЃРµ 'playing'
      if (game.status !== 'playing') {
        console.error(`РџРѕРїС‹С‚РєР° С…РѕРґР° РІ РёРіСЂРµ, РєРѕС‚РѕСЂР°СЏ РЅРµ РІ СЃС‚Р°С‚СѓСЃРµ playing: ${game.status}`);
        return { success: false, error: 'Game is not in playing status' };
      }
      
      // РџСЂРµРѕР±СЂР°Р·СѓРµРј telegramId РІ СЃС‚СЂРѕРєСѓ РґР»СЏ РєРѕСЂСЂРµРєС‚РЅРѕРіРѕ СЃСЂР°РІРЅРµРЅРёСЏ
      const playerTelegramId = String(data.telegramId);
      
      // РџСЂРѕРІРµСЂСЏРµРј, С‡РµР№ С…РѕРґ
      if (game.currentPlayer && game.currentPlayer !== playerTelegramId) {
        console.error(`РќРµ РІР°С€ С…РѕРґ: С‚РµРєСѓС‰РёР№ РёРіСЂРѕРє ${game.currentPlayer}, РІС‹ РїС‹С‚Р°РµС‚РµСЃСЊ С…РѕРґРёС‚СЊ РєР°Рє ${playerTelegramId}`);
        return { success: false, error: 'Not your turn' };
      }
      
      console.log(`РРіСЂРѕРє ${playerTelegramId} РІС‹РїРѕР»РЅСЏРµС‚ С…РѕРґ СЃРѕ Р·РЅР°С‡РµРЅРёРµРј ${data.value}`);
      
      try {
        // РћР±РЅРѕРІР»СЏРµРј СЃРѕСЃС‚РѕСЏРЅРёРµ РёРіСЂС‹
        const updatedGame = await this.gameService.recordDiceMove(
          data.gameId,
          data.telegramId,
          data.value
        );
        
        // РџРѕР»СѓС‡Р°РµРј РёРЅРґРµРєСЃ СЃР»РµРґСѓСЋС‰РµРіРѕ РёРіСЂРѕРєР°
        const nextPlayerIndex = updatedGame.players.findIndex(
          p => String(p.telegramId) === String(updatedGame.currentPlayer)
        );
        
        // РРјСЏ СЃР»РµРґСѓСЋС‰РµРіРѕ РёРіСЂРѕРєР°
        const nextPlayerName = nextPlayerIndex >= 0 ? 
          await this.gameService.getUsernameById(String(updatedGame.currentPlayer)) : 
          'unknown';
        
        console.log(`РҐРѕРґ РїРµСЂРµС…РѕРґРёС‚ Рє РёРіСЂРѕРєСѓ ${updatedGame.currentPlayer} (${nextPlayerName})`);
        
        // РЎРѕРѕР±С‰Р°РµРј РІСЃРµРј РїРѕРґРєР»СЋС‡РµРЅРЅС‹Рј РєР»РёРµРЅС‚Р°Рј Рѕ С…РѕРґРµ
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
        console.error('РћС€РёР±РєР° РїСЂРё РѕР±СЂР°Р±РѕС‚РєРµ С…РѕРґР°:', moveError);
        return { success: false, error: moveError.message };
      }
    } catch (error) {
      console.error('РћР±С‰Р°СЏ РѕС€РёР±РєР° РїСЂРё РѕР±СЂР°Р±РѕС‚РєРµ СЃРѕР±С‹С‚РёСЏ diceMove:', error);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('startDiceGame')
  async handleStartDiceGame(
    @MessageBody() data: { gameId: string }
  ) {
    try {
      // РЎРЅР°С‡Р°Р»Р° РїСЂРѕРІРµСЂСЏРµРј С‚РµРєСѓС‰РёР№ СЃС‚Р°С‚СѓСЃ РёРіСЂС‹
      const existingGame = await this.gameService.getGameById(data.gameId);
      
      // Р•СЃР»Рё РёРіСЂР° СѓР¶Рµ РІ РїСЂРѕС†РµСЃСЃРµ РёР»Рё Р·Р°РІРµСЂС€РµРЅР°, РЅРµ Р·Р°РїСѓСЃРєР°РµРј РµС‘ СЃРЅРѕРІР°
      if (existingGame && existingGame.status === 'playing') {
        console.log(`РРіСЂР° ${data.gameId} СѓР¶Рµ Р·Р°РїСѓС‰РµРЅР°, РїСЂРѕРїСѓСЃРєР°РµРј Р·Р°РїСЂРѕСЃ РЅР° Р·Р°РїСѓСЃРє`);
        return { 
          success: true, 
          message: 'Game is already started', 
          game: existingGame 
        };
      }
      
      if (existingGame && existingGame.status === 'finished') {
        console.log(`РРіСЂР° ${data.gameId} СѓР¶Рµ Р·Р°РІРµСЂС€РµРЅР°, РїСЂРѕРїСѓСЃРєР°РµРј Р·Р°РїСЂРѕСЃ РЅР° Р·Р°РїСѓСЃРє`);
        return { 
          success: false, 
          error: 'Game is already finished'
        };
      }
      
      // Р•СЃР»Рё РёРіСЂР° РІ СЃС‚Р°С‚СѓСЃРµ 'waiting' РёР»Рё СЃС‚Р°С‚СѓСЃ РЅРµ РѕРїСЂРµРґРµР»РµРЅ, Р·Р°РїСѓСЃРєР°РµРј РёРіСЂСѓ
      const game = await this.gameService.startDiceGame(data.gameId);
      
      console.log('РРіСЂР° СѓСЃРїРµС€РЅРѕ Р·Р°РїСѓС‰РµРЅР°, РѕС‚РїСЂР°РІР»СЏРµРј СЃРѕР±С‹С‚РёРµ diceGameStarted:', {
        gameId: data.gameId,
        firstPlayer: game.currentPlayer,
        players: game.players.map(p => ({
          telegramId: p.telegramId,
          username: p.username
        }))
      });
      
      // РСЃРїРѕР»СЊР·СѓРµРј РѕРїРµСЂР°С‚РѕСЂ РѕРїС†РёРѕРЅР°Р»СЊРЅРѕРіРѕ РґРѕСЃС‚СѓРїР° РґР»СЏ РїСЂРµРґРѕС‚РІСЂР°С‰РµРЅРёСЏ РѕС€РёР±РѕРє
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
      console.log(`РљР»РёРµРЅС‚ ${client.id} РїС‹С‚Р°РµС‚СЃСЏ РїСЂРёСЃРѕРµРґРёРЅРёС‚СЊСЃСЏ Рє РєРѕРјРЅР°С‚Рµ РёРіСЂС‹ ${gameId}`);
      
      // РџСЂРѕРІРµСЂСЏРµРј, РµСЃС‚СЊ Р»Рё РґР°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
      const userId = data.telegramId || (client.data?.user?.telegramId);
      
      if (!userId) {
        console.warn('РќРµС‚ РґР°РЅРЅС‹С… РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РІ СЃРѕРєРµС‚Рµ РёР»Рё Р·Р°РїСЂРѕСЃРµ:', client.id);
        return { success: false, error: 'РќРµ Р°РІС‚РѕСЂРёР·РѕРІР°РЅ' };
      }
      
      // РџСЂРѕР±СѓРµРј РїРѕР»СѓС‡РёС‚СЊ РёРјСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
      const username = data.username || client.data?.user?.username || 'unknown';
      
      console.log(`РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ ${username} (${userId}) РїСЂРёСЃРѕРµРґРёРЅСЏРµС‚СЃСЏ Рє РєРѕРјРЅР°С‚Рµ ${gameId}`);
      
      // РџСЂРѕРІРµСЂСЏРµРј, СЃСѓС‰РµСЃС‚РІСѓРµС‚ Р»Рё РёРіСЂР°
      const game = await this.gameService.getGameById(gameId);
      if (!game) {
        console.error(`РРіСЂР° СЃ ID ${gameId} РЅРµ РЅР°Р№РґРµРЅР°`);
        return { success: false, error: 'РРіСЂР° РЅРµ РЅР°Р№РґРµРЅР°' };
      }
      
      // РџСЂРёСЃРѕРµРґРёРЅСЏРµРј РєР»РёРµРЅС‚Р° Рє РєРѕРјРЅР°С‚Рµ РёРіСЂС‹
      await client.join(`game_${gameId}`);
      console.log(`РљР»РёРµРЅС‚ ${client.id} СѓСЃРїРµС€РЅРѕ РїСЂРёСЃРѕРµРґРёРЅРёР»СЃСЏ Рє РєРѕРјРЅР°С‚Рµ game_${gameId}`);
      
      // РћР±РЅРѕРІР»СЏРµРј РґР°РЅРЅС‹Рµ РєР»РёРµРЅС‚Р°
      client.data = {
        ...client.data,
        user: {
          telegramId: userId,
          username
        },
        gameId
      };
      
      // РћС‚РїСЂР°РІР»СЏРµРј С‚РµРєСѓС‰РµРµ СЃРѕСЃС‚РѕСЏРЅРёРµ РёРіСЂС‹ 
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
      
      // РџСЂРѕРІРµСЂСЏРµРј, СЏРІР»СЏРµС‚СЃСЏ Р»Рё РєР»РёРµРЅС‚ РёРіСЂРѕРєРѕРј РІ СЌС‚РѕР№ РёРіСЂРµ
      const isPlayerInGame = game.players.some(p => String(p.telegramId) === String(userId));
      
      if (!isPlayerInGame && game.status === 'waiting') {
        console.log(`РРіСЂРѕРє ${userId} РЅРµ РїСЂРёСЃРѕРµРґРёРЅРµРЅ Рє РёРіСЂРµ, РїСЂРѕР±СѓРµРј РїСЂРёСЃРѕРµРґРёРЅРёС‚СЊ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё`);
        
        try {
          // РќР°С…РѕРґРёРј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
          const user = await this.gameService.validateUser(Number(userId));
          if (user) {
            // РџСЂРёСЃРѕРµРґРёРЅСЏРµРј Рє РёРіСЂРµ
            await this.gameService.joinGame(gameId, user);
            console.log(`РРіСЂРѕРє ${username} (${userId}) СѓСЃРїРµС€РЅРѕ РїСЂРёСЃРѕРµРґРёРЅРµРЅ Рє РёРіСЂРµ ${gameId}`);
          }
        } catch (joinError) {
          console.error(`РћС€РёР±РєР° РїСЂРё РїСЂРёСЃРѕРµРґРёРЅРµРЅРёРё РёРіСЂРѕРєР° ${userId} Рє РёРіСЂРµ:`, joinError);
        }
      }
      
      // РћР±РЅРѕРІР»СЏРµРј СЃС‚Р°С‚СѓСЃ РїРѕРґРєР»СЋС‡РµРЅРёСЏ РґР»СЏ РІСЃРµС… РєР»РёРµРЅС‚РѕРІ РІ РєРѕРјРЅР°С‚Рµ
      this.updateConnectionStatus(gameId);
      
      return { success: true };
    } catch (error) {
      console.error('РћС€РёР±РєР° РїСЂРё РїСЂРёСЃРѕРµРґРёРЅРµРЅРёРё Рє РєРѕРјРЅР°С‚Рµ РёРіСЂС‹:', error);
      return { success: false, error: error.message };
    }
  }

  // РћР±СЂР°Р±РѕС‚С‡РёРє РїРѕРґРєР»СЋС‡РµРЅРёСЏ РєР»РёРµРЅС‚Р°
  handleConnection(client: Socket) {
    try {
      console.log(`РќРѕРІРѕРµ WebSocket СЃРѕРµРґРёРЅРµРЅРёРµ: ${client.id}`);
      
      // РџРѕР»СѓС‡Р°РµРј РїР°СЂР°РјРµС‚СЂС‹ РёР· Р·Р°РїСЂРѕСЃР°
      const { telegramId, gameId } = client.handshake.query;
      
      if (!telegramId || !gameId) {
        console.warn(`РЎРѕРµРґРёРЅРµРЅРёРµ Р±РµР· РЅРµРѕР±С…РѕРґРёРјС‹С… РїР°СЂР°РјРµС‚СЂРѕРІ: ${client.id}, РїР°СЂР°РјРµС‚СЂС‹:`, client.handshake.query);
        return;
      }
      
      // РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ telegramId СЏРІР»СЏРµС‚СЃСЏ СЃС‚СЂРѕРєРѕР№/С‡РёСЃР»РѕРј
      const userTelegramId = typeof telegramId === 'string' 
        ? telegramId 
        : Array.isArray(telegramId) ? telegramId[0] : null;
      
      if (!userTelegramId) {
        console.error(`РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ С„РѕСЂРјР°С‚ telegramId:`, telegramId);
        return;
      }
      
      // РџСЂРµРѕР±СЂР°Р·СѓРµРј gameId РІ СЃС‚СЂРѕРєСѓ
      const gameIdStr = typeof gameId === 'string' 
        ? gameId 
        : Array.isArray(gameId) ? gameId[0] : null;
      
      if (!gameIdStr) {
        console.error(`РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ С„РѕСЂРјР°С‚ gameId:`, gameId);
        return;
      }
      
      console.log(`РђСѓС‚РµРЅС‚РёС„РёС†РёСЂРѕРІР°РЅРЅС‹Р№ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ: ${userTelegramId}`);
      
      // РЎРѕС…СЂР°РЅСЏРµРј РґР°РЅРЅС‹Рµ СЃРѕРµРґРёРЅРµРЅРёСЏ
      client.data = { 
        ...client.data,
        user: { telegramId: userTelegramId },
        gameId: gameIdStr
      };
      
      // РћР±РЅРѕРІР»СЏРµРј СЃС‚Р°С‚СѓСЃ РїРѕРґРєР»СЋС‡РµРЅРёСЏ РґР»СЏ РёРіСЂС‹
      this.updateConnectionStatus(gameIdStr);
    } catch (error) {
      console.error('РћС€РёР±РєР° РїСЂРё РѕР±СЂР°Р±РѕС‚РєРµ РЅРѕРІРѕРіРѕ СЃРѕРµРґРёРЅРµРЅРёСЏ:', error);
    }
  }

  // РћР±СЂР°Р±РѕС‚С‡РёРє РѕС‚РєР»СЋС‡РµРЅРёСЏ РєР»РёРµРЅС‚Р°
  handleDisconnect(client: Socket) {
    try {
      console.log(`WebSocket СЃРѕРµРґРёРЅРµРЅРёРµ Р·Р°РєСЂС‹С‚Рѕ: ${client.id}`);
      
      // РџРѕР»СѓС‡Р°РµРј gameId РёР· РґР°РЅРЅС‹С… РєР»РёРµРЅС‚Р°
      const gameId = client.data?.gameId;
      
      if (!gameId) {
        console.log(`РЎРѕРµРґРёРЅРµРЅРёРµ Р±РµР· gameId Р·Р°РєСЂС‹С‚Рѕ: ${client.id}`);
        return;
      }
      
      // РћР±РЅРѕРІР»СЏРµРј СЃС‚Р°С‚СѓСЃ РїРѕРґРєР»СЋС‡РµРЅРёСЏ
      this.updateConnectionStatus(gameId);
    } catch (error) {
      console.error('РћС€РёР±РєР° РїСЂРё РѕР±СЂР°Р±РѕС‚РєРµ РѕС‚РєР»СЋС‡РµРЅРёСЏ:', error);
    }
  }

  // РњРµС‚РѕРґ РґР»СЏ РѕС‚РїСЂР°РІРєРё РѕР±РЅРѕРІР»РµРЅРёСЏ Рѕ СЃС‚Р°С‚СѓСЃРµ РїРѕРґРєР»СЋС‡РµРЅРёСЏ
  private async updateConnectionStatus(gameId: string) {
    try {
      // РџРѕР»СѓС‡Р°РµРј РєРѕР»РёС‡РµСЃС‚РІРѕ РєР»РёРµРЅС‚РѕРІ РІ РєРѕРјРЅР°С‚Рµ
      const room = await this.server.in(`game_${gameId}`).fetchSockets();
      const connectedClients = room.length;
      
      console.log(`РћР±РЅРѕРІР»РµРЅРёРµ СЃС‚Р°С‚СѓСЃР° РїРѕРґРєР»СЋС‡РµРЅРёСЏ РґР»СЏ РёРіСЂС‹ ${gameId}: ${connectedClients} Р°РєС‚РёРІРЅС‹С… РєР»РёРµРЅС‚РѕРІ`);
      
      // РћС‚РїСЂР°РІР»СЏРµРј РІСЃРµРј РєР»РёРµРЅС‚Р°Рј РІ РєРѕРјРЅР°С‚Рµ РѕР±РЅРѕРІР»РµРЅРЅС‹Р№ СЃС‚Р°С‚СѓСЃ РїРѕРґРєР»СЋС‡РµРЅРёСЏ
      this.server.to(`game_${gameId}`).emit('connectionStatus', {
        gameId,
        connectedClients,
        timestamp: Date.now()
      });
      
      return connectedClients;
    } catch (error) {
      console.error(`РћС€РёР±РєР° РїСЂРё РѕР±РЅРѕРІР»РµРЅРёРё СЃС‚Р°С‚СѓСЃР° РїРѕРґРєР»СЋС‡РµРЅРёСЏ РґР»СЏ РёРіСЂС‹ ${gameId}:`, error);
      return 0;
    }
  }
} 
