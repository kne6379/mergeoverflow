import { User } from '../../users/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Entity,
} from 'typeorm';
import { InteractionType } from '../types/interaction-type.type';
import { IsEnum, IsInt, IsNotEmpty, IsOptional } from 'class-validator';

@Entity({ name: 'matchings' })
export class Matching {
  @PrimaryGeneratedColumn()
  id: number;

  @IsNotEmpty()
  @IsInt()
  @Column({ type: 'int' })
  userId: number;

  @IsNotEmpty()
  @IsInt()
  @Column({ type: 'int' })
  targetUserId: number;

  @IsOptional()
  @IsEnum(InteractionType)
  @Column({ type: 'enum', enum: InteractionType, nullable: true })
  interactionType: InteractionType;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.matchings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: User;
}
