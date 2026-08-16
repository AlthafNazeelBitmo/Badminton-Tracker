import { Module } from '@nestjs/common';
import {
  AchievementsController,
  GoalsController,
  NotificationsController,
} from './progress.controller';
import { GoalsService } from './goals.service';
import { NotificationsService } from './notifications.service';
import { MatchesModule } from '../matches/matches.module';

@Module({
  imports: [MatchesModule],
  controllers: [GoalsController, AchievementsController, NotificationsController],
  providers: [GoalsService, NotificationsService],
  exports: [GoalsService, NotificationsService],
})
export class ProgressModule {}
