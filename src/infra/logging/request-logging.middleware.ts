import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { StructuredLoggerService } from './structured-logger.service';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(private readonly logger: StructuredLoggerService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const incomingRequestId = req.header('x-request-id');
    const requestId =
      incomingRequestId && incomingRequestId.trim().length > 0
        ? incomingRequestId
        : randomUUID();

    const startedAtMs = Date.now();
    (req as Request & { requestId?: string }).requestId = requestId;
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const durationMs = Date.now() - startedAtMs;
      const userId = (req as Request & { user?: { sub?: string } }).user?.sub;
      const statusCode = res.statusCode;

      const payload = {
        requestId,
        method: req.method,
        path: req.originalUrl ?? req.url,
        statusCode,
        durationMs,
        ip: req.ip,
        userId: userId ?? null,
        userAgent: req.get('user-agent') ?? null,
      };

      if (statusCode >= 500) {
        this.logger.error('api.request.completed', payload);
        return;
      }

      if (statusCode >= 400) {
        this.logger.warn('api.request.completed', payload);
        return;
      }

      this.logger.info('api.request.completed', payload);
    });

    next();
  }
}
