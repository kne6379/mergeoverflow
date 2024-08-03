import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection } from 'typeorm';
import { Account } from './entities/account.entity';
import { SmsService } from './sms/sms.service';
import { RedisService } from '../redis/redis.service';
import { SignUpDto } from './dto/sign-up.dto';
import { User } from '../users/entities/user.entity';
import { UserToInterest } from '../users/entities/user-to-interest.entity';
import { UserToTech } from '../users/entities/user-to-tech.entity';
import { plainToClass } from 'class-transformer';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcrypt';
import { SignInDto } from './dto/sign-in.dto';
import { CODE_TTL, IMAGE_LIMIT, MAX_INTERESTS, MAX_TECHS, MIN_INTERESTS, MIN_TECHS } from './constants/auth.constants';
import { ProfileImage } from 'src/images/entities/profile-image.entity';
import { Heart } from 'src/matchings/entities/heart.entity';
import { RESET_HEART_COUNT } from 'src/matchings/constants/constants';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly smsService: SmsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly connection: Connection,
  ) {}

  async sendSmsForVerification(phoneNum: string) {
    const foundAccount = await this.accountRepository.findOne({ where: { phoneNum } });

    if (foundAccount) {
      throw new ConflictException('이미 존재하는 전화번호입니다.');
    }

    return await this.smsService.sendSmsForVerification(phoneNum);
  }

  async verifyCode(phoneNum: string, code: string) {
    const storedPhoneNum = await this.redisService.get(code);
    if (storedPhoneNum !== phoneNum) {
      throw new NotFoundException('잘못된 인증번호입니다.');
    }

    // 인증된 전화번호를 Redis에 저장 (유효기간 설정)
    await this.redisService.setWithTTL(`verified_${phoneNum}`, phoneNum, CODE_TTL);

    return { message: '인증 성공' };
  }

  async signUp(signUpDto: SignUpDto) {
    const { phoneNum, password, interests, techs, profileImageUrls, ...userData } = signUpDto;

    // 전화번호 인증 확인
    const verifiedPhoneNum = await this.redisService.get(`verified_${phoneNum}`);
    if (!verifiedPhoneNum) {
      throw new BadRequestException('전화번호 인증이 필요합니다.');
    }

    // 전화번호 중복 확인
    const existingAccount = await this.accountRepository.findOne({ where: { phoneNum } });
    if (existingAccount) {
      throw new ConflictException('이미 존재하는 전화번호입니다.');
    }

    // 비밀번호 해싱
    const hashRounds = Number(this.configService.get('HASH_ROUNDS'));
    const hashedPassword = await hash(password, hashRounds);

    // interests와 techs를 별도로 선언하여 문자열인 경우 배열로 변환
    const parsedInterests =
      typeof signUpDto.interests === 'string' ? JSON.parse(signUpDto.interests) : signUpDto.interests;
    const parsedTechs = typeof signUpDto.techs === 'string' ? JSON.parse(signUpDto.techs) : signUpDto.techs;

    // profileImageUrls 검증
    if (profileImageUrls.length > IMAGE_LIMIT) {
      throw new BadRequestException(`이미지 URL은 최대 ${IMAGE_LIMIT}개까지 입력 가능합니다.`);
    }

    // 트랜잭션 시작
    const queryRunner = this.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Account 생성 및 저장
      const account = new Account();
      account.password = hashedPassword;
      account.phoneNum = phoneNum;

      const savedAccount = await queryRunner.manager.save(account);

      // User 데이터 생성
      if (parsedInterests.length < MIN_INTERESTS || parsedInterests.length > MAX_INTERESTS) {
        throw new BadRequestException(`관심사는 최소 ${MIN_INTERESTS}개, 최대 ${MAX_INTERESTS}개 선택해야 합니다.`);
      }

      if (parsedTechs.length < MIN_TECHS || parsedTechs.length > MAX_TECHS) {
        throw new BadRequestException(`기술 스택은 최소 ${MIN_TECHS}개, 최대 ${MAX_TECHS}개 선택해야 합니다.`);
      }

      const user = plainToClass(User, userData);
      user.accountId = savedAccount.id;
      const savedUser = await queryRunner.manager.save(user);

      // UserToInterest 생성
      const userToInterests = parsedInterests.map((interestId) => {
        const userToInterest = new UserToInterest();
        userToInterest.userId = savedUser.id;
        userToInterest.interestId = interestId;
        return userToInterest;
      });
      await queryRunner.manager.save(userToInterests);

      // UserToTech 생성
      const userToTechs = parsedTechs.map((techId) => {
        const userToTech = new UserToTech();
        userToTech.userId = savedUser.id;
        userToTech.techId = techId;
        return userToTech;
      });
      await queryRunner.manager.save(userToTechs);

      // ProfileImage 생성
      if (profileImageUrls && profileImageUrls.length > 0) {
        const userProfileImages = profileImageUrls.map((url) => {
          const userProfileImage = new ProfileImage();
          userProfileImage.userId = savedUser.id;
          userProfileImage.imageUrl = url;
          return userProfileImage;
        });
        await queryRunner.manager.save(userProfileImages);
      }

      // Heart 데이터 생성 및 저장
      const heart = new Heart();
      heart.userId = savedUser.id;
      heart.remainHearts = RESET_HEART_COUNT;
      await queryRunner.manager.save(heart);

      await queryRunner.commitTransaction();
      return { message: '회원가입 성공' };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async socialSignIn(req: any, res: any): Promise<void> {
    try {
      const { provider, providerId } = req.user;

      let account = await this.accountRepository.findOne({ where: { provider, providerId }, relations: ['user'] });

      if (!account) {
        // 계정 생성
        account = new Account();
        account.provider = provider;
        account.providerId = providerId;
        await this.accountRepository.save(account);

        // 사용자 생성
        const user = new User();
        user.account = account;

        await this.userRepository.save(user);
      }

      const payload = { id: account.user.id, provider: account.provider };
      const accessToken = this.jwtService.sign(payload, {
        secret: this.configService.get<string>('ACCESS_TOKEN_SECRET_KEY'),
        expiresIn: this.configService.get<string>('ACCESS_TOKEN_EXPIRED_IN'),
      });
      const refreshToken = this.jwtService.sign(payload, {
        secret: this.configService.get<string>('REFRESH_TOKEN_SECRET_KEY'),
        expiresIn: this.configService.get<string>('REFRESH_TOKEN_EXPIRED_IN'),
      });

      res.json({ accessToken, refreshToken });
    } catch (error) {
      throw new UnauthorizedException('Login failed.');
    }
  }

  async completeSignUp(signUpDto: SignUpDto) {
    let { phoneNum, interests, techs, profileImageUrls, ...userData } = signUpDto;

    // interests와 techs를 별도로 선언하여 문자열인 경우 배열로 변환
    const parsedInterests =
      typeof signUpDto.interests === 'string' ? JSON.parse(signUpDto.interests) : signUpDto.interests;
    const parsedTechs = typeof signUpDto.techs === 'string' ? JSON.parse(signUpDto.techs) : signUpDto.techs;

    // profileImageUrls 검증
    if (profileImageUrls.length > IMAGE_LIMIT) {
      throw new BadRequestException(`이미지 URL은 최대 ${IMAGE_LIMIT}개까지 입력 가능합니다.`);
    }

    // 트랜잭션 시작
    const queryRunner = this.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Account 생성 및 저장
      const account = new Account();
      account.provider = 'social';

      const savedAccount = await queryRunner.manager.save(account);

      // User 데이터 생성
      if (parsedInterests.length < MIN_INTERESTS || parsedInterests.length > MAX_INTERESTS) {
        throw new BadRequestException(`관심사는 최소 ${MIN_INTERESTS}개, 최대 ${MAX_INTERESTS}개 선택해야 합니다.`);
      }

      if (parsedTechs.length < MIN_TECHS || parsedTechs.length > MAX_TECHS) {
        throw new BadRequestException(`기술 스택은 최소 ${MIN_TECHS}개, 최대 ${MAX_TECHS}개 선택해야 합니다.`);
      }

      const user = plainToClass(User, userData);
      user.accountId = savedAccount.id;
      const savedUser = await queryRunner.manager.save(user);

      // UserToInterest 생성
      const userToInterests = parsedInterests.map((interestId) => {
        const userToInterest = new UserToInterest();
        userToInterest.userId = savedUser.id;
        userToInterest.interestId = interestId;
        return userToInterest;
      });
      await queryRunner.manager.save(userToInterests);

      // UserToTech 생성
      const userToTechs = parsedTechs.map((techId) => {
        const userToTech = new UserToTech();
        userToTech.userId = savedUser.id;
        userToTech.techId = techId;
        return userToTech;
      });
      await queryRunner.manager.save(userToTechs);

      // ProfileImage 생성
      if (profileImageUrls && profileImageUrls.length > 0) {
        const userProfileImages = profileImageUrls.map((url) => {
          const userProfileImage = new ProfileImage();
          userProfileImage.userId = savedUser.id;
          userProfileImage.imageUrl = url;
          return userProfileImage;
        });
        await queryRunner.manager.save(userProfileImages);
      }

      // Heart 데이터 생성 및 저장
      const heart = new Heart();
      heart.userId = savedUser.id;
      heart.remainHearts = RESET_HEART_COUNT;
      await queryRunner.manager.save(heart);

      await queryRunner.commitTransaction();
      return { message: '추가 회원가입 성공' };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async validateUser(signInDto: SignInDto) {
    const { phoneNum, password } = signInDto;
    const account = await this.accountRepository.findOne({ where: { phoneNum }, relations: ['user'] });
    if (account && (await compare(password, account.password))) {
      return account.user;
    }
    return null;
  }

  async validateUserById(userId: number) {
    const user = await this.userRepository.findOne({ where: { id: userId }, relations: ['account'] });
    if (user) {
      return user;
    }
    return null;
  }

  async validateSocialUser(provider: string, providerId: string) {
    const account = await this.accountRepository.findOne({ where: { provider, providerId }, relations: ['user'] });
    return account ? account.user : null;
  }

  async signIn(userId: number, phoneNum: string) {
    const payload = { id: userId, phoneNum };

    // 토큰 발급
    const tokens = await this.issueTokens(payload);
    const hashRounds = Number(this.configService.get('HASH_ROUNDS'));
    const hashedRefreshToken = await hash(tokens.refreshToken, hashRounds);

    // Redis에 리프레시 토큰 저장 (기존 토큰을 덮어씀)
    await this.redisService.set(`refresh_token_${userId}`, hashedRefreshToken);

    return tokens;
  }

  async signOut(userId: number) {
    // redis에서 로그인 여부 확인
    const token = await this.redisService.get(`refresh_token_${userId}`);
    if (!token) {
      throw new NotFoundException('로그인한 기록이 없습니다.');
    }

    // Redis에서 Refresh Token 삭제
    await this.redisService.del(`refresh_token_${userId}`);
  }

  async renewTokens(refreshToken: string) {
    const decoded = this.jwtService.verify(refreshToken, {
      secret: this.configService.get<string>('REFRESH_TOKEN_SECRET_KEY'),
    });

    // Redis에서 Refresh Token 확인
    const storedHash = await this.redisService.get(`refresh_token_${decoded.id}`);
    if (!storedHash) {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다.');
    }

    const isMatch = await compare(refreshToken, storedHash);
    if (!isMatch) {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다.');
    }

    // 토큰 재발급
    const payload = { id: decoded.id, phoneNum: decoded.phoneNum };
    const tokens = await this.issueTokens(payload);
    await this.redisService.set(`refresh_token_${decoded.id}`, tokens.refreshToken);
    return tokens;
  }

  private async issueTokens(payload: any) {
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('ACCESS_TOKEN_SECRET_KEY'),
      expiresIn: this.configService.get<string>('ACCESS_TOKEN_EXPIRED_IN'),
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('REFRESH_TOKEN_SECRET_KEY'),
      expiresIn: this.configService.get<string>('REFRESH_TOKEN_EXPIRED_IN'),
    });

    return { accessToken, refreshToken };
  }
}
