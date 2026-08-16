import { Inject, MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
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
import { HealthController } from './health/health.controller';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { RateLimitGuard } from './common/rate-limit.guard';
import { RequestContextMiddleware } from './common/request-context.middleware';

/**
 * Guard order matters: rate limiting runs first so an unauthenticated flood is rejected
 * before it costs a database round trip, then authentication.
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
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
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
