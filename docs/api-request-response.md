# Neura Gen API Request + Response (for FE)

Tai lieu nay tong hop theo code backend hien tai (controller + service + DTO), khong suy doan theo y muon.

## 1) Conventions

- Base URL: `http://<host>:<port>` (khong co global prefix).
- Auth mac dinh: Bearer JWT cho hầu het endpoint.
- Public endpoint dung `@Public()` (khong can token).
- ValidationPipe global:
  - `whitelist: true`
  - `forbidNonWhitelisted: true`
  - `transform: true`
- Nghia la body co field la se bi loai bo/bao loi neu khong nam trong DTO.
- Khong co response wrapper global `{ success, message, data }` dang duoc bat.

## 2) Error shape chung

Khi loi (400/401/403/404/500...), NestJS thuong tra:

```json
{
  "statusCode": 400,
  "message": "Bad Request message or array",
  "error": "Bad Request"
}
```

## 3) Endpoints

## App

### `GET /`
- Auth: Bearer JWT
- Request: none
- Response:
```json
"Hello World!"
```

## Auth

### `POST /auth/register`
- Auth: Public
- Request body:
```json
{
  "email": "test@example.com",
  "password": "12345678"
}
```
- Response:
```json
{
  "userId": "uuid",
  "username": "test",
  "email": "test@example.com",
  "accessToken": "jwt",
  "refreshToken": "jwt"
}
```

### `POST /auth/login`
- Auth: Public
- Request body:
```json
{
  "email": "test@example.com",
  "password": "12345678"
}
```
- Response: giong `/auth/register`.

### `GET /auth/google`
- Auth: Public
- Request: none
- Response: redirect OAuth (khong co JSON response co dinh).

### `GET /auth/google/callback`
- Auth: Public
- Request: callback tu Google
- Response:
```json
{
  "userId": "uuid",
  "username": "string",
  "email": "string",
  "accessToken": "jwt",
  "refreshToken": "jwt"
}
```

### `POST /auth/refresh`
- Auth: Public
- Request body:
```json
{
  "refreshToken": "jwt"
}
```
- Response: token pair moi (giong login/register).

### `POST /auth/logout`
- Auth: Bearer JWT
- Request body:
```json
{
  "refreshToken": "jwt"
}
```
- Response:
```json
{
  "message": "Logged out successfully"
}
```

### `POST /auth/logout-all`
- Auth: Bearer JWT
- Request: none
- Response:
```json
{
  "message": "Logged out from all devices successfully"
}
```

### `PATCH /auth/change-password`
- Auth: Bearer JWT
- Request body:
```json
{
  "oldPassword": "12345678",
  "newPassword": "87654321"
}
```
- Response:
```json
{
  "message": "Password changed successfully"
}
```

### `POST /auth/forgot-password`
- Auth: Public
- Request body:
```json
{
  "email": "test@example.com"
}
```
- Response:
```json
{
  "message": "If this email exists in our system, a password reset link has been sent."
}
```

### `POST /auth/reset-password`
- Auth: Public
- Request body:
```json
{
  "token": "reset-token",
  "newPassword": "newPassword123"
}
```
- Response:
```json
{
  "message": "Password reset successfully"
}
```

## Users

### `PATCH /users/me`
- Auth: Bearer JWT
- Request body (all optional):
```json
{
  "username": "neura_gen_2026",
  "bio": "text",
  "avatarUrl": "https://..."
}
```
- Response (User raw):
```json
{
  "id": "uuid",
  "email": "string",
  "googleId": "string|null",
  "password": "hashed-password",
  "username": "string",
  "bio": "string|null",
  "avatarUrl": "string|null",
  "role": "FREE|PRO|ADMIN",
  "proExpiresAt": "datetime|null",
  "createdAt": "datetime"
}
```

### `GET /users/me`
- Auth: Bearer JWT
- Query:
  - `cursor?: string`
  - `take?: number (1..50, default 20)`
- Response:
```json
{
  "id": "uuid",
  "email": "string",
  "username": "string",
  "avatarUrl": "string|null",
  "bio": "string|null",
  "role": "FREE|PRO|ADMIN",
  "proExpiresAt": "datetime|null",
  "createdAt": "datetime",
  "credits": {
    "balance": 120,
    "updatedAt": "datetime"
  },
  "counts": {
    "followers": 0,
    "following": 0,
    "posts": 0,
    "jobs": 0
  },
  "jobs": {
    "data": [
      {
        "id": "uuid",
        "type": "IMAGE_TO_VIDEO",
        "status": "PENDING|QUEUED|PROCESSING|COMPLETED|FAILED|CANCELLED",
        "progress": 0,
        "prompt": "string",
        "negativePrompt": "string|null",
        "modelName": "string",
        "turboEnabled": false,
        "creditCost": 10,
        "provider": "string|null",
        "errorMessage": "string|null",
        "createdAt": "datetime",
        "updatedAt": "datetime",
        "startedAt": "datetime|null",
        "completedAt": "datetime|null",
        "failedAt": "datetime|null"
      }
    ],
    "nextCursor": "job-id|null",
    "take": 20
  }
}
```

