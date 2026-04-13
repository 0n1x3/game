import { Schema, SchemaFactory, Prop } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';
import { UserDocument } from './user.schema';
import { createTelegramGameLink } from '../config/runtime';

@Schema()
export class Lobby extends Document {
  @Prop({ index: true })
  status: string;
  
  @Prop({ index: true })
  gameType: string;
}

export const LobbySchema = SchemaFactory.createForClass(Lobby);

@Schema({ timestamps: true })
export class Game extends Document {
  @Prop({ 
    required: true,
    default: function(this: Game) {
      return `Game #${this._id}`;
    }
  })
  name: string;

  @Prop({ 
    type: String, 
    enum: ['rps', 'dice'],
    required: true 
  })
  type: string;

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] })
  players: UserDocument[];

  @Prop({ required: true })
  betAmount: number;

  @Prop({ 
    type: String, 
    enum: ['waiting', 'playing', 'finished'],
    default: 'waiting'
  })
  status: string;

  @Prop()
  currentPlayer: string;

  @Prop({ type: Number, default: 0 })
  currentRound: number;

  @Prop()
  rounds?: Array<{
    player1: number;
    player2: number;
    result: 'win' | 'lose' | 'draw';
  }>;

  @Prop({ type: String })
  createdBy: string;

  @Prop({ 
    type: String,
    required: true,
    default: function() {
      return createTelegramGameLink(this._id.toString());
    }
  })
  inviteLink: string;
}

export const GameSchema = SchemaFactory.createForClass(Game); 
