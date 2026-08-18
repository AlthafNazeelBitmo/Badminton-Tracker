import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  registerDeviceSchema,
  type DeviceSummary,
  type RegisterDeviceInput,
} from '@badminton/contracts';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { DevicesService } from './devices.service';

@ApiTags('devices')
@Controller({ path: 'devices', version: '1' })
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  // Called on every app launch, so the budget allows for frequent foregrounding
  // without being generous enough to be useful as an amplification vector.
  @RateLimit({ limit: 60, windowSeconds: 3600 })
  @ApiOperation({
    summary: 'Register or refresh this device',
    description:
      'Idempotent per installation id. Called at launch to refresh the push token, ' +
      'which the operating system may rotate, and the last-seen time.',
  })
  register(
    @CurrentUser('id') userId: string,
    @Body(zodBody(registerDeviceSchema)) input: RegisterDeviceInput,
  ): Promise<DeviceSummary> {
    return this.devices.register(userId, input);
  }

  @Get()
  @ApiOperation({ summary: 'List the devices signed in to this account' })
  list(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(z.object({ installationId: z.string().max(128).optional() })))
    query: { installationId?: string },
  ): Promise<DeviceSummary[]> {
    return this.devices.list(userId, query.installationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a device',
    description: 'Stops notifications to it. Does not end that device’s session.',
  })
  remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.devices.remove(userId, id);
  }
}
