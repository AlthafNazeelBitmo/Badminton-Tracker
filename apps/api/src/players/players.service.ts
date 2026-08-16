import { Injectable } from '@nestjs/common';
import type { Prisma, Player } from '@prisma/client';
import type {
  CreatePlayerInput,
  ListPlayersQuery,
  Paginated,
  PlayerRef,
  PlayerSummary,
  UpdatePlayerInput,
} from '@badminton/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors';
import { normalizeName, tidyDisplayName } from '../common/normalize';
import { paginate, pageMeta } from '../common/pagination';

/**
 * The address book.
 *
 * Everything here is scoped by `userId`, taken from the authenticated session and never
 * from client input, so one user's players are unreachable from another's session.
 */
@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: ListPlayersQuery): Promise<Paginated<PlayerSummary>> {
    const where: Prisma.PlayerWhereInput = {
      userId,
      ...(query.includeSelf ? {} : { isSelf: false }),
      ...(query.relationship ? { relationship: query.relationship } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { nickname: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const { skip, take } = paginate(query);

    // `MOST_PLAYED` and `RECENT` need aggregate information that lives on
    // match_participants, so they are ordered after loading rather than in SQL.
    const orderBy: Prisma.PlayerOrderByWithRelationInput =
      query.sort === 'NAME' ? { name: 'asc' } : { updatedAt: 'desc' };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.player.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          _count: { select: { participants: true } },
          participants: {
            select: { match: { select: { playedAt: true } } },
            orderBy: { match: { playedAt: 'desc' } },
            take: 1,
          },
        },
      }),
      this.prisma.player.count({ where }),
    ]);

    const items = rows.map(toSummary);

    if (query.sort === 'MOST_PLAYED') {
      items.sort((a, b) => b.matchesPlayed - a.matchesPlayed);
    } else if (query.sort === 'RECENT') {
      items.sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''));
    }

    return { items, meta: pageMeta(query, totalItems) };
  }

  async findOne(userId: string, id: string): Promise<PlayerSummary> {
    const player = await this.prisma.player.findFirst({
      where: { id, userId },
      include: {
        _count: { select: { participants: true } },
        participants: {
          select: { match: { select: { playedAt: true } } },
          orderBy: { match: { playedAt: 'desc' } },
          take: 1,
        },
      },
    });

    if (!player) throw new NotFoundError('Player');
    return toSummary(player);
  }

  async create(userId: string, input: CreatePlayerInput): Promise<PlayerSummary> {
    const name = tidyDisplayName(input.name);
    const normalizedName = normalizeName(name);

    if (input.relationship === 'SELF') {
      throw new ValidationError('The SELF relationship is reserved for your own profile.');
    }

    const existing = await this.prisma.player.findUnique({
      where: { userId_normalizedName: { userId, normalizedName } },
    });
    if (existing) throw new ConflictError(`You already have a player called "${existing.name}".`);

    const created = await this.prisma.player.create({
      data: {
        userId,
        name,
        normalizedName,
        nickname: input.nickname ?? null,
        relationship: input.relationship,
        playingLevel: input.playingLevel ?? null,
        dominantHand: input.dominantHand,
        playingStyle: input.playingStyle,
        avatarUrl: input.avatarUrl ?? null,
        notes: input.notes ?? null,
      },
      include: {
        _count: { select: { participants: true } },
        participants: {
          select: { match: { select: { playedAt: true } } },
          orderBy: { match: { playedAt: 'desc' } },
          take: 1,
        },
      },
    });

    return toSummary(created);
  }

  async update(userId: string, id: string, input: UpdatePlayerInput): Promise<PlayerSummary> {
    const player = await this.prisma.player.findFirst({ where: { id, userId } });
    if (!player) throw new NotFoundError('Player');

    if (input.relationship === 'SELF' && !player.isSelf) {
      throw new ValidationError('The SELF relationship is reserved for your own profile.');
    }
    if (player.isSelf && input.relationship && input.relationship !== 'SELF') {
      throw new ValidationError('Your own player entry must keep the SELF relationship.');
    }

    const data: Prisma.PlayerUpdateInput = {
      nickname: input.nickname === undefined ? undefined : input.nickname,
      relationship: input.relationship,
      playingLevel: input.playingLevel === undefined ? undefined : input.playingLevel,
      dominantHand: input.dominantHand,
      playingStyle: input.playingStyle,
      avatarUrl: input.avatarUrl === undefined ? undefined : input.avatarUrl,
      notes: input.notes === undefined ? undefined : input.notes,
    };

    if (input.name !== undefined) {
      const name = tidyDisplayName(input.name);
      const normalizedName = normalizeName(name);
      const clash = await this.prisma.player.findUnique({
        where: { userId_normalizedName: { userId, normalizedName } },
      });
      if (clash && clash.id !== id) {
        throw new ConflictError(`You already have a player called "${clash.name}".`);
      }
      data.name = name;
      data.normalizedName = normalizedName;
    }

    const updated = await this.prisma.player.update({
      where: { id },
      data,
      include: {
        _count: { select: { participants: true } },
        participants: {
          select: { match: { select: { playedAt: true } } },
          orderBy: { match: { playedAt: 'desc' } },
          take: 1,
        },
      },
    });

    return toSummary(updated);
  }

  /**
   * Deleting a player who has played would cascade away their matches, taking real
   * results with them. That is refused: history is the asset this product exists to
   * protect. Merging into another player is offered instead.
   */
  async remove(userId: string, id: string): Promise<void> {
    const player = await this.prisma.player.findFirst({
      where: { id, userId },
      include: { _count: { select: { participants: true } } },
    });
    if (!player) throw new NotFoundError('Player');
    if (player.isSelf) throw new ValidationError('Your own player entry cannot be deleted.');

    if (player._count.participants > 0) {
      throw new ConflictError(
        `${player.name} appears in ${player._count.participants} match(es). Merge them into another player instead of deleting.`,
      );
    }

    await this.prisma.player.delete({ where: { id } });
  }

  /**
   * Merges a duplicate into a target player, moving their match appearances across.
   *
   * Duplicates are the inevitable cost of letting names be typed during quick entry, so
   * the fix has to be first-class. Appearances that would collide (both players in the
   * same match) are dropped rather than violating the one-appearance-per-match rule.
   */
  async merge(userId: string, sourceId: string, targetId: string): Promise<PlayerSummary> {
    if (sourceId === targetId) throw new ValidationError('A player cannot be merged into itself.');

    const [source, target] = await Promise.all([
      this.prisma.player.findFirst({ where: { id: sourceId, userId } }),
      this.prisma.player.findFirst({ where: { id: targetId, userId } }),
    ]);

    if (!source) throw new NotFoundError('Source player');
    if (!target) throw new NotFoundError('Target player');
    if (source.isSelf || target.isSelf) {
      throw new ValidationError('Your own player entry cannot take part in a merge.');
    }

    await this.prisma.$transaction(async (tx) => {
      const sourceAppearances = await tx.matchParticipant.findMany({
        where: { playerId: sourceId },
        select: { id: true, matchId: true },
      });

      const targetMatchIds = new Set(
        (
          await tx.matchParticipant.findMany({
            where: { playerId: targetId },
            select: { matchId: true },
          })
        ).map((row) => row.matchId),
      );

      const movable = sourceAppearances.filter((row) => !targetMatchIds.has(row.matchId));
      const colliding = sourceAppearances.filter((row) => targetMatchIds.has(row.matchId));

      if (movable.length > 0) {
        await tx.matchParticipant.updateMany({
          where: { id: { in: movable.map((row) => row.id) } },
          data: { playerId: targetId },
        });
      }
      if (colliding.length > 0) {
        await tx.matchParticipant.deleteMany({
          where: { id: { in: colliding.map((row) => row.id) } },
        });
      }

      await tx.player.delete({ where: { id: sourceId } });
    });

    return this.findOne(userId, targetId);
  }

  /** The Player row representing the user themselves. */
  async self(userId: string): Promise<Player> {
    const player = await this.prisma.player.findFirst({ where: { userId, isSelf: true } });
    if (player) return player;

    // Self-heal for accounts created before this invariant existed, or by an import.
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.prisma.player.create({
      data: {
        userId,
        name: user.name,
        normalizedName: normalizeName(user.name),
        relationship: 'SELF',
        isSelf: true,
        linkedUserId: userId,
      },
    });
  }

  /**
   * Resolves the player references used by quick entry, creating any typed names that
   * do not exist yet. Runs inside the caller's transaction so a half-created match never
   * leaves stray players behind.
   */
  async resolveRefs(
    tx: Prisma.TransactionClient,
    userId: string,
    refs: readonly PlayerRef[],
  ): Promise<{ playerIds: string[]; created: string[] }> {
    const playerIds: string[] = [];
    const created: string[] = [];

    for (const ref of refs) {
      if (ref.playerId) {
        const existing = await tx.player.findFirst({
          where: { id: ref.playerId, userId },
          select: { id: true, isSelf: true },
        });
        if (!existing) throw new NotFoundError('Player');
        if (existing.isSelf) {
          throw new ValidationError('You are already a participant and cannot be added again.');
        }
        playerIds.push(existing.id);
        continue;
      }

      const name = tidyDisplayName(ref.name ?? '');
      if (!name) throw new ValidationError('A player name cannot be empty.');
      const normalizedName = normalizeName(name);

      const match = await tx.player.findUnique({
        where: { userId_normalizedName: { userId, normalizedName } },
        select: { id: true, isSelf: true },
      });

      if (match) {
        if (match.isSelf) {
          throw new ValidationError('You are already a participant and cannot be added again.');
        }
        playerIds.push(match.id);
        continue;
      }

      const fresh = await tx.player.create({
        data: { userId, name, normalizedName, relationship: 'OTHER' },
        select: { id: true },
      });
      playerIds.push(fresh.id);
      created.push(name);
    }

    const unique = new Set(playerIds);
    if (unique.size !== playerIds.length) {
      throw new ValidationError('The same player cannot appear twice in one match.');
    }

    return { playerIds, created };
  }
}

type PlayerRow = Player & {
  _count: { participants: number };
  participants: Array<{ match: { playedAt: Date } }>;
};

function toSummary(player: PlayerRow): PlayerSummary {
  return {
    id: player.id,
    name: player.name,
    nickname: player.nickname,
    relationship: player.relationship,
    playingLevel: player.playingLevel,
    dominantHand: player.dominantHand,
    playingStyle: player.playingStyle,
    avatarUrl: player.avatarUrl,
    notes: player.notes,
    isSelf: player.isSelf,
    rating: player.rating,
    ratingDeviation: player.ratingDeviation,
    matchesPlayed: player._count.participants,
    lastPlayedAt: player.participants[0]?.match.playedAt.toISOString() ?? null,
    createdAt: player.createdAt.toISOString(),
    updatedAt: player.updatedAt.toISOString(),
  };
}
