import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { MatchesModule } from '../matches/matches.module';

@Module({
  imports: [AnalyticsModule, MatchesModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
