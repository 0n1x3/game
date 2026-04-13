import { Controller, Post, Body, Get, Query, Headers, Param, NotFoundException, Delete } from '@nestjs/common';
import { GameService } from './game.service';
import { GameType } from '@game/shared';
import { UsersService } from '../users/users.service';
import { createTelegramGameLink } from '../config/runtime';

@Controller('games')
export class GameController {
  constructor(
    private gameService: GameService,
    private usersService: UsersService
  ) {}

  @Get('list')
  async getGames(@Query('type') gameType: GameType) {
    const games = await this.gameService.getActiveGames(gameType);
    return { games };
  }

  @Post('create')
  async createGame(@Body() data: { 
    type: GameType; 
    betAmount: number;
    initData: string;
  }) {
    try {
      // РџР°СЂСЃРёРј РґР°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РёР· initData
      const params = new URLSearchParams(data.initData);
      const userStr = params.get('user');
      
      if (!userStr) {
        throw new Error('No user data found');
      }

      const userData = JSON.parse(decodeURIComponent(userStr));
      const user = await this.usersService.findByTelegramId(userData.id);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const game = await this.gameService.createGame(data.type, user, data.betAmount);

      return { 
        success: true,
        game,
        inviteLink: createTelegramGameLink(game._id.toString())
      };
    } catch (error) {
      console.error('Error creating game:', error);
      throw error;
    }
  }

  @Post('join')
  async joinGame(@Body() data: { gameId: string; initData: string }) {
    try {
      console.log('РџРѕР»СѓС‡РµРЅ Р·Р°РїСЂРѕСЃ РЅР° РїСЂРёСЃРѕРµРґРёРЅРµРЅРёРµ Рє РёРіСЂРµ:', data.gameId);
      
      // РџР°СЂСЃРёРј gameId РёР· С„РѕСЂРјР°С‚Р° game_<id>
      const gameId = data.gameId.startsWith('game_') 
        ? data.gameId.substring(5) 
        : data.gameId;
      
      console.log('РћР±СЂР°Р±РѕС‚Р°РЅРЅС‹Р№ ID РёРіСЂС‹:', gameId);
      
      // РџР°СЂСЃРёРј РґР°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
      const params = new URLSearchParams(data.initData);
      const userStr = params.get('user');
      
      if (!userStr) {
        console.error('Р”Р°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РЅРµ РЅР°Р№РґРµРЅС‹ РІ initData');
        throw new Error('No user data found');
      }

      const userData = JSON.parse(decodeURIComponent(userStr));
      console.log('Р”Р°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ:', { id: userData.id, username: userData.username });
      
      const user = await this.usersService.findByTelegramId(userData.id);
      
      if (!user) {
        console.error(`РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃ ID ${userData.id} РЅРµ РЅР°Р№РґРµРЅ`);
        throw new NotFoundException('User not found');
      }
      
      console.log(`РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅР°Р№РґРµРЅ: ${user.username}, ID: ${user._id}`);

      // РџСЂРёСЃРѕРµРґРёРЅСЏРµРј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ Рє РёРіСЂРµ
      const game = await this.gameService.joinGame(gameId, user);
      console.log('РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СѓСЃРїРµС€РЅРѕ РїСЂРёСЃРѕРµРґРёРЅРёР»СЃСЏ Рє РёРіСЂРµ');
      
      return { success: true, game };
    } catch (error) {
      console.error('РћС€РёР±РєР° РїСЂРё РїСЂРёСЃРѕРµРґРёРЅРµРЅРёРё Рє РёРіСЂРµ:', error);
      throw error;
    }
  }

  @Get('active')
  async getActiveGames(@Query('type') type: GameType) {
    try {
      const games = await this.gameService.getActiveGames(type);
      console.log('Active games in controller:', games.map(game => ({
        id: game._id,
        name: game.name,
        createdBy: game.createdBy,
        players: game.players.length
      })));
      return { success: true, games };
    } catch (error) {
      console.error('Error getting active games:', error);
      throw error;
    }
  }

