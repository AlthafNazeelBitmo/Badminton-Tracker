/**
 * Rebuilds every derived value from the raw match data.
 *
 * The platform's central rule is that games are the source of truth and everything else
 * is derived. A handful of derived values are nevertheless stored — the match result
 * columns (so the match list can filter and sort in the database) and rating events (so
 * history renders without a replay per request). This command is the invalidation
 * mechanism that keeps that trade-off honest:
 *
 *   - after changing a formula,
 *   - after a bulk import or a manual database edit,
 *   - or whenever a stored value is suspected of having drifted.
 *
 * It is safe to run at any time and is idempotent. Nothing here can invent data: every
 * value it writes is recomputed from games that already exist.
 *
 * Usage:
 *   npm run recompute -w @badminton/api            # every user
 *   npm run recompute -w @badminton/api -- --user <id>
 *   npm run recompute -w @badminton/api -- --check  # report drift without writing
 */
import { PrismaClient } from '@prisma/client';
import {
  deriveMatch,
  replayRatings,
  ratingDeviation,
  DEFAULT_RATING_CONFIG,
} from '@badminton/analytics';

const prisma = new PrismaClient();

interface Options {
  userId: string | null;
  checkOnly: boolean;
}

function parseArgs(argv: string[]): Options {
  const userIndex = argv.indexOf('--user');
  return {
    userId: userIndex === -1 ? null : (argv[userIndex + 1] ?? null),
    checkOnly: argv.includes('--check'),
  };
}

async function recomputeMatchColumns(userId: string, checkOnly: boolean): Promise<number> {
  const matches = await prisma.match.findMany({
    where: { userId },
    include: { games: { orderBy: { gameNumber: 'asc' } } },
  });

  let drifted = 0;

  for (const match of matches) {
    const derived = deriveMatch({
      games: match.games.map((game) => ({
        myScore: game.myScore,
        opponentScore: game.opponentScore,
      })),
      scoring: {
        pointsToWin: match.pointsToWin,
        winBy: match.winBy,
        maxPoints: match.maxPoints,
        bestOf: match.bestOf,
      },
    });

    const changed =
      match.result !== derived.result ||
      match.gamesWon !== derived.gamesWon ||
      match.gamesLost !== derived.gamesLost ||
      match.pointsScored !== derived.pointsScored ||
      match.pointsConceded !== derived.pointsConceded ||
      match.pointDifferential !== derived.pointDifferential;

    if (!changed) continue;
    drifted += 1;

    console.info(
      `  match ${match.id}: ${match.result} ${match.pointDifferential} -> ${derived.result} ${derived.pointDifferential}`,
    );

    if (!checkOnly) {
      await prisma.match.update({
        where: { id: match.id },
        data: {
          result: derived.result,
          gamesWon: derived.gamesWon,
          gamesLost: derived.gamesLost,
          pointsScored: derived.pointsScored,
          pointsConceded: derived.pointsConceded,
          pointDifferential: derived.pointDifferential,
        },
      });
    }
  }

  return drifted;
}

async function recomputeRatings(userId: string, checkOnly: boolean): Promise<number> {
  const matches = await prisma.match.findMany({
    where: { userId },
    include: {
      games: { orderBy: { gameNumber: 'asc' } },
      participants: true,
      tags: true,
      session: { select: { sessionType: true, venueId: true } },
    },
    orderBy: { playedAt: 'asc' },
  });

  const replay = replayRatings(
    matches.map((match) => ({
      id: match.id,
      sessionId: match.sessionId,
      playedAt: match.playedAt,
      orderInSession: match.orderInSession,
      discipline: match.discipline,
      sessionType: match.session.sessionType,
      venueId: match.session.venueId,
      venueName: null,
      scoring: {
        pointsToWin: match.pointsToWin,
        winBy: match.winBy,
        maxPoints: match.maxPoints,
        bestOf: match.bestOf,
      },
      durationSeconds: match.durationSeconds,
      difficulty: match.difficulty,
      tags: match.tags.map((tag) => tag.tag),
      partnerIds: match.participants
        .filter((participant) => participant.side === 'HOME' && !participant.isSelf)
        .map((participant) => participant.playerId),
      opponentIds: match.participants
        .filter((participant) => participant.side === 'AWAY')
        .map((participant) => participant.playerId),
      games: match.games.map((game) => ({
        myScore: game.myScore,
        opponentScore: game.opponentScore,
      })),
    })),
    DEFAULT_RATING_CONFIG,
  );

  if (checkOnly) return replay.events.length;

  await prisma.$transaction(async (tx) => {
    await tx.ratingEvent.deleteMany({ where: { userId } });

    if (replay.events.length > 0) {
      await tx.ratingEvent.createMany({
        data: replay.events.map((event) => ({
          userId,
          matchId: event.matchId,
          discipline: event.discipline,
          playedAt: event.playedAt,
          ratingBefore: event.ratingBefore,
          ratingAfter: event.ratingAfter,
          delta: event.delta,
          opponentRating: event.opponentRating,
          kFactor: event.kFactor,
          result: event.result,
        })),
      });
    }

    for (const [playerId, state] of replay.playerRatings) {
      await tx.player.updateMany({
        where: { id: playerId, userId },
        data: { rating: state.rating, ratingDeviation: ratingDeviation(state.matches) },
      });
    }

    await tx.player.updateMany({
      where: { userId, isSelf: true },
      data: {
        rating: replay.userRating.rating,
        ratingDeviation: ratingDeviation(replay.userRating.matches),
      },
    });
  });

  return replay.events.length;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const users = options.userId
    ? await prisma.user.findMany({
        where: { id: options.userId },
        select: { id: true, email: true },
      })
    : await prisma.user.findMany({ select: { id: true, email: true } });

  if (users.length === 0) {
    console.warn('No matching users found.');
    return;
  }

  console.info(
    options.checkOnly
      ? `Checking ${users.length} user(s) for drift (no writes)…`
      : `Recomputing derived data for ${users.length} user(s)…`,
  );

  let totalDrift = 0;

  for (const user of users) {
    console.info(`\n${user.email}`);
    const drifted = await recomputeMatchColumns(user.id, options.checkOnly);
    const rated = await recomputeRatings(user.id, options.checkOnly);
    totalDrift += drifted;

    console.info(
      `  ${drifted === 0 ? 'match columns consistent' : `${drifted} match column(s) corrected`}, ${rated} rating event(s)`,
    );
  }

  if (options.checkOnly && totalDrift > 0) {
    console.warn(`\n${totalDrift} match(es) have drifted. Re-run without --check to correct them.`);
    process.exitCode = 1;
  } else {
    console.info('\nDone.');
  }
}

main()
  .catch((error: unknown) => {
    console.error('Recompute failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