### `POST /users/me/credits/topup`
- Auth: Bearer JWT + ADMIN
- Request body:
```json
{
  "amount": 50,
  "note": "optional note"
}
```
- Response:
```json
{
  "userId": "uuid",
  "amount": 50,
  "balance": 150,
  "reason": "TEST_REWARD",
  "transactionId": "uuid",
  "note": "string|null",
  "createdAt": "datetime"
}
```

### `GET /users/:id`
- Auth: Bearer JWT
- Path param: `id`
- Response:
```json
{
  "id": "uuid",
  "username": "string",
  "avatarUrl": "string|null",
  "bio": "string|null",
  "credits": {
    "balance": 120,
    "updatedAt": "datetime"
  }
}
```

### `DELETE /users/me`
- Auth: Bearer JWT
- Request: none
- Response: User raw da bi xoa (shape tuong tu `PATCH /users/me`).

## Posts

### `POST /posts`
- Auth: Bearer JWT
- Request body:
```json
{
  "assetVersionId": "uuid",
  "caption": "optional",
  "videoUrl": "optional-client-url",
  "thumbnailUrl": "optional-client-url",
  "isPublic": true
}
```
- Note:
  - `videoUrl` va `thumbnailUrl` trong request chi de dong bo payload tu FE.
  - Backend khong luu 2 field nay trong bang `Post`; response se tu suy ra lai tu `assetVersion`.
- Response (Serialized Post):
```json
{
  "id": "uuid",
  "userId": "uuid",
  "assetVersionId": "uuid",
  "caption": "string|null",
  "isPublic": true,
  "likeCount": 0,
  "commentCount": 0,
  "viewCount": 0,
  "createdAt": "datetime",
  "user": {
    "id": "uuid",
    "username": "string"
  },
  "assetVersion": {
    "id": "uuid",
    "fileUrl": "string|null",
    "metadata": {},
    "mimeType": "string|null",
    "asset": {
      "type": "IMAGE|VIDEO|THUMBNAIL|AUDIO",
      "job": {
        "assets": [
          {
            "versions": [
              {
                "fileUrl": "string|null"
              }
            ]
          }
        ]
      }
    }
  },
  "thumbnailUrl": "string|null",
  "videoUrl": "string|null"
}
```

### `GET /posts`
- Auth: Public
- Request: none
- Response: `Serialized Post[]` (cung shape voi `GET /posts/:id`).

### `GET /posts/:id`
- Auth: Public (token optional)
- Path param: `id`
- Response:
```json
{
  "id": "uuid",
  "userId": "uuid",
  "assetVersionId": "uuid",
  "caption": "string|null",
  "isPublic": true,
  "likeCount": 0,
  "commentCount": 0,
  "viewCount": 0,
  "createdAt": "datetime",
  "user": {
    "id": "uuid",
    "username": "string"
  },
  "assetVersion": {
    "id": "uuid",
    "fileUrl": "string|null",
    "metadata": {},
    "mimeType": "string|null",
    "asset": {
      "type": "IMAGE|VIDEO|THUMBNAIL|AUDIO",
      "job": {
        "assets": [
          {
            "versions": [
              {
                "fileUrl": "string|null"
              }
            ]
          }
        ]
      }
    }
  },
  "thumbnailUrl": "string|null",
  "videoUrl": "string|null"
}
```

### `PATCH /posts/:id`
- Auth: Bearer JWT
- Path param: `id`
- Request body (partial):
```json
{
  "assetVersionId": "uuid",
  "caption": "string",
  "videoUrl": "optional-client-url",
  "thumbnailUrl": "optional-client-url",
  "isPublic": true
}
```
- Response: Serialized Post da update (cung shape `GET /posts/:id`).

### `DELETE /posts/:id`
- Auth: Bearer JWT
- Path param: `id`
- Response: Post raw da xoa.

## Comments

### `POST /posts/:postId/comments`
- Auth: Bearer JWT
- Path param: `postId`
- Request body:
```json
{
  "content": "This is a comment.",
  "postId": "optional"
}
```
- Rule:
  - Neu co `postId` trong body thi phai trung voi `:postId` tren URL.