  @Get(':id')
  async getGameById(@Param('id') id: string) {
    try {
      console.log(`РџРѕР»СѓС‡РµРЅ Р·Р°РїСЂРѕСЃ РЅР° РїРѕР»СѓС‡РµРЅРёРµ РёРіСЂС‹ СЃ ID: ${id}`);
      const game = await this.gameService.getGameById(id);
      
      if (!game) {
        throw new NotFoundException('РРіСЂР° РЅРµ РЅР°Р№РґРµРЅР°');
      }
      
      return { success: true, game };
    } catch (error) {
      console.error('РћС€РёР±РєР° РїСЂРё РїРѕР»СѓС‡РµРЅРёРё РёРіСЂС‹:', error);
      throw error;
    }
  }

  @Post('start')
  async startGame(@Body() data: { gameId: string; initData: string }) {
    try {
      console.log(`РџРѕР»СѓС‡РµРЅ Р·Р°РїСЂРѕСЃ РЅР° СЃС‚Р°СЂС‚ РёРіСЂС‹ СЃ ID: ${data.gameId}`);
      
      // РџР°СЂСЃРёРј РґР°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РёР· initData
      const params = new URLSearchParams(data.initData);
      const userStr = params.get('user');
      
      if (!userStr) {
        throw new Error('No user data found');
      }
      
      const userData = JSON.parse(decodeURIComponent(userStr));
      const user = await this.usersService.findByTelegramId(userData.id);
      
      if (!user) {
        throw new NotFoundException('User not found');
      }
      
      // РџСЂРѕРІРµСЂСЏРµРј, РµСЃС‚СЊ Р»Рё Сѓ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РїСЂР°РІР° РЅР° СЃС‚Р°СЂС‚ РёРіСЂС‹ (РѕРЅ РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РёРіСЂРѕРєРѕРј)
      const game = await this.gameService.getGameById(data.gameId);
      
      if (!game) {
        throw new NotFoundException('Game not found');
      }
      
      const isPlayer = game.players.some(
        playerId => playerId.toString() === user._id.toString()
      );
      
      if (!isPlayer) {
        throw new Error('User is not a player in this game');
      }
      
      // Р—Р°РїСѓСЃРєР°РµРј РёРіСЂСѓ
      const startedGame = await this.gameService.startDiceGame(data.gameId);
      
      return { success: true, game: startedGame };
    } catch (error) {
      console.error('РћС€РёР±РєР° РїСЂРё СЃС‚Р°СЂС‚Рµ РёРіСЂС‹:', error);
      throw error;
    }
  }

  @Delete(':id')
  async deleteGame(
    @Param('id') id: string,
    @Body() data: { initData: string }
  ) {
    try {
      console.log(`РџРѕР»СѓС‡РµРЅ Р·Р°РїСЂРѕСЃ РЅР° СѓРґР°Р»РµРЅРёРµ РёРіСЂС‹ СЃ ID: ${id}`);
      
      // РџР°СЂСЃРёРј РґР°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РёР· initData
      const params = new URLSearchParams(data.initData);
      const userStr = params.get('user');
      
      if (!userStr) {
        throw new Error('No user data found');
      }
      
      const userData = JSON.parse(decodeURIComponent(userStr));
      const user = await this.usersService.findByTelegramId(userData.id);
      
      if (!user) {
        throw new NotFoundException('User not found');
      }
      
      // РЈРґР°Р»СЏРµРј РёРіСЂСѓ
      const result = await this.gameService.deleteGame(id, userData.id);
      
      return { success: result };
    } catch (error) {
      console.error('РћС€РёР±РєР° РїСЂРё СѓРґР°Р»РµРЅРёРё РёРіСЂС‹:', error);
      throw error;
    }
  }
} 
