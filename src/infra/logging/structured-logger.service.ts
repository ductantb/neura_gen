import { Injectable } from '@nestjs/common';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

@Injectable()
export class StructuredLoggerService {
  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  private readonly minLevel: LogLevel;

  constructor() {
    const fromEnv = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
    this.minLevel = this.parseLevel(fromEnv);
  }

  debug(event: string, data: Record<string, unknown> = {}) {
    this.emit('debug', event, data);
  }

  info(event: string, data: Record<string, unknown> = {}) {
    this.emit('info', event, data);
  }

  warn(event: string, data: Record<string, unknown> = {}) {
    this.emit('warn', event, data);
  }

  error(event: string, data: Record<string, unknown> = {}) {
    this.emit('error', event, data);
  }

  private parseLevel(value: string): LogLevel {
    if (value === 'debug') return 'debug';
    if (value === 'warn') return 'warn';
    if (value === 'error') return 'error';
    return 'info';
  }

  private shouldLog(level: LogLevel) {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel];
  }

  private emit(level: LogLevel, event: string, data: Record<string, unknown>) {
    if (!this.shouldLog(level)) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...data,
    };

    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(payload));
      return;
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }
}
