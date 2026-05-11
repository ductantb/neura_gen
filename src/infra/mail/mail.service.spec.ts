import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const sendMailMock = jest.fn();
const createTransportMock: any = jest.fn(() => ({
  sendMail: sendMailMock,
}));

jest.mock('nodemailer', () => ({
  createTransport: (options: any) => createTransportMock(options),
}));

describe('MailService', () => {
  const originalFetch = global.fetch;
  const buildConfigService = (overrides?: Record<string, string | undefined>) =>
    ({
      get: jest.fn((key: string) => {
        const defaults: Record<string, string | undefined> = {
          MAIL_PROVIDER: 'smtp',
          MAIL_HOST: 'smtp.gmail.com',
          MAIL_PORT: '587',
          MAIL_SECURE: 'false',
          MAIL_USER: 'demo@example.com',
          MAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
          MAIL_FROM: 'Neura Gen <demo@example.com>',
          FRONTEND_URL: 'http://localhost:5173',
          ...overrides,
        };

        return defaults[key];
      }),
    }) as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('disables mail transport when MAIL_ENABLED=false', () => {
    const service = new MailService(
      buildConfigService({
        MAIL_ENABLED: 'false',
      }),
    );

    expect(service.isEnabled()).toBe(false);
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('normalizes Gmail app password by removing spaces', async () => {
    sendMailMock.mockResolvedValue(undefined);

    const service = new MailService(buildConfigService());
    await service.sendWelcomeEmail('user@example.com');

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: {
          user: 'demo@example.com',
          pass: 'abcdefghijklmnop',
        },
      }),
    );
    expect(sendMailMock).toHaveBeenCalled();
  });

  it('disables mail service at runtime after SMTP authentication error', async () => {
    sendMailMock.mockRejectedValueOnce(
      new Error('Invalid login: 535-5.7.8 Username and Password not accepted'),
    );

    const service = new MailService(buildConfigService());

    await expect(service.sendWelcomeEmail('user@example.com')).resolves.toBe(
      false,
    );
    expect(service.isEnabled()).toBe(false);

    await expect(service.sendPasswordChangedEmail('user@example.com')).resolves.toBe(
      false,
    );

    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('sends email via Resend when MAIL_PROVIDER=resend', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    const service = new MailService(
      buildConfigService({
        MAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test_key',
      }),
    );

    await expect(service.sendWelcomeEmail('user@example.com')).resolves.toBe(true);
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
