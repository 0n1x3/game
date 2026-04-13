import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User, BaseUser } from '@game/shared';

@Schema({
  collection: 'users',
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function (doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
})
export class UserEntity implements BaseUser {
  _id: Types.ObjectId;

  @Prop({ required: true })
  telegramId: number;

  @Prop({ required: true })
  username: string;

  @Prop()
  avatarUrl?: string;

  @Prop({ default: 0 })
  balance: number;

  @Prop({ default: 1 })
  level: number;

  @Prop({ default: 0 })
  experience: number;

  @Prop({ type: [Object], default: [] })
  completedTasks?: any[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  tonWallet?: string;
}

export type UserDocument = UserEntity & Document;
export const UserSchema = SchemaFactory.createForClass(UserEntity);

// Добавляем виртуальное поле id
UserSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

// Функция для преобразования документа в User
export function toUser(doc: UserDocument): User {
  const obj = doc.toObject();
  return {
    ...obj,
    id: doc._id.toString()
  };
}
