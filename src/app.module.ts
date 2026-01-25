import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './database/prisma.module';
import { ModalModule } from './modules/modal/modal.module';
import { ConfigModule } from '@nestjs/config';
import { JobsService } from './modules/jobs/jobs.service';
import { JobsController } from './modules/jobs/jobs.controller';
import { JobsModule } from './modules/jobs/jobs.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ModalModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    JobsModule,
  ],
  providers: [JobsService],
  controllers: [JobsController],
})
export class AppModule {}
