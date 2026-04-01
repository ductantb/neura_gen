import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { CamelCaseInterceptor } from './common/interceptors/camel-case.interceptor';
import { SnakeCaseInterceptor } from './common/interceptors/snake-case.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Loại bỏ các trường không khai báo trong DTO
      forbidNonWhitelisted: true, // Báo lỗi 400 nếu user cố tình gửi trường lạ
      transform: true, // Tự động ép kiểu dữ liệu (ví dụ: string sang number)
    }),
  );
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.useGlobalInterceptors(
    new CamelCaseInterceptor(),
    new SnakeCaseInterceptor(),
  );

  const config = new DocumentBuilder()
    .setTitle('Neura Gen API')
    .setDescription('API for Gen Motion AI')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'access-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
