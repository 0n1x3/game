import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TelegramBot from 'node-telegram-bot-api';
import { v4 as uuid } from 'uuid';

@Injectable()
export class BotService implements OnModuleInit {
  private bot: TelegramBot;
  private readonly appName: string;

  constructor(private configService: ConfigService) {
    const token = this.configService.get<string>('BOT_TOKEN');
    if (!token) {
      console.error('BOT_TOKEN is not set in environment variables');
      throw new Error('BOT_TOKEN is required');
    }

    this.appName = this.configService.get<string>('APP_NAME') || 'Game';

    console.log('Initializing bot with token:', {
      first10: token.substring(0, 10),
      length: token.length
    });
    
    try {
      this.bot = new TelegramBot(token, { polling: true });
      
      // Проверяем токен сразу при создании
      this.bot.getMe().then(
        info => {
          console.log('Bot initialized successfully:', {
            id: info.id,
            username: info.username,
            first_name: info.first_name,
            is_bot: info.is_bot
          });
        },
        error => {
          console.error('Failed to initialize bot:', error.message);
          throw error;
        }
      );
    } catch (error) {
      console.error('Error creating bot instance:', error);
      throw error;
    }
  }

  onModuleInit() {
    // Перенесем логику из старого бота
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      this.bot.sendMessage(chatId, `Привет! Я бот проекта ${this.appName}. Что дальше?`);
    });

    this.bot.on('message', (msg) => {
      const chatId = msg.chat.id;
      if (!msg.text?.startsWith('/')) {
        this.bot.sendMessage(chatId, `Вы написали: ${msg.text}`);
      }
    });

    console.log('Бот запущен...');
  }

  // Методы для отправки уведомлений
  async sendNotification(userId: number, message: string) {
    return this.bot.sendMessage(userId, message);
  }

  // Добавить обработку инвайтов
  async handleInvite(inviterId: number, inviteeId: number) {
    const invite = { id: uuid(), inviterId, createdAt: Date.now() };
    const inviteLink = `${process.env.FRONTEND_URL}/join/${invite.id}`;
    await this.bot.sendMessage(inviteeId, `Приглашение в игру: ${inviteLink}`);
    return invite;
  }
} 
