import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AuthenticatedUser,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '@badminton/contracts';
import { CONFIG_TOKEN, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppException,
  ConflictError,
  InvalidCredentialsError,
  UnauthorizedError,
  ValidationError,
} from '../common/errors';
import { HttpStatus } from '@nestjs/common';
import { PasswordService } from './password.service';
import { TokenService, type IssuedTokens } from './token.service';
import { AuditService } from './audit.service';
import { normalizeName, tidyDisplayName } from '../common/normalize';

const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 hour
const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60; // 1 day

export interface RequestMeta {
  ipHash?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    @Inject(CONFIG_TOKEN) private readonly config: Env,
  ) {}

  async register(
    input: RegisterInput,
    meta: RequestMeta,
  ): Promise<{ user: AuthenticatedUser; tokens: IssuedTokens; verificationToken: string }> {
    if (!this.config.ALLOW_REGISTRATION) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'REGISTRATION_DISABLED',
        'New account registration is currently disabled.',
      );
    }

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      // Registration cannot avoid revealing that an address is taken, but it should not
      // reveal anything else, and the same audit trail is written either way.
      await this.audit.record('auth.register', {
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        metadata: { outcome: 'duplicate_email' },
      });
      throw new ConflictError('An account with this email already exists.');
    }

    const passwordHash = await this.passwords.hash(input.password);
    // Tidied the same way as every other name in the system, so the profile screen and
    // the address book cannot disagree about capitalisation.
    const name = tidyDisplayName(input.name);

    // The user, their profile and their own Player row are created together: a user
    // without a self-player would break every doubles match they later record.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          name,
          timeZone: input.timeZone,
          profile: { create: {} },
        },
      });

      await tx.player.create({
        data: {
          userId: created.id,
          name: created.name,
          normalizedName: normalizeName(created.name),
          relationship: 'SELF',
          isSelf: true,
          linkedUserId: created.id,
        },
      });

      return created;
    });

    const tokens = await this.tokens.issueTokens(user, meta);
    const verificationToken = await this.tokens.createOneTimeToken(
      user.id,
      'EMAIL_VERIFICATION',
      EMAIL_VERIFICATION_TTL_SECONDS,
    );

    await this.audit.record('auth.register', {
      userId: user.id,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
    });

    return { user: toAuthenticatedUser(user), tokens, verificationToken };
  }

  async login(
    input: LoginInput,
    meta: RequestMeta,
  ): Promise<{ user: AuthenticatedUser; tokens: IssuedTokens }> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (!user) {
      // Hash anyway so a missing account and a wrong password take the same time.
      // Without this, response latency reveals which addresses are registered.
      await this.passwords.hash(input.password);
      await this.audit.record('auth.login_failed', {
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        metadata: { reason: 'unknown_email' },
      });
      throw new InvalidCredentialsError();
    }

    const valid = await this.passwords.verify(input.password, user.passwordHash);
    if (!valid) {
      await this.audit.record('auth.login_failed', {
        userId: user.id,
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        metadata: { reason: 'bad_password' },
      });
      throw new InvalidCredentialsError();
    }

    if (user.disabledAt) throw new UnauthorizedError('This account is no longer active.');

    // Transparent upgrade when the hashing policy has been strengthened since signup.
    if (this.passwords.needsRehash(user.passwordHash)) {
      const upgraded = await this.passwords.hash(input.password);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: upgraded },
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.tokens.issueTokens(user, meta);
    await this.audit.record('auth.login', {
      userId: user.id,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
    });

    return { user: toAuthenticatedUser(user), tokens };
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<IssuedTokens & { user: AuthenticatedUser }> {
    const rotated = await this.tokens.rotateRefreshToken(refreshToken, meta);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: rotated.userId } });

    return { ...rotated, user: toAuthenticatedUser(user) };
  }

  async logout(refreshToken: string | undefined, userId: string, meta: RequestMeta): Promise<void> {
    if (refreshToken) await this.tokens.revokeRefreshToken(refreshToken);
    await this.audit.record('auth.logout', {
      userId,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
    });
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const valid = await this.passwords.verify(input.currentPassword, user.passwordHash);
    if (!valid) throw new ValidationError('Your current password is incorrect.');

    if (input.currentPassword === input.newPassword) {
      throw new ValidationError('The new password must differ from the current one.');
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // Changing a password must end every other session, or a stolen one survives it.
    await this.tokens.revokeAllForUser(userId);
    await this.audit.record('auth.password_changed', {
      userId,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Starts a password reset. Always reports success: telling an anonymous caller
   * whether an address is registered turns this endpoint into an enumeration oracle.
   * The token is returned to the caller only so the (not yet implemented) mail
   * transport can send it; the controller never puts it in the response body.
   */
  async requestPasswordReset(email: string, meta: RequestMeta): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    await this.audit.record('auth.password_reset_requested', {
      userId: user?.id ?? null,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      metadata: { known: Boolean(user) },
    });

    if (!user || user.disabledAt) return null;

    return this.tokens.createOneTimeToken(user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_SECONDS);
  }

  async resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const userId = await this.tokens.consumeOneTimeToken(input.token, 'PASSWORD_RESET');
    if (!userId) throw new ValidationError('This reset link is invalid or has expired.');

    const passwordHash = await this.passwords.hash(input.password);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.tokens.revokeAllForUser(userId);

    await this.audit.record('auth.password_reset_completed', {
      userId,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
    });
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<void> {
    const userId = await this.tokens.consumeOneTimeToken(token, 'EMAIL_VERIFICATION');
    if (!userId) throw new ValidationError('This verification link is invalid or has expired.');

    await this.prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
    await this.audit.record('auth.email_verified', {
      userId,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
    });
  }

  async resendVerification(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerified) return null;
    return this.tokens.createOneTimeToken(
      userId,
      'EMAIL_VERIFICATION',
      EMAIL_VERIFICATION_TTL_SECONDS,
    );
  }
}

function toAuthenticatedUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  emailVerified: boolean;
  timeZone: string;
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as AuthenticatedUser['role'],
    emailVerified: user.emailVerified,
    timeZone: user.timeZone,
  };
}
