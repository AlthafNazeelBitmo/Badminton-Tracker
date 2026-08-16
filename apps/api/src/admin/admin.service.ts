import { Injectable } from '@nestjs/common';
import type { PaginationQuery } from '@badminton/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError, ValidationError } from '../common/errors';
import { pageMeta, paginate } from '../common/pagination';
import { TokenService } from '../auth/token.service';
import { AuditService } from '../auth/audit.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async systemStats() {
    const [users, activeUsers, players, venues, sessions, matches, games] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { disabledAt: null } }),
      this.prisma.player.count(),
      this.prisma.venue.count(),
      this.prisma.session.count(),
      this.prisma.match.count(),
      this.prisma.game.count(),
    ]);

    const recentErrors = await this.prisma.auditLog.count({
      where: {
        action: 'auth.login_failed',
        createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
      },
    });

    return {
      users,
      activeUsers,
      players,
      venues,
      sessions,
      matches,
      games,
      failedLoginsLast24h: recentErrors,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  async listUsers(query: PaginationQuery) {
    const { skip, take } = paginate(query);

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
          disabledAt: true,
          lastLoginAt: true,
          createdAt: true,
          _count: { select: { matches: true, sessions: true } },
        },
      }),
      this.prisma.user.count(),
    ]);

    return {
      items: rows.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: user.emailVerified,
        disabled: user.disabledAt !== null,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        matches: user._count.matches,
        sessions: user._count.sessions,
      })),
      meta: pageMeta(query, totalItems),
    };
  }

  /**
   * Disables or re-enables an account. Disabling revokes every refresh token so the
   * change takes effect immediately rather than at the next token expiry.
   */
  async setDisabled(actorId: string, userId: string, disabled: boolean, reason: string) {
    if (actorId === userId && disabled) {
      throw new ValidationError('You cannot disable your own account.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    await this.prisma.user.update({
      where: { id: userId },
      data: { disabledAt: disabled ? new Date() : null },
    });

    if (disabled) await this.tokens.revokeAllForUser(userId);

    await this.audit.record('admin.user_disabled', {
      userId: actorId,
      entity: 'user',
      entityId: userId,
      metadata: { disabled, reason },
    });

    return { id: userId, disabled };
  }

  async auditLog(query: PaginationQuery & { action?: string }) {
    const where = query.action ? { action: query.action } : {};
    const { skip, take } = paginate(query);

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        userId: row.userId,
        entity: row.entity,
        entityId: row.entityId,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: pageMeta(query, totalItems),
    };
  }

  purgeExpiredTokens() {
    return this.tokens.purgeExpired();
  }
}
