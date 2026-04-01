import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import snakecaseKeys from 'snakecase-keys';
import { map } from 'rxjs/operators';

@Injectable()
export class SnakeCaseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {

    return next.handle().pipe(
      map((data) => {
        if (!data) return data;

        return snakecaseKeys(data, {
          deep: true,
        });
      }),
    );
  }
}