- Response (Comment raw):
```json
{
  "id": "uuid",
  "userId": "uuid",
  "postId": "uuid",
  "content": "string",
  "createdAt": "datetime"
}
```

### `GET /posts/:postId/comments`
- Auth: Bearer JWT
- Path param: `postId`
- Query:
  - `cursor?: string`
  - `take?: number (1..50, default 20)`
- Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "content": "string",
      "createdAt": "datetime",
      "user": {
        "id": "uuid",
        "username": "string"
      }
    }
  ],
  "nextCursor": "comment-id|null"
}
```

### `PATCH /comments/:id`
- Auth: Bearer JWT
- Path param: `id`
- Request body (partial):
```json
{
  "postId": "uuid",
  "content": "string"
}
```
- Response: Comment raw da update.

### `DELETE /comments/:id`
- Auth: Bearer JWT
- Path param: `id`
- Response: Comment raw da xoa.

## Post Likes

### `POST /posts/:postId/post-likes`
- Auth: Bearer JWT
- Path param: `postId`
- Request body:
```json
{
  "postId": "optional"
}
```
- Rule:
  - Neu co `postId` trong body thi phai trung voi `:postId` tren URL.
- Response (PostLike raw):
```json
{
  "id": "uuid",
  "userId": "uuid",
  "postId": "uuid",
  "createdAt": "datetime"
}
```

### `GET /posts/:postId/post-likes?cursor=&take=`
- Auth: Bearer JWT
- Path param: `postId`
- Query:
  - `cursor?: string`
  - `take?: number (1..50, default 20)`
- Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "createdAt": "datetime",
      "user": {
        "id": "uuid",
        "username": "string"
      }
    }
  ],
  "nextCursor": "post-like-id|null"
}
```

### `DELETE /posts/:postId/post-likes`
- Auth: Bearer JWT
- Request: none (theo code hien tai)
- Response:
```json
{
  "id": "uuid",
  "userId": "uuid",
  "postId": "uuid",
  "createdAt": "datetime"
}
```

## Follows

### `POST /follows`
- Auth: Bearer JWT
- Request body:
```json
{
  "followingId": "user-id-2",
  "sourcePostId": "optional-post-id"
}

```
- Response (Follow raw):
```json
{
  "id": "uuid",
  "followerId": "uuid",
  "followingId": "uuid",
  "createdAt": "datetime"
}

```

### `GET /users/:userId/followers`
- Auth: Bearer JWT
- Path param: `userId`
- Query:
  - `cursor?: string`
  - `take?: number (1..50, default 20)`
- Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "follower": {
        "id": "uuid",
        "username": "string"
      }
    }
  ],
  "nextCursor": "follow-id|null"
}
```

### `GET /users/:userId/followings`
- Auth: Bearer JWT
- Path param: `userId`
- Query:
  - `cursor?: string`
  - `take?: number (1..50, default 20)`
- Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "following": {
        "id": "uuid",
        "username": "string"
      }
    }
  ],
  "nextCursor": "follow-id|null"
}
```

### `DELETE /follows/:userId`
- Auth: Bearer JWT
- Path param: `userId`
- Response: Follow raw da xoa.

## Assets

### `POST /assets/upload`
- Auth: Bearer JWT
- Content-Type: `multipart/form-data`
- Request form-data:
  - `file` (required): binary file
  - `jobId?` (uuid)
  - `type?`: `IMAGE|VIDEO|THUMBNAIL|AUDIO`
  - `role?`: `INPUT|OUTPUT|THUMBNAIL|PREVIEW|TEMP`
  - `folder?`: string
- Response:
```json
{
  "id": "uuid",
  "userId": "uuid",
  "jobId": "uuid|null",
  "type": "IMAGE|VIDEO|THUMBNAIL|AUDIO",
  "role": "INPUT|OUTPUT|THUMBNAIL|PREVIEW|TEMP",
  "mimeType": "string|null",
  "originalName": "string|null",
  "createdAt": "datetime",
  "updatedAt": "datetime",
  "versions": [
    {
      "id": "uuid",
      "assetId": "uuid",
      "version": 1,
      "storageProvider": "S3",
      "bucket": "string",
      "objectKey": "string",
      "fileUrl": "string|null",
      "originalName": "string|null",
      "mimeType": "string|null",
      "sizeBytes": 12345,
      "seed": "bigint|null",
      "width": 0,
      "height": 0,
      "durationMs": 0,
      "quality": "string|null",
      "metadata": {},
      "createdAt": "datetime"
    }
  ]
}
```

