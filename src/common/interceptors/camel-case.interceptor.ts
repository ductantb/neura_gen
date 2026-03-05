import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import camelcaseKeys from 'camelcase-keys';
import { Observable } from 'rxjs';

@Injectable()
export class CamelCaseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {

    const request = context.switchToHttp().getRequest();

    if (request.body && Object.keys(request.body).length) {
      Object.assign(request.body, camelcaseKeys(request.body, { deep: true }));
    }

    if (request.query && Object.keys(request.query).length) {
      Object.assign(request.query, camelcaseKeys(request.query, { deep: true }));
    }

    if (request.params && Object.keys(request.params).length) {
      Object.assign(request.params, camelcaseKeys(request.params, { deep: true }));
    }

    return next.handle();
  }
}