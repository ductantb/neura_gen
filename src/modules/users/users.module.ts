import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { RouterModule } from '@nestjs/core';
import { FollowsModule } from '../follows/follows.module';

@Module({
  imports: [
    RouterModule.register([
      {
        path: 'users/:userId',
        children: [
          {
            path: '/',
            module: FollowsModule,
          },
        ],
      },
    ]),
    FollowsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
