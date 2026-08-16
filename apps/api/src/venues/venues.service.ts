import { Injectable } from '@nestjs/common';
import type { Prisma, Venue } from '@prisma/client';
import type {
  CreateVenueInput,
  ListVenuesQuery,
  Paginated,
  UpdateVenueInput,
  VenueSummary,
} from '@badminton/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictError, NotFoundError } from '../common/errors';
import { normalizeName, tidyDisplayName } from '../common/normalize';
import { pageMeta, paginate } from '../common/pagination';

@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: ListVenuesQuery): Promise<Paginated<VenueSummary>> {
    const where: Prisma.VenueWhereInput = {
      userId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { city: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const { skip, take } = paginate(query);

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.venue.findMany({
        where,
        orderBy: query.sort === 'NAME' ? { name: 'asc' } : { updatedAt: 'desc' },
        skip,
        take,
        include: {
          _count: { select: { sessions: true } },
          sessions: { select: { date: true }, orderBy: { date: 'desc' }, take: 1 },
        },
      }),
      this.prisma.venue.count({ where }),
    ]);

    const items = rows.map(toSummary);
    if (query.sort === 'MOST_PLAYED') items.sort((a, b) => b.sessionCount - a.sessionCount);
    if (query.sort === 'RECENT') {
      items.sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''));
    }

    return { items, meta: pageMeta(query, totalItems) };
  }

  async findOne(userId: string, id: string): Promise<VenueSummary> {
    const venue = await this.prisma.venue.findFirst({
      where: { id, userId },
      include: {
        _count: { select: { sessions: true } },
        sessions: { select: { date: true }, orderBy: { date: 'desc' }, take: 1 },
      },
    });
    if (!venue) throw new NotFoundError('Venue');
    return toSummary(venue);
  }

  async create(userId: string, input: CreateVenueInput): Promise<VenueSummary> {
    const name = tidyDisplayName(input.name);
    const normalizedName = normalizeName(name);

    const existing = await this.prisma.venue.findUnique({
      where: { userId_normalizedName: { userId, normalizedName } },
    });
    if (existing) throw new ConflictError(`You already have a venue called "${existing.name}".`);

    const created = await this.prisma.venue.create({
      data: {
        userId,
        name,
        normalizedName,
        location: input.location ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        isIndoor: input.isIndoor,
        courtCount: input.courtCount ?? null,
        notes: input.notes ?? null,
        isFavourite: input.isFavourite,
      },
      include: { _count: { select: { sessions: true } }, sessions: { take: 0 } },
    });

    return toSummary(created);
  }

  async update(userId: string, id: string, input: UpdateVenueInput): Promise<VenueSummary> {
    const venue = await this.prisma.venue.findFirst({ where: { id, userId } });
    if (!venue) throw new NotFoundError('Venue');

    const data: Prisma.VenueUpdateInput = {
      location: input.location === undefined ? undefined : input.location,
      city: input.city === undefined ? undefined : input.city,
      country: input.country === undefined ? undefined : input.country,
      isIndoor: input.isIndoor,
      courtCount: input.courtCount === undefined ? undefined : input.courtCount,
      notes: input.notes === undefined ? undefined : input.notes,
      isFavourite: input.isFavourite,
    };

    if (input.name !== undefined) {
      const name = tidyDisplayName(input.name);
      const normalizedName = normalizeName(name);
      const clash = await this.prisma.venue.findUnique({
        where: { userId_normalizedName: { userId, normalizedName } },
      });
      if (clash && clash.id !== id) {
        throw new ConflictError(`You already have a venue called "${clash.name}".`);
      }
      data.name = name;
      data.normalizedName = normalizedName;
    }

    await this.prisma.venue.update({ where: { id }, data });
    return this.findOne(userId, id);
  }

  /**
   * Venues detach rather than cascade: `Session.venueId` is nullable with
   * `onDelete: SetNull`, so removing a venue loses the location but never a match.
   */
  async remove(userId: string, id: string): Promise<void> {
    const venue = await this.prisma.venue.findFirst({ where: { id, userId } });
    if (!venue) throw new NotFoundError('Venue');
    await this.prisma.venue.delete({ where: { id } });
  }

  /** Finds a venue by typed name, creating it if new. Used by quick entry and import. */
  async resolveByName(
    tx: Prisma.TransactionClient,
    userId: string,
    rawName: string,
  ): Promise<{ id: string; created: boolean }> {
    const name = tidyDisplayName(rawName);
    const normalizedName = normalizeName(name);

    const existing = await tx.venue.findUnique({
      where: { userId_normalizedName: { userId, normalizedName } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const created = await tx.venue.create({
      data: { userId, name, normalizedName },
      select: { id: true },
    });
    return { id: created.id, created: true };
  }
}

type VenueRow = Venue & {
  _count: { sessions: number };
  sessions: Array<{ date: Date }>;
};

function toSummary(venue: VenueRow): VenueSummary {
  return {
    id: venue.id,
    name: venue.name,
    location: venue.location,
    city: venue.city,
    country: venue.country,
    isIndoor: venue.isIndoor,
    courtCount: venue.courtCount,
    notes: venue.notes,
    isFavourite: venue.isFavourite,
    sessionCount: venue._count.sessions,
    lastPlayedAt: venue.sessions[0]?.date.toISOString().slice(0, 10) ?? null,
    createdAt: venue.createdAt.toISOString(),
    updatedAt: venue.updatedAt.toISOString(),
  };
}