### `GET /assets/:id`
- Auth: Bearer JWT
- Path param: `id`
- Response:
```json
{
  "id": "uuid",
  "userId": "uuid",
  "jobId": "uuid|null",
  "type": "IMAGE|VIDEO|THUMBNAIL|AUDIO",
  "role": "INPUT|OUTPUT|THUMBNAIL|PREVIEW|TEMP",
  "mimeType": "string|null",
  "originalName": "string|null",
  "createdAt": "datetime",
  "updatedAt": "datetime",
  "versions": [
    {
      "id": "uuid",
      "assetId": "uuid",
      "version": 1,
      "storageProvider": "S3",
      "bucket": "string",
      "objectKey": "string",
      "fileUrl": "string|null",
      "originalName": "string|null",
      "mimeType": "string|null",
      "sizeBytes": 12345,
      "seed": "bigint|null",
      "width": 0,
      "height": 0,
      "durationMs": 0,
      "quality": "string|null",
      "metadata": {},
      "createdAt": "datetime"
    }
  ],
  "user": {
    "id": "uuid",
    "username": "string"
  },
  "job": {
    "id": "uuid",
    "type": "IMAGE_TO_VIDEO",
    "status": "PENDING|QUEUED|PROCESSING|COMPLETED|FAILED|CANCELLED"
  }
}
```

### `GET /assets/download/:id`
- Auth: Bearer JWT
- Path param: `id`
- Response:
```json
{
  "url": "signed-download-url",
  "expiresIn": 3600
}
```

## Gallery

### `POST /gallery`
- Auth: Bearer JWT
- Request body:
```json
{
  "assetVersionId": "uuid",
  "isPublic": true
}
```
- Response (GalleryItem raw):
```json
{
  "id": "uuid",
  "userId": "uuid",
  "assetVersionId": "uuid",
  "isPublic": true,
  "createdAt": "datetime"
}
```

### `GET /gallery`
- Auth: Bearer JWT
- Request: none
- Response:
```json
[
  {
    "assetVersion": {},
    "createdAt": "datetime",
    "isPublic": true
  }
]
```

### `PATCH /gallery/:id`
- Auth: Bearer JWT
- Path param: `id`
- Request body:
```json
{
  "isPublic": true
}
```
- Response: GalleryItem raw da update.

### `DELETE /gallery/:id`
- Auth: Bearer JWT
- Path param: `id`
- Response: GalleryItem raw da xoa.

## Explore

### `GET /explore`
- Auth: Public
- Query:
  - `topic?: string`
  - `trending?: "true"|"false"`
  - `mode?: "trending"|"new"|"top"`
  - `sort?: "score"|"newest"`
  - `limit?: number (1..50)`
  - `cursor?: string` (`ExploreItem.id`)
- Response:
```json
{
  "mode": "trending|new|top",
  "data": [
    {
      "id": "explore-item-id",
      "assetVersionId": "uuid",
      "title": "string",
      "topic": "string",
      "isTrending": true,
      "score": 20.5,
      "createdAt": "datetime",
      "postId": "uuid",
      "assetVersion": {
        "id": "uuid",
        "assetId": "uuid",
        "version": 1,
        "storageProvider": "S3",
        "bucket": "string",
        "objectKey": "string",
        "fileUrl": "string|null",
        "originalName": "string|null",
        "mimeType": "string|null",
        "sizeBytes": 12345,
        "seed": "bigint|null",
        "width": 0,
        "height": 0,
        "durationMs": 0,
        "quality": "string|null",
        "metadata": {},
        "createdAt": "datetime",
        "asset": {
          "id": "uuid",
          "userId": "uuid",
          "jobId": "uuid|null",
          "type": "IMAGE|VIDEO|THUMBNAIL|AUDIO",
          "role": "INPUT|OUTPUT|THUMBNAIL|PREVIEW|TEMP",
          "mimeType": "string|null",
          "originalName": "string|null",
          "createdAt": "datetime",
          "updatedAt": "datetime"
        }
      },
      "post": {
        "id": "uuid",
        "userId": "uuid",
        "assetVersionId": "uuid",
        "caption": "string|null",
        "isPublic": true,
        "likeCount": 0,
        "commentCount": 0,
        "viewCount": 0,
        "createdAt": "datetime",
        "user": {
          "id": "uuid",
          "username": "string",
          "avatarUrl": "string|null"
        }
      }
    }
  ],
  "nextCursor": "explore-item-id|null",
  "limit": 20
}
```

