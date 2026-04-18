-- CreateEnum
CREATE TYPE "ExploreEventType" AS ENUM (
  'IMPRESSION',
  'OPEN_POST',
  'WATCH_3S',
  'WATCH_50',
  'LIKE',
  'COMMENT',
  'FOLLOW_CREATOR',
  'HIDE'
);

-- CreateTable
CREATE TABLE "ExploreInteraction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "topic" TEXT,
  "eventType" "ExploreEventType" NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExploreInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTopicProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserTopicProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiddenPost" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HiddenPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExploreInteraction_userId_createdAt_idx" ON "ExploreInteraction"("userId", "createdAt");
CREATE INDEX "ExploreInteraction_postId_createdAt_idx" ON "ExploreInteraction"("postId", "createdAt");
CREATE INDEX "ExploreInteraction_userId_eventType_createdAt_idx" ON "ExploreInteraction"("userId", "eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserTopicProfile_userId_topic_key" ON "UserTopicProfile"("userId", "topic");
CREATE INDEX "UserTopicProfile_userId_score_idx" ON "UserTopicProfile"("userId", "score");
CREATE INDEX "UserTopicProfile_topic_idx" ON "UserTopicProfile"("topic");

-- CreateIndex
CREATE UNIQUE INDEX "HiddenPost_userId_postId_key" ON "HiddenPost"("userId", "postId");
CREATE INDEX "HiddenPost_userId_createdAt_idx" ON "HiddenPost"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ExploreInteraction"
ADD CONSTRAINT "ExploreInteraction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExploreInteraction"
ADD CONSTRAINT "ExploreInteraction_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "Post"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserTopicProfile"
ADD CONSTRAINT "UserTopicProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HiddenPost"
ADD CONSTRAINT "HiddenPost_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HiddenPost"
ADD CONSTRAINT "HiddenPost_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "Post"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
