import { Module } from '@nestjs/common';
import { ProgressModule } from '../progress/progress.module';
import { PushModule } from '../push/push.module';
import { BackgroundJobsService } from './background-jobs.service';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [ProgressModule, PushModule],
  providers: [MaintenanceService, BackgroundJobsService],
  exports: [MaintenanceService],
})
export class JobsModule {}