### `GET /explore/search`
- Auth: Public
- Muc dich:
  - Tim ExploreItem theo `topic` da duoc chuan hoa.
  - Endpoint nay map ve feed public voi `mode = top`.
- Query:
  - `topic: string` (required)
  - `sort?: "score"|"newest"`
  - `trending?: "true"|"false"`
  - `limit?: number (1..50)`
  - `cursor?: string` (`ExploreItem.id`)
- Response:
```json
{
  "mode": "top|new",
  "data": [],
  "nextCursor": "explore-item-id|null",
  "limit": 20
}
```

### `GET /explore/for-you`
- Auth: Bearer JWT
- Query:
  - `topic?: string`
  - `limit?: number (1..50)`
  - `cursor?: string` (`ExploreItem.id`)
- Note:
  - `mode`, `sort`, `trending` khong duoc dung trong logic xep hang `for-you`.
- Response:
```json
{
  "mode": "for_you",
  "data": [],
  "nextCursor": "explore-item-id|null",
  "limit": 20,
  "signals": {
    "topTopics": [
      { "topic": "anime", "score": 5.123 }
    ],
    "followingCreators": 3
  },
  "fallback": "trending"
}
```
- `signals` va `fallback` co the co hoac khong, tuy scenario.

### `POST /explore/events`
- Auth: Bearer JWT
- Request body:
```json
{
  "postId": "post-id",
  "eventType": "IMPRESSION|OPEN_POST|WATCH_3S|WATCH_50|LIKE|COMMENT|FOLLOW_CREATOR|HIDE",
  "metadata": {
    "surface": "explore_grid"
  }
}
```
- Response:
```json
{
  "ok": true,
  "postId": "post-id",
  "topic": "anime|null",
  "eventType": "IMPRESSION",
  "weight": 0.2
}
```

### `POST /explore/events/batch`
- Auth: Bearer JWT
- Request body:
```json
{
  "events": [
    {
      "postId": "post-id",
      "eventType": "IMPRESSION",
      "metadata": {}
    }
  ]
}
```
- Constraints:
  - `events` la array 1..100 phan tu.
- Response:
```json
{
  "ok": true,
  "requested": 3,
  "accepted": 3,
  "recordedCount": 2,
  "skippedCount": 1,
  "groupedByType": {
    "IMPRESSION": 1,
    "LIKE": 1
  },
  "topicUpdates": [
    {
      "topic": "anime",
      "totalWeight": 3.2
    }
  ],
  "hiddenPostCount": 0
}
```

## Jobs

### `POST /jobs/video`
- Auth: Bearer JWT
- Request body:
```json
{
  "inputAssetId": "uuid-optional",
  "prompt": "string",
  "negativePrompt": "string-optional",
  "presetId": "preview_ltx_i2v|turbo_wan22_i2v_a14b|standard_wan22_ti2v|standard_wan22_ti2v_8s|quality_hunyuan_i2v",
  "includeBackgroundAudio": true
}
```
- Ghi chu:
  - `preview_ltx_i2v`, `turbo_wan22_i2v_a14b`, `quality_hunyuan_i2v` bat buoc co `inputAssetId`.
  - `standard_wan22_ti2v` va `standard_wan22_ti2v_8s` cho phep bo `inputAssetId`.
  - Neu bo `inputAssetId` voi 2 preset Wan TI2V tren, job se chay theo `workflow = T2V`.
  - Neu co `inputAssetId`, job se chay theo `workflow = I2V`.
- Vi du T2V 8s:
```json
{
  "prompt": "A cinematic night street shot with natural motion and stable camera movement.",
  "negativePrompt": "blurry, low quality, distorted anatomy, flicker",
  "presetId": "standard_wan22_ti2v_8s",
  "includeBackgroundAudio": false
}
```
- Response:
```json
{
  "jobId": "uuid",
  "status": "QUEUED",
  "creditCost": 10,
  "provider": "modal",
  "modelName": "wan2.2-ti2v-standard",
  "presetId": "standard_wan22_ti2v",
  "tier": "standard|preview|quality|turbo",
  "turboEnabled": false,
  "estimatedDurationSeconds": 420,
  "includeBackgroundAudio": true
}
```

