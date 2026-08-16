import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedUser } from '@badminton/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenError, UnauthorizedError } from '../common/errors';
import { TokenService } from './token.service';
import { ACCESS_TOKEN_COOKIE } from './cookies';
import { IS_PUBLIC_KEY, ROLES_KEY } from './current-user.decorator';

/**
 * Authenticates every request unless the route is explicitly `@Public()`.
 *
 * Secure-by-default is the whole point: forgetting a guard on a new controller leaves
 * it protected rather than open. Tokens are accepted from an httpOnly cookie (the web
 * client, so no token is reachable from JavaScript) or a bearer header (scripts, the
 * CLI, future mobile clients).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractToken(request);
    if (!token) throw new UnauthorizedError();

    const payload = await this.tokens.verifyAccessToken(token);

    // The token is only a claim about identity; the database is the authority on
    // whether that account still exists and is still allowed in.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        timeZone: true,
        disabledAt: true,
      },
    });

    if (!user) throw new UnauthorizedError();
    if (user.disabledAt) throw new ForbiddenError('This account is no longer active.');

    request.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      timeZone: user.timeZone,
    };

    const requiredRoles = this.reflector.getAllAndOverride<Array<'USER' | 'ADMIN'>>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
      throw new ForbiddenError('You do not have access to this resource.');
    }

    return true;
  }
}

function extractToken(request: Request): string | null {
  const header = request.header('authorization');
  if (header?.startsWith('Bearer ')) {
    const value = header.slice(7).trim();
    if (value) return value;
  }

  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[ACCESS_TOKEN_COOKIE] ?? null;
}
