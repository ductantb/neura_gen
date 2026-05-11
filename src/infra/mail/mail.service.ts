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
  private readonly provider: 'smtp' | 'resend';
  private readonly resendApiKey: string | null;
  private runtimeDisabledReason: string | null = null;

  constructor(private readonly configService: ConfigService) {
    const provider =
      this.normalizeOptionalString(this.configService.get<string>('MAIL_PROVIDER')) ??
      'smtp';
    this.provider = provider === 'resend' ? 'resend' : 'smtp';

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
    this.resendApiKey = this.normalizeOptionalString(
      this.configService.get<string>('RESEND_API_KEY'),
    );

    if (!mailEnabled) {
      this.enabled = false;
      this.transporter = null;
      this.logger.warn('Mail service is disabled because MAIL_ENABLED=false.');
      return;
    }

    if (this.provider === 'resend') {
      if (!this.resendApiKey) {
        this.enabled = false;
        this.transporter = null;
        this.logger.warn(
          'Mail service is disabled because MAIL_PROVIDER=resend but RESEND_API_KEY is missing.',
        );
        return;
      }

      this.enabled = true;
      this.transporter = null;
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
      connectionTimeout: Number(
        this.normalizeOptionalString(
          this.configService.get<string>('MAIL_CONNECTION_TIMEOUT_MS'),
        ) ?? '10000',
      ),
      greetingTimeout: Number(
        this.normalizeOptionalString(
          this.configService.get<string>('MAIL_GREETING_TIMEOUT_MS'),
        ) ?? '10000',
      ),
      socketTimeout: Number(
        this.normalizeOptionalString(
          this.configService.get<string>('MAIL_SOCKET_TIMEOUT_MS'),
        ) ?? '15000',
      ),
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
    if (!this.enabled) {
      this.logger.warn(`Skipped email to ${payload.to} because mail transport is disabled.`);
      return false;
    }

    if (this.runtimeDisabledReason) {
      this.logger.warn(
        `Skipped email to ${payload.to} because mail transport is disabled at runtime: ${this.runtimeDisabledReason}`,
      );
      return false;
    }

    if (this.provider === 'resend') {
      return this.sendViaResend(payload);
    }

    if (!this.transporter) {
      this.logger.warn(`Skipped email to ${payload.to} because SMTP transport is unavailable.`);
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

      if (this.isConnectivityError(message)) {
        this.runtimeDisabledReason =
          'SMTP connectivity failed (timeout/network). Check Railway plan/network or switch to MAIL_PROVIDER=resend.';
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

  private async sendViaResend(payload: SendMailPayload): Promise<boolean> {
    if (!this.resendApiKey) {
      this.logger.warn(`Skipped email to ${payload.to} because RESEND_API_KEY is missing.`);
      return false;
    }

    const timeoutMs = Number(
      this.normalizeOptionalString(this.configService.get<string>('RESEND_TIMEOUT_MS')) ??
        '10000',
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [payload.to],
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        return true;
      }

      const responseBody = await response.text();
      const trimmed =
        responseBody.length > 300 ? `${responseBody.slice(0, 300)}...` : responseBody;
      this.logger.error(
        `Failed to send email to ${payload.to} via Resend: HTTP ${response.status} ${trimmed}`,
      );
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send email to ${payload.to} via Resend: ${message}`);
      return false;
    } finally {
      clearTimeout(timeout);
    }
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

  private isConnectivityError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('connection timeout') ||
      normalized.includes('timed out') ||
      normalized.includes('etimedout') ||
      normalized.includes('econnrefused') ||
      normalized.includes('enetunreach') ||
      normalized.includes('ehostunreach')
    );
  }
}
