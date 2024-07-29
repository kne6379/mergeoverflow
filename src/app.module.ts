import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { UsersModule } from './users/users.module';
import { MatchingsModule } from './matchings/matchings.module';
import { ChatRoomsModule } from './chat-rooms/chat-rooms.module';
import { NotificationsModule } from './notifications/notifications.module';
import { validationSchema } from './configs/validation.config';
import { typeOrmModuleOptions } from './configs/database.config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { mailerModuleOptions } from './configs/mailer.config';
import { SmsModule } from './auth/sms/sms.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // ConfigModule을 전역 모듈로 설정
      validationSchema: validationSchema,
    }),
    MailerModule.forRootAsync(mailerModuleOptions),
    TypeOrmModule.forRootAsync(typeOrmModuleOptions),
    AuthModule,
    UsersModule,
    MatchingsModule,
    ChatRoomsModule,
    NotificationsModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..'), // 프로젝트 루트 디렉토리를 가리키도록 설정
      serveRoot: '/', // 정적 파일의 접근 경로 설정
    }),
    SmsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
