import { Module } from '@nestjs/common';
import { ProgressModule } from '../progress/progress.module';
import { PushModule } from '../push/push.module';
import { BackgroundJobsService } from './background-jobs.service';
import { MaintenanceService } from './maintenance.service';
import { CronController } from './cron.controller';

@Module({
  imports: [ProgressModule, PushModule],
  controllers: [CronController],
  providers: [MaintenanceService, BackgroundJobsService],
  exports: [MaintenanceService],
})
export class JobsModule {}