### `GET /jobs`
- Auth: Bearer JWT
- Request: none
- Response:
```json
[
  {
    "id": "uuid",
    "type": "IMAGE_TO_VIDEO",
    "status": "PENDING|QUEUED|PROCESSING|COMPLETED|FAILED|CANCELLED",
    "progress": 1,
    "prompt": "string",
    "provider": "string|null",
    "modelName": "string|null",
    "presetId": "string|null",
    "tier": "string|null",
    "estimatedDurationSeconds": 420,
    "workflow": "I2V|TI2V|T2V|null",
    "includeBackgroundAudio": true,
    "createdAt": "datetime",
    "updatedAt": "datetime",
    "output": {
      "assetId": "uuid",
      "mimeType": "video/mp4",
      "downloadUrl": "signed-url",
      "expiresIn": 3600
    },
    "thumbnail": {
      "assetId": "uuid",
      "mimeType": "image/jpeg",
      "downloadUrl": "signed-url",
      "expiresIn": 3600
    }
  }
]
```
- `output`/`thumbnail` co the `null`.

### `GET /jobs/:id`
- Auth: Bearer JWT
- Path param: `id`
- Response:
```json
{
  "id": "uuid",
  "type": "IMAGE_TO_VIDEO",
  "status": "PENDING|QUEUED|PROCESSING|COMPLETED|FAILED|CANCELLED",
  "progress": 0,
  "prompt": "string",
  "negativePrompt": "string|null",
  "provider": "string|null",
  "modelName": "string|null",
  "presetId": "string|null",
  "tier": "string|null",
  "estimatedDurationSeconds": 420,
  "workflow": "I2V|TI2V|T2V|null",
  "includeBackgroundAudio": true,
  "creditCost": 10,
  "errorMessage": "string|null",
  "createdAt": "datetime",
  "updatedAt": "datetime",
  "startedAt": "datetime|null",
  "completedAt": "datetime|null",
  "failedAt": "datetime|null",
  "inputAssets": [
    {
      "id": "uuid",
      "userId": "uuid",
      "role": "INPUT",
      "versions": [
        {
          "bucket": "string",
          "objectKey": "string",
          "mimeType": "string|null",
          "sizeBytes": 12345,
          "createdAt": "datetime"
        }
      ]
    }
  ],
  "outputAssets": [],
  "output": {
    "assetId": "uuid",
    "bucket": "string",
    "objectKey": "string",
    "mimeType": "string|null",
    "sizeBytes": 12345,
    "downloadUrl": "signed-url",
    "expiresIn": 3600,
    "createdAt": "datetime"
  },
  "logs": [
    {
      "id": "uuid",
      "jobId": "uuid",
      "message": "Job queued",
      "createdAt": "datetime"
    }
  ],
  "thumbnailAssets": [],
  "thumbnail": {
    "assetId": "uuid",
    "bucket": "string",
    "objectKey": "string",
    "mimeType": "string|null",
    "sizeBytes": 12345,
    "downloadUrl": "signed-url",
    "expiresIn": 3600,
    "createdAt": "datetime"
  }
}
```
- `output`, `thumbnail` co the `null`.

### `GET /jobs/:id/result`
- Auth: Bearer JWT
- Path param: `id`
- Response neu chua co output:
```json
{
  "jobId": "uuid",
  "status": "PENDING|QUEUED|PROCESSING|FAILED|CANCELLED",
  "progress": 0,
  "creditCost": 10,
  "resultReady": false
}
```
- Response neu da co output:
```json
{
  "jobId": "uuid",
  "status": "COMPLETED",
  "progress": 100,
  "creditCost": 10,
  "resultReady": true,
  "provider": "modal",
  "modelName": "string|null",
  "presetId": "string|null",
  "tier": "string|null",
  "estimatedDurationSeconds": 420,
  "workflow": "I2V|TI2V|T2V|null",
  "includeBackgroundAudio": true,
  "assetId": "uuid",
  "bucket": "string",
  "objectKey": "string",
  "mimeType": "video/mp4",
  "sizeBytes": 12345,
  "downloadUrl": "signed-url",
  "expiresIn": 3600,
  "createdAt": "datetime",
  "thumbnail": {
    "assetId": "uuid",
    "bucket": "string",
    "objectKey": "string",
    "mimeType": "image/jpeg",
    "sizeBytes": 12345,
    "downloadUrl": "signed-url",
    "expiresIn": 3600,
    "createdAt": "datetime"
  }
}
```
- `thumbnail` co the `null`.

### `GET /jobs/:id/events` (SSE)
- Auth: Bearer JWT
- Header:
  - `Accept: text/event-stream`
- Path param: `id`
- Response stream event:
```text
event: snapshot|status|log|heartbeat
data: {...}
```

