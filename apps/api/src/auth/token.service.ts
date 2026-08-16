import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { TokenPurpose } from '@prisma/client';
import { CONFIG_TOKEN, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { UnauthorizedError } from '../common/errors';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  /** Token type, so an access token can never be replayed as a refresh token. */
  typ: 'access';
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Issues and rotates authentication tokens.
 *
 * Access tokens are short-lived JWTs. Refresh tokens are opaque random strings — not
 * JWTs — because a refresh token must be revocable, and a self-contained token cannot
 * be. Only a SHA-256 digest is stored, so a database leak yields nothing usable.
 *
 * Refresh tokens rotate on every use and are grouped into a *family*. Presenting a
 * token that has already been rotated means either a replay or a stolen token, and the
 * entire family is revoked — the standard defence for a token the client cannot keep
 * secret indefinitely.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(CONFIG_TOKEN) private readonly config: Env,
  ) {}

  async issueTokens(
    user: { id: string; email: string; role: string },
    context: { userAgent?: string; ipHash?: string; familyId?: string },
  ): Promise<IssuedTokens> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      typ: 'access',
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.JWT_ACCESS_SECRET,
      expiresIn: this.config.ACCESS_TOKEN_TTL,
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.REFRESH_TOKEN_TTL * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        familyId: context.familyId ?? randomUUID(),
        expiresAt,
        userAgent: context.userAgent?.slice(0, 300) ?? null,
        ipHash: context.ipHash ?? null,
      },
    });

    return { accessToken, refreshToken, expiresIn: this.config.ACCESS_TOKEN_TTL };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.JWT_ACCESS_SECRET,
      });
      if (payload.typ !== 'access') throw new UnauthorizedError('Invalid token type.');
      return payload;
    } catch {
      throw new UnauthorizedError('Your session has expired. Please sign in again.');
    }
  }

  /**
   * Exchanges a refresh token for a new pair, revoking the presented token.
   * Detects reuse of an already-rotated token and revokes the whole family.
   */
  async rotateRefreshToken(
    presented: string,
    context: { userAgent?: string; ipHash?: string },
  ): Promise<IssuedTokens & { userId: string }> {
    const tokenHash = hashToken(presented);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedError('Your session has expired. Please sign in again.');

    if (stored.revokedAt) {
      // A revoked token being presented means a copy escaped. Burn the family.
      this.logger.warn({
        message: 'Refresh token reuse detected; revoking token family',
        userId: stored.userId,
        familyId: stored.familyId,
      });
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedError('Your session has expired. Please sign in again.');
    }

    if (stored.expiresAt <= new Date()) {
      throw new UnauthorizedError('Your session has expired. Please sign in again.');
    }

    if (stored.user.disabledAt) {
      throw new UnauthorizedError('This account is no longer active.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const issued = await this.issueTokens(
      { id: stored.user.id, email: stored.user.email, role: stored.user.role },
      { ...context, familyId: stored.familyId },
    );

    return { ...issued, userId: stored.user.id };
  }

  async revokeRefreshToken(presented: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(presented), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Used when a password changes: every existing session must stop working. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Creates a single-use token for password reset or email verification.
   * Returns the plaintext once; only its digest is persisted.
   */
  async createOneTimeToken(
    userId: string,
    purpose: TokenPurpose,
    ttlSeconds: number,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.oneTimeToken.create({
      data: {
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
    });
    return token;
  }

  /** Consumes a one-time token, returning the user id, or null when it is not usable. */
  async consumeOneTimeToken(token: string, purpose: TokenPurpose): Promise<string | null> {
    const stored = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!stored || stored.purpose !== purpose || stored.usedAt || stored.expiresAt <= new Date()) {
      return null;
    }

    // `updateMany` with a usedAt filter makes redemption atomic: two concurrent
    // requests cannot both consume the same token.
    const claimed = await this.prisma.oneTimeToken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    return claimed.count === 1 ? stored.userId : null;
  }

  /** Housekeeping for expired rows; safe to run on a schedule. */
  async purgeExpired(): Promise<{ refreshTokens: number; oneTimeTokens: number }> {
    const now = new Date();
    const [refreshTokens, oneTimeTokens] = await Promise.all([
      this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.oneTimeToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);
    return { refreshTokens: refreshTokens.count, oneTimeTokens: oneTimeTokens.count };
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
