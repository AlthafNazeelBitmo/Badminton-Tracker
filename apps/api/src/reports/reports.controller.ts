import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { analyticsFilterSchema, type AnalyticsFilter, type PerformanceReport } from '@badminton/contracts';
import { zodQuery } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('performance')
  @ApiOperation({ summary: 'Generate a full performance report for the selected period' })
  performance(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<PerformanceReport> {
    return this.reports.performance(userId, filter);
  }
}