- `snapshot` data:
```json
{
  "jobId": "uuid",
  "status": "PENDING|QUEUED|PROCESSING|COMPLETED|FAILED|CANCELLED",
  "progress": 0,
  "errorMessage": "string|null",
  "provider": "string|null",
  "modelName": "string|null",
  "presetId": "string|null",
  "tier": "string|null",
  "estimatedDurationSeconds": 420,
  "workflow": "I2V|TI2V|T2V|null",
  "includeBackgroundAudio": true,
  "createdAt": "iso-datetime",
  "updatedAt": "iso-datetime",
  "startedAt": "iso-datetime|null",
  "completedAt": "iso-datetime|null",
  "failedAt": "iso-datetime|null",
  "logs": [
    {
      "jobId": "uuid",
      "message": "string",
      "createdAt": "iso-datetime"
    }
  ]
}
```

- `status` data:
```json
{
  "jobId": "uuid",
  "status": "PENDING|QUEUED|PROCESSING|COMPLETED|FAILED|CANCELLED",
  "progress": 0,
  "errorMessage": "string|null",
  "startedAt": "iso-datetime|null",
  "completedAt": "iso-datetime|null",
  "failedAt": "iso-datetime|null",
  "occurredAt": "iso-datetime",
  "provider": "string|null",
  "providerAttempt": 1,
  "fallbackTriggered": false
}
```

- `log` data:
```json
{
  "jobId": "uuid",
  "message": "string",
  "createdAt": "iso-datetime",
  "provider": "string|null",
  "providerAttempt": 1,
  "fallbackTriggered": false
}
```

- `heartbeat` data:
```json
{
  "jobId": "uuid",
  "timestamp": "iso-datetime"
}
```

### `GET /jobs/events/me` (SSE)
- Auth: Bearer JWT
- Header:
  - `Accept: text/event-stream`
- Response stream event:
```text
event: notification
data: {...}
```

- `notification` data:
```json
{
  "userId": "uuid",
  "jobId": "uuid",
  "kind": "JOB_QUEUED|JOB_RETRYING|JOB_PROVIDER_FALLBACK|JOB_COMPLETED|JOB_FAILED|JOB_CANCELLED",
  "severity": "info|success|warning|error",
  "title": "string",
  "message": "string",
  "status": "PENDING|QUEUED|PROCESSING|COMPLETED|FAILED|CANCELLED",
  "progress": 0,
  "provider": "string|null",
  "modelName": "string|null",
  "presetId": "string|null",
  "workflow": "I2V|TI2V|T2V|null",
  "errorMessage": "string|null",
  "resultReady": false,
  "occurredAt": "iso-datetime"
}
```

- `GET /jobs/:id/events` phu hop cho man chi tiet tung job.
- `GET /jobs/events/me` phu hop cho toast / banner notification toan cuc cua user.

### `POST /jobs/:id/cancel`
- Auth: Bearer JWT
- Path param: `id`
- Response:
```json
{
  "jobId": "uuid",
  "status": "CANCELLED",
  "refundedCredit": 10
}
```

## Billing

### `GET /billing/catalog`
- Auth: Bearer JWT
- Request: none
- Response:
```json
{
  "proPlan": {
    "code": "PRO_MONTHLY_14_99",
    "label": "Pro Monthly",
    "amountUsd": "14.99",
    "amountVnd": 375000,
    "credits": 1000,
    "durationDays": 30,
    "dailyFreePremiumCredits": 20,
    "proOnlyPresets": [
      "turbo_wan22_i2v_a14b",
      "quality_hunyuan_i2v"
    ]
  },
  "creditTopupPackages": [
    {
      "code": "TOPUP_STARTER_4_99",
      "label": "Starter",
      "amountUsd": "4.99",
      "amountVnd": 125000,
      "credits": 300
    }
  ]
}
```

### `POST /billing/orders`
- Auth: Bearer JWT
- Request body:
```json
{
  "type": "CREDIT_TOPUP|PRO_SUBSCRIPTION",
  "provider": "MOMO|PAYOS|BANK_TRANSFER",
  "packageCode": "optional"
}
```
- Response theo provider:
  - `BANK_TRANSFER`:
```json
{
  "id": "uuid",
  "userId": "uuid",
  "provider": "BANK_TRANSFER",
  "type": "CREDIT_TOPUP|PRO_SUBSCRIPTION",
  "status": "PENDING",
  "packageCode": "string",
  "amountUsd": "decimal-string",
  "creditAmount": 700,
  "proDurationDays": 0,
  "createdAt": "datetime",
  "expiresAt": "datetime",
  "metadata": {},
  "amountVnd": 250000,
  "note": "Order created. ..."
}
```
  - `MOMO`:
