import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PreferredGender } from '../types/preferred-gender.type';
import { PreferredRegion } from '../types/preferred-region.type';
import { PreferredBodyShape } from '../types/preferred-body-shape.type';
import { PreferredReligion } from '../types/preferred-religion.type';
import { PreferredFrequency } from '../types/preferred-frequency.type';
import { PreferredAgeGap } from '../types/preferred-age-gap.type';
import { PreferredCodingLevel } from '../types/preferred-coding-level.type';
import { PreferredHeight } from '../types/preferred-height.type';

@Entity({ name: 'matching_preferences' })
export class MatchingPreferences {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: PreferredCodingLevel, nullable: true })
  codingLevel: PreferredCodingLevel;

  @Column({ type: 'enum', enum: PreferredGender, nullable: true })
  gender: PreferredGender;

  @Column({ type: 'enum', enum: PreferredRegion, nullable: true })
  region: PreferredRegion;

  @Column({ type: 'enum', enum: PreferredAgeGap, nullable: true })
  ageGap: PreferredAgeGap;

  @Column({ type: 'enum', enum: PreferredHeight, nullable: true })
  height: PreferredHeight;

  @Column({ type: 'enum', enum: PreferredBodyShape, nullable: true })
  bodyShape: PreferredBodyShape;

  @Column({ type: 'enum', enum: PreferredFrequency, nullable: true })
  smokingFrequency: PreferredFrequency;

  @Column({ type: 'enum', enum: PreferredFrequency, nullable: true })
  drinkingFrequency: PreferredFrequency;

  @Column({ type: 'enum', enum: PreferredReligion, nullable: true })
  religion: PreferredReligion;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.matchingPreferences, { nullable: false })
  user: User;
}