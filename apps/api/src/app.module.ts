import { Inject, MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { CONFIG_TOKEN, type Env } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { UsersModule } from './users/users.module';
import { PlayersModule } from './players/players.module';
import { VenuesModule } from './venues/venues.module';
import { SessionsModule } from './sessions/sessions.module';
import { MatchesModule } from './matches/matches.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ProgressModule } from './progress/progress.module';
import { TransferModule } from './transfer/transfer.module';
import { ReportsModule } from './reports/reports.module';
import { AdminModule } from './admin/admin.module';
import { DevicesModule } from './devices/devices.module';
import { SyncModule } from './sync/sync.module';
import { HealthController } from './health/health.controller';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { RateLimitGuard } from './common/rate-limit.guard';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';

/**
 * Guard order matters, and this order is deliberate.
 *
 * Authentication runs *before* rate limiting so the limiter can key a signed-in caller by
 * user id. Keyed by address instead, two people behind one office NAT would share a
 * budget and either could lock the other out — and on mobile, a whole carrier NAT sits
 * behind a handful of addresses, so this is the common case rather than the exotic one.
 *
 * The cost of this order is that an unauthenticated request to a protected route is
 * rejected by `AuthGuard` without passing through the limiter. That request does no I/O —
 * a missing or forged token throws before any database access — so it is bounded by the
 * reverse proxy rather than by us. The endpoints where anonymous abuse actually pays,
 * login and registration, are `@Public()`: `AuthGuard` waves them through untouched and
 * the limiter still keys them by address, which is the only identity they have.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    PlayersModule,
    VenuesModule,
    SessionsModule,
    MatchesModule,
    AnalyticsModule,
    ProgressModule,
    TransferModule,
    ReportsModule,
    AdminModule,
    DevicesModule,
    SyncModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Runs after the guards, so `request.user` is populated and keys can be scoped
    // to the account rather than shared across all callers.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  constructor(@Inject(CONFIG_TOKEN) private readonly config: Env) {}

  configure(consumer: MiddlewareConsumer): void {
    // The middleware takes its threshold as a constructor argument, so it is applied as
    // a bound function rather than a class token.
    const middleware = new RequestContextMiddleware(this.config.SLOW_REQUEST_MS);
    consumer.apply(middleware.use.bind(middleware)).forRoutes('*');
  }
}
