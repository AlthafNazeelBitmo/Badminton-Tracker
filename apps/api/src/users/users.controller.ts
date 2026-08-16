import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateProfileSchema, type UpdateProfileInput } from '@badminton/contracts';
import { zodBody } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Fetch your profile and preferences' })
  profile(@CurrentUser('id') userId: string) {
    return this.users.profile(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update your profile, defaults and preferences' })
  update(
    @CurrentUser('id') userId: string,
    @Body(zodBody(updateProfileSchema)) input: UpdateProfileInput,
  ) {
    return this.users.updateProfile(userId, input);
  }

  @Get('me/export')
  @RateLimit({ limit: 3, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Export everything the platform holds about you' })
  exportAccount(@CurrentUser('id') userId: string) {
    return this.users.exportAccount(userId);
  }
}
