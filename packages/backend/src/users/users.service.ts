import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserEntity, UserDocument, toUser } from '../schemas/user.schema';
import { User } from '@game/shared';
import { TasksService } from '../tasks/tasks.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(UserEntity.name) private userModel: Model<UserDocument>,
    private tasksService: TasksService
  ) {}

  async findOrCreate(telegramData: {
    id: number;
    username: string;
    photoUrl?: string;
  }): Promise<User> {
    let user = await this.userModel.findOne({ telegramId: telegramData.id });
    
    if (!user) {
      user = new this.userModel({
        telegramId: telegramData.id,
        username: telegramData.username,
        avatarUrl: telegramData.photoUrl,
        isActive: true
      });
      await user.save();
    }

    return toUser(user);
  }

  async updateTonWallet(telegramId: number, wallet: string): Promise<User> {
    const user = await this.userModel.findOneAndUpdate(
      { telegramId },
      { tonWallet: wallet },
      { new: true }
    );
    return toUser(user);
  }

  async createOrUpdateUser(userData: {
    telegramId: number;
    username: string;
    avatarUrl?: string;
  }): Promise<User> {
    const { telegramId, username, avatarUrl } = userData;

    try {
      const existingUser = await this.userModel.findOne({ telegramId });

      if (existingUser) {
        const updated = await this.userModel.findOneAndUpdate(
          { telegramId },
          { 
            username,
            isActive: true
          },
          { new: true }
        );
        return toUser(updated);
      } else {
        const newUser = await this.userModel.create({
          telegramId,
          username,
          avatarUrl,
          balance: 0,
          level: 1,
          experience: 0,
          completedTasks: [],
          isActive: true
        });
        
        await this.tasksService.initDefaultTasks();
        return toUser(newUser);
      }
    } catch (error) {
      console.error('Error in createOrUpdateUser:', error);
      throw error;
    }
  }

  async updateAvatar(telegramId: number, avatarUrl: string): Promise<User> {
    const user = await this.userModel.findOneAndUpdate(
      { telegramId },
      { avatarUrl },
      { new: true }
    );
    return toUser(user);
  }

  async initUser(telegramId: number, username: string): Promise<User> {
    const existingUser = await this.userModel.findOne({ telegramId });
    if (existingUser) return toUser(existingUser);

    const newUser = await this.userModel.create({
      telegramId,
      username,
      level: 1,
      experience: 0,
      balance: 0,
      completedTasks: [],
      isActive: true
    });
    return toUser(newUser);
  }

  async deleteUser(telegramId: number): Promise<void> {
    await this.userModel.deleteOne({ telegramId });
  }

  async findByTelegramId(telegramId: number): Promise<UserDocument | null> {
    return this.userModel.findOne({ telegramId }).exec();
  }
}