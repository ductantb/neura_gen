import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

type SendMailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;
  private readonly enabled: boolean;
  private runtimeDisabledReason: string | null = null;

  constructor(private readonly configService: ConfigService) {
    const host =
      this.normalizeOptionalString(this.configService.get<string>('MAIL_HOST')) ??
      'smtp.gmail.com';
    const port = Number(
      this.normalizeOptionalString(this.configService.get<string>('MAIL_PORT')) ??
        '587',
    );
    const secure =
      String(
        this.normalizeOptionalString(this.configService.get<string>('MAIL_SECURE')) ??
          'false',
      ) === 'true';
    const user = this.normalizeOptionalString(
      this.configService.get<string>('MAIL_USER'),
    );
    const pass = this.normalizeMailAppPassword(
      this.configService.get<string>('MAIL_APP_PASSWORD'),
    );
    const mailEnabled =
      this.normalizeOptionalString(this.configService.get<string>('MAIL_ENABLED')) !==
      'false';

    this.from =
      this.normalizeOptionalString(this.configService.get<string>('MAIL_FROM')) ??
      user ??
      'Neura Gen <no-reply@neuragen.local>';

    if (!mailEnabled) {
      this.enabled = false;
      this.transporter = null;
      this.logger.warn('Mail service is disabled because MAIL_ENABLED=false.');
      return;
    }

    if (!user || !pass) {
      this.enabled = false;
      this.transporter = null;
      this.logger.warn(
        'Mail service is disabled because MAIL_USER or MAIL_APP_PASSWORD is missing.',
      );
      return;
    }

    this.enabled = true;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });
  }

  isEnabled(): boolean {
    return this.enabled && !this.runtimeDisabledReason;
  }

  async sendMail(payload: SendMailPayload): Promise<boolean> {
    if (!this.transporter || !this.enabled) {
      this.logger.warn(`Skipped email to ${payload.to} because mail transport is disabled.`);
      return false;
    }

    if (this.runtimeDisabledReason) {
      this.logger.warn(
        `Skipped email to ${payload.to} because mail transport is disabled at runtime: ${this.runtimeDisabledReason}`,
      );
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isAuthenticationError(message)) {
        this.runtimeDisabledReason =
          'SMTP authentication failed. Check MAIL_USER, MAIL_APP_PASSWORD, and Gmail App Password / 2FA settings.';
        this.logger.error(
          `Failed to send email to ${payload.to}: ${message}. Mail service will be disabled for the rest of this process.`,
        );
        return false;
      }

      this.logger.error(`Failed to send email to ${payload.to}: ${message}`);
      return false;
    }
  }

  async sendWelcomeEmail(email: string): Promise<boolean> {
    return this.sendMail({
      to: email,
      subject: 'Welcome to Neura Gen',
      text: 'Your account has been created successfully.',
      html: '<p>Your account has been created successfully.</p>',
    });
  }

  async sendPasswordResetEmail(email: string, resetToken: string): Promise<boolean> {
    const resetUrl = this.buildResetUrl(resetToken);

    return this.sendMail({
      to: email,
      subject: 'Reset your password',
      text: `Use this link to reset your password: ${resetUrl}`,
      html: `<p>Use this link to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    });
  }

  async sendPasswordChangedEmail(email: string): Promise<boolean> {
    return this.sendMail({
      to: email,
      subject: 'Your password was changed',
      text: 'Your password has just been changed. If this was not you, contact support immediately.',
      html: '<p>Your password has just been changed. If this was not you, contact support immediately.</p>',
    });
  }

  private buildResetUrl(resetToken: string): string {
    const baseUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

    return `${normalizedBase}/reset-password?token=${encodeURIComponent(resetToken)}`;
  }

  private normalizeOptionalString(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeMailAppPassword(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.replace(/\s+/g, '');
    return normalized.length > 0 ? normalized : null;
  }

  private isAuthenticationError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('invalid login') ||
      normalized.includes('username and password not accepted') ||
      normalized.includes('authentication unsuccessful') ||
      normalized.includes('535')
    );
  }
}
