import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { paginationSchema, type PaginationQuery } from '@badminton/contracts';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { Roles } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AdminService } from './admin.service';

/**
 * Administration.
 *
 * Kept in its own module behind `@Roles('ADMIN')` applied at the controller, so an
 * admin-only route cannot be created by forgetting a decorator on a method — the class
 * guard already covers it. Nothing here can read another user's match data; the
 * operations are deliberately limited to account state, aggregate counts and the audit
 * trail, because "admin" should not mean "can read everyone's private statistics".
 */
@ApiTags('admin')
@Roles('ADMIN')
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide counts' })
  stats() {
    return this.admin.systemStats();
  }

  @Get('users')
  @ApiOperation({ summary: 'List accounts (no match data)' })
  users(@Query(zodQuery(paginationSchema)) query: PaginationQuery) {
    return this.admin.listUsers(query);
  }

  @Post('users/:id/disable')
  @ApiOperation({ summary: 'Disable an account and revoke its sessions' })
  disable(
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ reason: z.string().min(3).max(500) }))) input: { reason: string },
  ) {
    return this.admin.setDisabled(actorId, id, true, input.reason);
  }

  @Post('users/:id/enable')
  @ApiOperation({ summary: 'Re-enable an account' })
  enable(@CurrentUser('id') actorId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setDisabled(actorId, id, false, 'Re-enabled by administrator');
  }

  @Get('audit')
  @ApiOperation({ summary: 'Read the audit log' })
  audit(
    @Query(zodQuery(paginationSchema.extend({ action: z.string().max(60).optional() })))
    query: PaginationQuery & { action?: string },
  ) {
    return this.admin.auditLog(query);
  }

  @Post('maintenance/purge-tokens')
  @ApiOperation({ summary: 'Delete expired refresh and one-time tokens' })
  purgeTokens() {
    return this.admin.purgeExpiredTokens();
  }
}