```json
{
  "id": "uuid",
  "provider": "MOMO",
  "type": "CREDIT_TOPUP|PRO_SUBSCRIPTION",
  "status": "PENDING",
  "packageCode": "string",
  "amountUsd": "decimal-string",
  "creditAmount": 700,
  "proDurationDays": 0,
  "createdAt": "datetime",
  "expiresAt": "datetime",
  "amountVnd": 250000,
  "payUrl": "https://...",
  "shortLink": "string|null",
  "deeplink": "string|null",
  "qrCodeUrl": "string|null",
  "note": "MoMo payment link created successfully."
}
```
  - `PAYOS`:
```json
{
  "id": "uuid",
  "provider": "PAYOS",
  "type": "CREDIT_TOPUP|PRO_SUBSCRIPTION",
  "status": "PENDING",
  "packageCode": "string",
  "amountUsd": "decimal-string",
  "creditAmount": 700,
  "proDurationDays": 0,
  "createdAt": "datetime",
  "expiresAt": "datetime",
  "amountVnd": 250000,
  "payUrl": "https://...",
  "qrCode": "string|null",
  "paymentLinkId": "string|number",
  "orderCode": "number",
  "note": "payOS payment link created successfully."
}
```

### `GET /billing/orders/me`
- Auth: Bearer JWT
- Request: none
- Response:
```json
[
  {
    "id": "uuid",
    "provider": "MOMO|PAYOS|BANK_TRANSFER",
    "type": "CREDIT_TOPUP|PRO_SUBSCRIPTION",
    "status": "PENDING|PAID|FAILED|CANCELED|EXPIRED",
    "packageCode": "string",
    "amountUsd": "decimal-string",
    "creditAmount": 700,
    "proDurationDays": 0,
    "providerOrderId": "string|null",
    "paidAt": "datetime|null",
    "createdAt": "datetime",
    "expiresAt": "datetime|null",
    "metadata": {}
  }
]
```

### `POST /billing/orders/:id/mark-paid`
- Auth: Bearer JWT + ADMIN
- Path param: `id`
- Request body:
```json
{
  "providerOrderId": "optional"
}
```
- Response (neu da paid):
```json
{
  "orderId": "uuid",
  "status": "PAID",
  "message": "Order already marked as paid"
}
```
- Response (mark thanh cong):
```json
{
  "id": "uuid",
  "status": "PAID",
  "type": "CREDIT_TOPUP|PRO_SUBSCRIPTION",
  "packageCode": "string",
  "amountUsd": "decimal-string",
  "creditAmount": 700,
  "proDurationDays": 0,
  "providerOrderId": "string|null",
  "paidAt": "datetime",
  "nextProExpiresAt": "datetime|null"
}
```

### `POST /billing/webhooks/momo`
- Auth: Public
- Request body: raw payload tu MoMo (khong co DTO co dinh)
- Response: HTTP `204 No Content`.

### `POST /billing/webhooks/payos`
- Auth: Public
- Request body: raw payload tu payOS (khong co DTO co dinh)
- Response: HTTP `204 No Content`.

### `POST /billing/webhooks/payos/confirm`
- Auth: Bearer JWT + ADMIN
- Request body:
```json
{
  "webhookUrl": "https://api.example.com/billing/webhooks/payos"
}
```
- `webhookUrl` optional (neu khong truyen thi lay env `PAYOS_WEBHOOK_URL`).
- Response:
```json
{
  "webhookUrl": "https://...",
  "response": {}
}
```

## Modal

### `POST /modal/generate-video`
- Auth: Bearer JWT
- Request body:
```json
{
  "prompt": "string",
  "negativePrompt": "string-optional",
  "inputImageUrl": "string-optional",
  "jobId": "string-optional",
  "provider": "string-optional",
  "modelName": "string-optional",
  "presetId": "string-optional",
  "userId": "string-optional",
  "workflow": "string-optional"
}
```
- Response: tra thang payload `res.data` tu Modal API (shape phu thuoc service ben ngoai).

## 4) Luu y implementation hien tai

- `Comments/PostLikes` duoc thiet ke de dung route nested:
  - `/posts/:postId/comments`
  - `/posts/:postId/post-likes`
- `POST /posts` va `PATCH /posts/:id` nhan them `videoUrl` / `thumbnailUrl` de dong bo payload FE, nhung backend khong persist 2 field nay vao `Post`.
- `GET /explore/search` tra ve ExploreItem public (khong phai danh sach Post thuần).

- `PATCH /users/me` va `DELETE /users/me`:
  - Dang tra raw `User` co field `password` (da hash). FE co the nhan field nay trong response.
