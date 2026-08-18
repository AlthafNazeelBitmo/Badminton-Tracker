import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  syncPullSchema,
  type SyncPullQuery,
  type SyncPullResponse,
  type SyncStatusResponse,
} from '@badminton/contracts';
import { zodQuery } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { SyncService } from './sync.service';

@ApiTags('sync')
@Controller({ path: 'sync', version: '1' })
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('pull')
  @RateLimit({ limit: 120, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Fetch everything changed since the last sync',
    description:
      'Start a run by passing the `syncedAt` of the last completed run as `since`; server ' +
      'time is used, so a device with a skewed clock cannot skip records. While `hasMore` ' +
      'is true, keep pulling and pass the returned `cursor` back unchanged. Store the new ' +
      '`syncedAt` only once `hasMore` is false.',
  })
  pull(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(syncPullSchema)) query: SyncPullQuery,
  ): Promise<SyncPullResponse> {
    return this.sync.pull(userId, query);
  }

  @Get('status')
  @RateLimit({ limit: 120, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Record counts for detecting a divergent local cache',
    description:
      'Cheap enough to call on every launch. When the local counts disagree, something ' +
      'was deleted elsewhere and the client re-pulls from scratch.',
  })
  status(@CurrentUser('id') userId: string): Promise<SyncStatusResponse> {
    return this.sync.status(userId);
  }
}
