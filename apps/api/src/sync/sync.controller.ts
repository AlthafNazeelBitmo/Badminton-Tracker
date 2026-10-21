import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  syncPullSchema,
  type SyncManifestResponse,
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

  @Get('manifest')
  // Fetched only after the cheap count check has already found a discrepancy, so this
  // budget is far more than a well-behaved client will ever use.
  @RateLimit({ limit: 30, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Every id the caller owns, for reconciling deletions',
    description:
      'Call when the local record counts exceed the `counts` in a completed pull: ' +
      'something was deleted on another device. Drop local records missing from these ' +
      'lists — except ones still waiting to upload, which the server has not seen yet.',
  })
  manifest(@CurrentUser('id') userId: string): Promise<SyncManifestResponse> {
    return this.sync.manifest(userId);
  }

  @Get('status')
  @RateLimit({ limit: 120, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Record counts for detecting a divergent local cache',
    description:
      'Cheap enough to call on every launch. When the local counts disagree, something ' +
      'was deleted elsewhere; fetch `/sync/manifest` to find out what.',
  })
  status(@CurrentUser('id') userId: string): Promise<SyncStatusResponse> {
    return this.sync.status(userId);
  }
}
