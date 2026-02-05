import {
  AbilityBuilder,
  PureAbility,
} from '@casl/ability';
import { createPrismaAbility, PrismaQuery, Subjects } from '@casl/prisma';
import { Injectable } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';

export enum Action {
  Manage = 'manage',
  Create = 'create',
  Read = 'read',
  Update = 'update',
  Delete = 'delete',
}

type AppSubjects = 'all' | Subjects<{
  User: User;
  Post: { userId: string };
  Comment: { userId: string };
  Follow: { followerId: string; followingId: string };
  Like: { postId: string; userId: string };
}>;

export type AppAbility = PureAbility<[Action, AppSubjects], PrismaQuery>;

@Injectable()
export class CaslAbilityFactory {
  createForUser(user: User) {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(createPrismaAbility);

    if (user.role === UserRole.ADMIN) {
      can(Action.Manage, 'all');
    } else {
      // User
      can(Action.Read, 'User');
      can(Action.Update, 'User', { id: user.id });
      can(Action.Delete, 'User', { id: user.id });
      // Post
      can(Action.Read, 'Post');
      can(Action.Create, 'Post');
      can(Action.Update, 'Post', { userId: user.id });
      can(Action.Delete, 'Post', { userId: user.id });
      // Comment
      can(Action.Create, 'Comment');
      can(Action.Update, 'Comment', { userId: user.id });
    }

    return build();
  }
}
