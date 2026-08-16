import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type AuthenticatedUser,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type RequestPasswordResetInput,
  type ResetPasswordInput,
  type SessionResponse,
  type VerifyEmailInput,
} from '@badminton/contracts';
import { CONFIG_TOKEN, type Env } from '../config/env';
import { zodBody } from '../common/zod-validation.pipe';
import { RateLimit, clientIp, hashIp } from '../common/rate-limit.guard';
import { UnauthorizedError } from '../common/errors';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './current-user.decorator';
import { REFRESH_TOKEN_COOKIE, clearAuthCookies, setAuthCookies } from './cookies';

/**
 * Authentication endpoints.
 *
 * Every route here carries a tight rate limit: this is where credential stuffing and
 * password spraying arrive, and the global budget is far too generous for it.
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG_TOKEN) private readonly config: Env,
  ) {}

  @Public()
  @Post('register')
  @RateLimit({ limit: 5, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Create an account and sign in' })
  async register(
    @Body(zodBody(registerSchema)) input: RegisterInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const result = await this.auth.register(input, metaFrom(request));
    setAuthCookies(response, this.config, result.tokens);

    // In development the verification link is logged rather than emailed, so the flow
    // is exercisable end to end before a mail transport exists. It is never returned in
    // the response body, where a proxy or browser extension could capture it.
    if (this.config.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.info(
        `[dev] Email verification token for ${result.user.email}: ${result.verificationToken}`,
      );
    }

    return { user: result.user, expiresIn: result.tokens.expiresIn };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSeconds: 300 })
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body(zodBody(loginSchema)) input: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const result = await this.auth.login(input, metaFrom(request));
    setAuthCookies(response, this.config, result.tokens);
    return { user: result.user, expiresIn: result.tokens.expiresIn };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 60, windowSeconds: 300 })
  @ApiOperation({ summary: 'Exchange a refresh token for a new session' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const token = readRefreshToken(request);
    if (!token) throw new UnauthorizedError('No refresh token was provided.');

    const result = await this.auth.refresh(token, metaFrom(request));
    setAuthCookies(response, this.config, result);
    return { user: result.user, expiresIn: result.expiresIn };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out and revoke the current refresh token' })
  async logout(
    @CurrentUser('id') userId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(readRefreshToken(request), userId, metaFrom(request));
    clearAuthCookies(response, this.config);
  }

  @Get('me')
  @ApiOperation({ summary: 'Return the signed-in user' })
  me(@CurrentUser() user: AuthenticatedUser): { user: AuthenticatedUser } {
    return { user };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 5, windowSeconds: 900 })
  @ApiOperation({ summary: 'Change the password and end all other sessions' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body(zodBody(changePasswordSchema)) input: ChangePasswordInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.changePassword(userId, input, metaFrom(request));
    clearAuthCookies(response, this.config);
  }

  @Public()
  @Post('request-password-reset')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ limit: 5, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Request a password reset link' })
  async requestPasswordReset(
    @Body(zodBody(requestPasswordResetSchema)) input: RequestPasswordResetInput,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    const token = await this.auth.requestPasswordReset(input.email, metaFrom(request));

    if (token && this.config.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.info(`[dev] Password reset token for ${input.email}: ${token}`);
    }

    // Identical response whether or not the address exists.
    return {
      message: 'If an account exists for that address, a reset link has been sent.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 10, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Complete a password reset' })
  async resetPassword(
    @Body(zodBody(resetPasswordSchema)) input: ResetPasswordInput,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.resetPassword(input, metaFrom(request));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 10, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Verify an email address' })
  async verifyEmail(
    @Body(zodBody(verifyEmailSchema)) input: VerifyEmailInput,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.verifyEmail(input.token, metaFrom(request));
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ limit: 3, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Send a fresh verification link' })
  async resendVerification(@CurrentUser('id') userId: string): Promise<{ message: string }> {
    const token = await this.auth.resendVerification(userId);
    if (token && this.config.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.info(`[dev] Email verification token: ${token}`);
    }
    return { message: 'If your address is unverified, a new link has been sent.' };
  }
}

function metaFrom(request: Request): { ipHash: string; userAgent: string | undefined } {
  return {
    ipHash: hashIp(clientIp(request)),
    userAgent: request.header('user-agent'),
  };
}

function readRefreshToken(request: Request): string | undefined {
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[REFRESH_TOKEN_COOKIE];
  if (fromCookie) return fromCookie;

  // Non-browser clients cannot use cookies; accept an explicit header instead.
  return request.header('x-refresh-token') ?? undefined;
}
