-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Discipline" AS ENUM ('SINGLES', 'DOUBLES', 'MIXED_DOUBLES');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('TRAINING', 'CASUAL', 'COMPETITIVE', 'TOURNAMENT', 'COACHING', 'OTHER');

-- CreateEnum
CREATE TYPE "MatchResult" AS ENUM ('WIN', 'LOSS', 'DRAW');

-- CreateEnum
CREATE TYPE "MatchSide" AS ENUM ('HOME', 'AWAY');

-- CreateEnum
CREATE TYPE "PlayerRelationship" AS ENUM ('SELF', 'FRIEND', 'REGULAR_OPPONENT', 'REGULAR_PARTNER', 'COACH', 'OTHER');

-- CreateEnum
CREATE TYPE "DominantHand" AS ENUM ('RIGHT', 'LEFT', 'AMBIDEXTROUS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PlayingLevel" AS ENUM ('BEGINNER', 'IMPROVER', 'INTERMEDIATE', 'ADVANCED', 'COMPETITIVE', 'ELITE');

-- CreateEnum
CREATE TYPE "PlayingStyle" AS ENUM ('ATTACKING', 'DEFENSIVE', 'ALL_ROUND', 'DECEPTIVE', 'FAST_FLAT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PerformanceTag" AS ENUM ('STRONG_DEFENCE', 'STRONG_ATTACK', 'GOOD_NET_PLAY', 'GOOD_SMASH', 'GREAT_TEAMWORK', 'POOR_SERVE', 'POOR_RETURN', 'POOR_POSITIONING', 'UNFORCED_ERRORS', 'COMMUNICATION_ISSUES', 'FATIGUE', 'NERVOUS');

-- CreateEnum
CREATE TYPE "GoalMetric" AS ENUM ('MATCHES_PLAYED', 'MATCHES_WON', 'SESSIONS_PLAYED', 'WIN_RATE', 'GAME_WIN_RATE', 'POINT_DIFFERENTIAL', 'WIN_STREAK', 'PLAYING_MINUTES');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'MISSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'FRIENDS', 'PUBLIC');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('STREAK', 'MILESTONE', 'GOAL_PROGRESS', 'GOAL_DEADLINE', 'INACTIVITY', 'ACHIEVEMENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFICATION');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en-GB',
    "lastLoginAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dateOfBirth" DATE,
    "playingLevel" "PlayingLevel" NOT NULL DEFAULT 'INTERMEDIATE',
    "preferredDiscipline" "Discipline",
    "dominantHand" "DominantHand" NOT NULL DEFAULT 'UNKNOWN',
    "playingStyle" "PlayingStyle" NOT NULL DEFAULT 'UNKNOWN',
    "preferredRacket" TEXT,
    "preferredStrings" TEXT,
    "avatarUrl" TEXT,
    "notes" TEXT,
    "defaultPointsToWin" INTEGER NOT NULL DEFAULT 21,
    "defaultWinBy" INTEGER NOT NULL DEFAULT 2,
    "defaultMaxPoints" INTEGER NOT NULL DEFAULT 30,
    "defaultBestOf" INTEGER NOT NULL DEFAULT 3,
    "defaultVisibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "nickname" TEXT,
    "relationship" "PlayerRelationship" NOT NULL DEFAULT 'OTHER',
    "playingLevel" "PlayingLevel",
    "dominantHand" "DominantHand" NOT NULL DEFAULT 'UNKNOWN',
    "playingStyle" "PlayingStyle" NOT NULL DEFAULT 'UNKNOWN',
    "avatarUrl" TEXT,
    "notes" TEXT,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "linkedUserId" UUID,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 1200,
    "ratingDeviation" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "location" TEXT,
    "city" TEXT,
    "country" CHAR(2),
    "isIndoor" BOOLEAN NOT NULL DEFAULT true,
    "courtCount" INTEGER,
    "notes" TEXT,
    "isFavourite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "sessionType" "SessionType" NOT NULL DEFAULT 'CASUAL',
    "venueId" UUID,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL,
    "orderInSession" INTEGER NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "durationSeconds" INTEGER,
    "pointsToWin" INTEGER NOT NULL DEFAULT 21,
    "winBy" INTEGER NOT NULL DEFAULT 2,
    "maxPoints" INTEGER NOT NULL DEFAULT 30,
    "bestOf" INTEGER NOT NULL DEFAULT 3,
    "difficulty" INTEGER,
    "energyLevel" INTEGER,
    "confidence" INTEGER,
    "feeling" INTEGER,
    "notes" TEXT,
    "result" "MatchResult" NOT NULL,
    "gamesWon" INTEGER NOT NULL,
    "gamesLost" INTEGER NOT NULL,
    "pointsScored" INTEGER NOT NULL,
    "pointsConceded" INTEGER NOT NULL,
    "pointDifferential" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "side" "MatchSide" NOT NULL,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "gameNumber" INTEGER NOT NULL,
    "myScore" INTEGER NOT NULL,
    "opponentScore" INTEGER NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_tags" (
    "matchId" UUID NOT NULL,
    "tag" "PerformanceTag" NOT NULL,

    CONSTRAINT "match_tags_pkey" PRIMARY KEY ("matchId","tag")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "metric" "GoalMetric" NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "discipline" "Discipline",
    "startsOn" DATE NOT NULL,
    "deadline" DATE,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "achievedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "achievementCode" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valueAtUnlock" INTEGER NOT NULL,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_events" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL,
    "ratingBefore" DOUBLE PRECISION NOT NULL,
    "ratingAfter" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "opponentRating" DOUBLE PRECISION NOT NULL,
    "kFactor" DOUBLE PRECISION NOT NULL,
    "result" "MatchResult" NOT NULL,

    CONSTRAINT "rating_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_disabledAt_idx" ON "users"("disabledAt");

-- CreateIndex
CREATE UNIQUE INDEX "player_profiles_userId_key" ON "player_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_revokedAt_idx" ON "refresh_tokens"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_tokens_tokenHash_key" ON "one_time_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "one_time_tokens_userId_purpose_idx" ON "one_time_tokens"("userId", "purpose");

-- CreateIndex
CREATE INDEX "one_time_tokens_expiresAt_idx" ON "one_time_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "players_userId_relationship_idx" ON "players"("userId", "relationship");

-- CreateIndex
CREATE INDEX "players_userId_isSelf_idx" ON "players"("userId", "isSelf");

-- CreateIndex
CREATE INDEX "players_linkedUserId_idx" ON "players"("linkedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "players_userId_normalizedName_key" ON "players"("userId", "normalizedName");

-- CreateIndex
CREATE INDEX "venues_userId_isFavourite_idx" ON "venues"("userId", "isFavourite");

-- CreateIndex
CREATE UNIQUE INDEX "venues_userId_normalizedName_key" ON "venues"("userId", "normalizedName");

-- CreateIndex
CREATE INDEX "sessions_userId_date_idx" ON "sessions"("userId", "date" DESC);

-- CreateIndex
CREATE INDEX "sessions_userId_venueId_idx" ON "sessions"("userId", "venueId");

-- CreateIndex
CREATE INDEX "sessions_userId_sessionType_idx" ON "sessions"("userId", "sessionType");

-- CreateIndex
CREATE INDEX "matches_userId_playedAt_idx" ON "matches"("userId", "playedAt" DESC);

-- CreateIndex
CREATE INDEX "matches_userId_discipline_playedAt_idx" ON "matches"("userId", "discipline", "playedAt" DESC);

-- CreateIndex
CREATE INDEX "matches_userId_result_idx" ON "matches"("userId", "result");

-- CreateIndex
CREATE INDEX "matches_sessionId_idx" ON "matches"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "matches_sessionId_orderInSession_key" ON "matches"("sessionId", "orderInSession");

-- CreateIndex
CREATE INDEX "match_participants_playerId_side_idx" ON "match_participants"("playerId", "side");

-- CreateIndex
CREATE INDEX "match_participants_matchId_side_idx" ON "match_participants"("matchId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "match_participants_matchId_playerId_key" ON "match_participants"("matchId", "playerId");

-- CreateIndex
CREATE INDEX "games_matchId_idx" ON "games"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "games_matchId_gameNumber_key" ON "games"("matchId", "gameNumber");

-- CreateIndex
CREATE INDEX "match_tags_tag_idx" ON "match_tags"("tag");

-- CreateIndex
CREATE INDEX "goals_userId_status_idx" ON "goals"("userId", "status");

-- CreateIndex
CREATE INDEX "goals_userId_deadline_idx" ON "goals"("userId", "deadline");

-- CreateIndex
CREATE INDEX "user_achievements_userId_unlockedAt_idx" ON "user_achievements"("userId", "unlockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_userId_achievementCode_key" ON "user_achievements"("userId", "achievementCode");

-- CreateIndex
CREATE INDEX "rating_events_userId_playedAt_idx" ON "rating_events"("userId", "playedAt");

-- CreateIndex
CREATE UNIQUE INDEX "rating_events_matchId_key" ON "rating_events"("matchId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_tags" ADD CONSTRAINT "match_tags_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_events" ADD CONSTRAINT "rating_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_events" ADD CONSTRAINT "rating_events_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
