import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { AssetRole, Prisma, UserRole } from '@prisma/client';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { REDIS_CLIENT } from 'src/common/constants';
import { ExploreService } from '../explore/explore.service';
import { StorageService } from 'src/infra/storage/storage.service';

const POST_WITH_MEDIA_INCLUDE = {
  user: {
    select: {
      id: true,
      username: true,
    },
  },
  assetVersion: {
    select: {
      id: true,
      fileUrl: true,
      objectKey: true,
      metadata: true,
      mimeType: true,
      asset: {
        select: {
          type: true,
          job: {
            select: {
              assets: {
                where: {
                  role: AssetRole.THUMBNAIL,
                },
                orderBy: {
                  createdAt: 'desc',
                },
                take: 1,
                select: {
                  versions: {
                    orderBy: {
                      version: 'desc',
                    },
                    take: 1,
                    select: {
                      fileUrl: true,
                      objectKey: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PostInclude;

type PostWithMediaRelations = Prisma.PostGetPayload<{
  include: typeof POST_WITH_MEDIA_INCLUDE;
}>;

type PersistedPostInput = Pick<
  CreatePostDto,
  'assetVersionId' | 'caption' | 'isPublic'
>;

@Injectable()
export class PostsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly exploreService: ExploreService,
  ) {}

  async create(userId: string, createPostDto: CreatePostDto) {
    const persistedPostData = this.pickCreatePostData(createPostDto);

    const post = await this.prismaService.post.create({
      data: {
        ...persistedPostData,
        userId,
      },
    });

    await this.exploreService.syncPost(post.id);
    return this.findOne(post.id);
  }

  findAll() {
    return this.prismaService.post
      .findMany({
        include: POST_WITH_MEDIA_INCLUDE,
      })
      .then((posts) => Promise.all(posts.map((post) => this.serializePost(post))));
  }

  findOne(id: string) {
    return this.prismaService.post
      .findUnique({
        where: { id },
        include: POST_WITH_MEDIA_INCLUDE,
      })
      .then((post) => this.serializePost(post));
  }

  async update(
    id: string,
    user: { sub: string; role: UserRole },
    updatePostDto: UpdatePostDto,
  ) {
    const post = await this.prismaService.post.findUnique({
      where: { id },
    });

    if (!post) throw new NotFoundException('Post không tồn tại');

    if (post.userId !== user.sub && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('Không có quyền cập nhật post này');

    const persistedPostData = this.pickUpdatePostData(updatePostDto);

    const updatedPost = await this.prismaService.post.update({
      where: { id },
      data: persistedPostData,
    });

    await this.exploreService.syncPost(updatedPost.id);
    return this.findOne(updatedPost.id);
  }

  async remove(id: string, user: { sub: string; role: UserRole }) {
    const post = await this.prismaService.post.findUnique({
      where: { id },
    });

    if (!post) throw new NotFoundException('Post không tồn tại');

    if (post.userId !== user.sub && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('Không có quyền cập nhật post này');

    return this.prismaService.post.delete({
      where: { id },
    });
  }

  async trackView(
    postId: string,
    rawIp: string,
    userAgent: string,
    userId?: string,
  ) {
    const identifier = userId
      ? `u:${userId}`
      : `g:${createHash('md5')
          .update(rawIp + userAgent)
          .digest('hex')}`;

    const lockKey = `lock:${postId}:${identifier}`;
    const ttl = userId ? 86400 : 1800;

    const result = await this.redis
      // .multi()
      .set(lockKey, '1', 'EX', ttl, 'NX');
    // .exec();

    if (!result) return false;

    const isNewView = result === 'OK';

    if (isNewView) {
      await this.redis.hincrby('post:views:buffer', postId, 1);
      return true;
    }
    return false;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncViewsToDb() {
    const bufferKey = 'post:views:buffer';

    // 1. Đổi tên key để "chốt sổ" dữ liệu cũ, tránh bị ghi đè khi đang xử lý
    const tempKey = `post:views:sync:${Date.now()}`;
    const renameRes = await this.redis
      .rename(bufferKey, tempKey)
      .catch(() => null);

    if (!renameRes) return; // Không có view mới thì thoát

    // 2. Lấy toàn bộ dữ liệu từ bản tạm
    const data = await this.redis.hgetall(tempKey);
    await this.redis.del(tempKey); // Xóa luôn bản tạm

    const updates = Object.entries(data).map(([postId, count]) => ({
      id: postId,
      count: parseInt(count),
    }));

    if (updates.length === 0) return;

    await this.prismaService.$executeRaw`
    UPDATE "Post" AS p
    SET "viewCount" = p."viewCount" + v.increment
    FROM (
      SELECT 
        unnest(${updates.map((u) => u.id)}) AS id, 
        unnest(${updates.map((u) => u.count)}::int[]) AS increment
    ) AS v
    WHERE p.id = v.id;
  `;
  }

  private async serializePost(post: PostWithMediaRelations | null) {
    if (!post) return null;

    const thumbnailVersion = post.assetVersion.asset.job?.assets[0]?.versions[0];
    const thumbnailUrl =
      (await this.resolveAssetUrl(
        thumbnailVersion?.objectKey,
        thumbnailVersion?.fileUrl,
      )) ??
      (post.assetVersion.asset.type === 'IMAGE'
        ? await this.resolveAssetUrl(
            post.assetVersion.objectKey,
            post.assetVersion.fileUrl,
          )
        : null);
    const videoUrl =
      post.assetVersion.asset.type === 'VIDEO'
        ? await this.resolveAssetUrl(
            post.assetVersion.objectKey,
            post.assetVersion.fileUrl,
          )
        : null;

    return {
      ...post,
      thumbnailUrl,
      videoUrl,
    };
  }

  private async resolveAssetUrl(
    objectKey?: string | null,
    fileUrl?: string | null,
  ) {
    if (objectKey) {
      const signed = await this.storageService.getDownloadSignedUrl(objectKey);
      return signed.url;
    }

    return fileUrl ?? null;
  }

  private pickCreatePostData(dto: CreatePostDto): PersistedPostInput {
    return {
      assetVersionId: dto.assetVersionId,
      caption: dto.caption,
      isPublic: dto.isPublic,
    };
  }

  private pickUpdatePostData(
    dto: Partial<CreatePostDto>,
  ): Partial<PersistedPostInput> {
    return {
      ...(dto.assetVersionId !== undefined && {
        assetVersionId: dto.assetVersionId,
      }),
      ...(dto.caption !== undefined && {
        caption: dto.caption,
      }),
      ...(dto.isPublic !== undefined && {
        isPublic: dto.isPublic,
      }),
    };
  }
}
