import { Injectable } from '@nestjs/common';
import type { UpdateProfileInput } from '@badminton/contracts';
import { validateScoringRules } from '@badminton/contracts';
import { isValidTimeZone } from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationError } from '../common/errors';
import { normalizeName, tidyDisplayName } from '../common/normalize';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      timeZone: user.timeZone,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
      profile: {
        dateOfBirth: user.profile?.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        playingLevel: user.profile?.playingLevel ?? 'INTERMEDIATE',
        preferredDiscipline: user.profile?.preferredDiscipline ?? null,
        dominantHand: user.profile?.dominantHand ?? 'UNKNOWN',
        playingStyle: user.profile?.playingStyle ?? 'UNKNOWN',
        preferredRacket: user.profile?.preferredRacket ?? null,
        preferredStrings: user.profile?.preferredStrings ?? null,
        avatarUrl: user.profile?.avatarUrl ?? null,
        notes: user.profile?.notes ?? null,
        defaultVisibility: user.profile?.defaultVisibility ?? 'PRIVATE',
        defaultScoring: {
          pointsToWin: user.profile?.defaultPointsToWin ?? 21,
          winBy: user.profile?.defaultWinBy ?? 2,
          maxPoints: user.profile?.defaultMaxPoints ?? 30,
          bestOf: user.profile?.defaultBestOf ?? 3,
        },
      },
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    if (input.timeZone && !isValidTimeZone(input.timeZone)) {
      throw new ValidationError('Unknown time zone.', [
        { path: 'timeZone', message: `"${input.timeZone}" is not a recognised IANA time zone.` },
      ]);
    }

    if (input.defaultScoring) {
      const check = validateScoringRules(input.defaultScoring);
      if (!check.valid) {
        throw new ValidationError(
          'The default scoring format is not valid.',
          check.issues.map((issue) => ({
            path: 'defaultScoring',
            message: issue.message,
            code: issue.code,
          })),
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (input.name !== undefined || input.timeZone !== undefined || input.locale !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(input.name !== undefined ? { name: tidyDisplayName(input.name) } : {}),
            ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
            ...(input.locale !== undefined ? { locale: input.locale } : {}),
          },
        });

        // The user's own Player row mirrors their display name so match cards and the
        // address book cannot disagree about what they are called.
        if (input.name !== undefined) {
          const name = tidyDisplayName(input.name);
          await tx.player.updateMany({
            where: { userId, isSelf: true },
            data: { name, normalizedName: normalizeName(name) },
          });
        }
      }

      const profileData = {
        dateOfBirth: input.dateOfBirth === undefined ? undefined : input.dateOfBirth,
        playingLevel: input.playingLevel,
        preferredDiscipline:
          input.preferredDiscipline === undefined ? undefined : input.preferredDiscipline,
        dominantHand: input.dominantHand,
        playingStyle: input.playingStyle,
        preferredRacket: input.preferredRacket === undefined ? undefined : input.preferredRacket,
        preferredStrings: input.preferredStrings === undefined ? undefined : input.preferredStrings,
        avatarUrl: input.avatarUrl === undefined ? undefined : input.avatarUrl,
        notes: input.notes === undefined ? undefined : input.notes,
        defaultVisibility: input.defaultVisibility,
        ...(input.defaultScoring
          ? {
              defaultPointsToWin: input.defaultScoring.pointsToWin,
              defaultWinBy: input.defaultScoring.winBy,
              defaultMaxPoints: input.defaultScoring.maxPoints,
              defaultBestOf: input.defaultScoring.bestOf,
            }
          : {}),
      };

      await tx.playerProfile.upsert({
        where: { userId },
        create: { userId, ...profileData },
        update: profileData,
      });
    });

    return this.profile(userId);
  }

  /**
   * Everything the platform holds about a user, for a data-portability export.
   * Credentials and tokens are deliberately excluded.
   */
  async exportAccount(userId: string) {
    const [user, players, venues, sessions, matches, goals, achievements] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          timeZone: true,
          createdAt: true,
          profile: true,
        },
      }),
      this.prisma.player.findMany({ where: { userId } }),
      this.prisma.venue.findMany({ where: { userId } }),
      this.prisma.session.findMany({ where: { userId } }),
      this.prisma.match.findMany({
        where: { userId },
        include: { games: true, participants: true, tags: true },
      }),
      this.prisma.goal.findMany({ where: { userId } }),
      this.prisma.userAchievement.findMany({ where: { userId } }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      user,
      players,
      venues,
      sessions,
      matches,
      goals,
      achievements,
    };
  }
}
