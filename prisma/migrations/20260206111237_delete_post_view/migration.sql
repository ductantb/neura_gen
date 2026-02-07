/*
  Warnings:

  - You are about to drop the `PostView` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "PostView" DROP CONSTRAINT "PostView_postId_fkey";

-- DropTable
DROP TABLE "PostView";
