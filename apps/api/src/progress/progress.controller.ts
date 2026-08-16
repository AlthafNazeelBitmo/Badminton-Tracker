import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createGoalSchema,
  listGoalsSchema,
  updateGoalSchema,
  type AchievementView,
  type CreateGoalInput,
  type GoalProgress,
  type ListGoalsQuery,
  type Paginated,
  type UpdateGoalInput,
} from '@badminton/contracts';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { GoalsService } from './goals.service';
import { AchievementsService } from './achievements.service';
import { NotificationsService } from './notifications.service';

@ApiTags('goals')
@Controller({ path: 'goals', version: '1' })
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'List goals with live progress' })
  list(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(listGoalsSchema)) query: ListGoalsQuery,
  ): Promise<Paginated<GoalProgress>> {
    return this.goals.list(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a goal' })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GoalProgress> {
    return this.goals.findOne(userId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a goal' })
  create(
    @CurrentUser('id') userId: string,
    @Body(zodBody(createGoalSchema)) input: CreateGoalInput,
  ): Promise<GoalProgress> {
    return this.goals.create(userId, input);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update or archive a goal' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateGoalSchema)) input: UpdateGoalInput,
  ): Promise<GoalProgress> {
    return this.goals.update(userId, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a goal' })
  remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.goals.remove(userId, id);
  }
}

@ApiTags('achievements')
@Controller({ path: 'achievements', version: '1' })
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get()
  @ApiOperation({ summary: 'The full badge catalogue with progress' })
  list(@CurrentUser('id') userId: string): Promise<AchievementView[]> {
    return this.achievements.list(userId);
  }

  @Post('evaluate')
  @ApiOperation({ summary: 'Re-run achievement detection and return anything newly earned' })
  evaluate(@CurrentUser('id') userId: string): Promise<AchievementView[]> {
    return this.achievements.evaluate(userId);
  }
}

@ApiTags('notifications')
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications' })
  list(@CurrentUser('id') userId: string) {
    return this.notifications.list(userId);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Generate any notifications that are now due' })
  refresh(@CurrentUser('id') userId: string) {
    return this.notifications.generate(userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.notifications.markRead(userId, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark every notification as read' })
  markAllRead(@CurrentUser('id') userId: string): Promise<void> {
    return this.notifications.markAllRead(userId);
  }
}
