import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from 'src/infra/mail/mail.service';
import { REDIS_CLIENT } from 'src/common/constants';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { hashPassword } from 'src/utils/hash';

describe('AuthService', () => {
  let service: AuthService;
  let configService: {
    get: jest.Mock;
    getOrThrow: jest.Mock;
  };
  let jwtService: {
    signAsync: jest.Mock;
    verifyAsync: jest.Mock;
  };
  let redisClient: {
    set: jest.Mock;
    eval: jest.Mock;
  };
  let prismaService: {
    user: { findUnique: jest.Mock };
    passwordResetToken: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, string> = {
          OAUTH_ALLOWED_REDIRECT_URIS: 'http://localhost:5173/auth/callback',
          FRONTEND_URL: 'http://localhost:5173',
          GOOGLE_AUTH_CODE_TTL_SECONDS: '120',
          OAUTH_STATE_SECRET: 'test-oauth-state-secret',
          OAUTH_STATE_EXPIRES_IN: '10m',
          GOOGLE_CLIENT_ID: 'web-client-id.apps.googleusercontent.com',
          GOOGLE_ALLOWED_AUDIENCES:
            'web-client-id.apps.googleusercontent.com,android-client-id.apps.googleusercontent.com',
        };
        return map[key];
      }),
      getOrThrow: jest.fn((key: string) => {
        if (key === 'JWT_ACCESS_SECRET') return 'jwt-access-secret';
        return `mock-${key}`;
      }),
    };

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-state-token'),
      verifyAsync: jest.fn(),
    };

    redisClient = {
      set: jest.fn(),
      eval: jest.fn(),
    };

    prismaService = {
      user: {
        findUnique: jest.fn(),
      },
      passwordResetToken: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: MailService,
          useValue: {
            sendWelcomeEmail: jest.fn(),
            sendPasswordResetEmail: jest.fn(),
            sendPasswordChangedEmail: jest.fn(),
          },
        },
        {
          provide: REDIS_CLIENT,
          useValue: redisClient,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates and exchanges one-time Google auth code', async () => {
    const authPayload = {
      userId: 'user-id',
      username: 'tester',
      email: 'tester@example.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    };

    redisClient.set.mockResolvedValue('OK');
    redisClient.eval.mockResolvedValue(JSON.stringify(authPayload));

    const code = await service.createGoogleAuthCode(authPayload);
    expect(code).toBeTruthy();
    expect(redisClient.set).toHaveBeenCalled();

    const exchanged = await service.exchangeGoogleAuthCode(code);
    expect(exchanged).toEqual(authPayload);
    expect(redisClient.eval).toHaveBeenCalled();
  });

  it('rejects invalid/expired auth code', async () => {
    redisClient.eval.mockResolvedValue(null);

    await expect(service.exchangeGoogleAuthCode('invalid-code')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('consumes valid OAuth state and strips disallowed redirect URI', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      type: 'google_oauth_state',
      nonce: 'nonce-123',
      redirectUri: 'https://malicious.example/callback',
      platform: 'web',
    });

    const state = await service.consumeGoogleOauthState('signed-token');
    expect(state.type).toBe('google_oauth_state');
    expect(state.nonce).toBe('nonce-123');
    expect(state.redirectUri).toBeUndefined();
    expect(state.platform).toBe('web');
  });

  it('rejects invalid Google id token', async () => {
    (service as any).googleClient = {
      verifyIdToken: jest.fn().mockRejectedValue(new Error('invalid')),
    };

    await expect(
      service.loginWithGoogleIdToken('not-a-valid-google-token'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('normalizes email when handling forgot password', async () => {
    prismaService.user.findUnique.mockResolvedValue(null);

    await service.forgotPassword('  USER@Example.COM ');

    expect(prismaService.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
      select: { id: true, email: true },
    });
  });

  it('rejects change password when new password matches old password', async () => {
    const currentHash = await hashPassword('samepassword123');
    prismaService.user.findUnique.mockResolvedValue({
      email: 'user@example.com',
      password: currentHash,
    });

    await expect(
      service.changePassword('user-id', 'samepassword123', 'samepassword123'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects reset password when new password matches current password', async () => {
    const currentHash = await hashPassword('samepassword123');
    prismaService.passwordResetToken.findUnique.mockResolvedValue({
      id: 'token-id',
      userId: 'user-id',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 'user-id',
        email: 'user@example.com',
        password: currentHash,
      },
    });

    await expect(
      service.resetPassword('raw-reset-token', 'samepassword123'),
    ).rejects.toThrow(BadRequestException);
  });
});
