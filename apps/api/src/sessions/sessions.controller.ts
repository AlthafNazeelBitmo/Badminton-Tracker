import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createSessionSchema,
  listSessionsSchema,
  updateSessionSchema,
  type CreateSessionInput,
  type ListSessionsQuery,
  type Paginated,
  type SessionSummary,
  type UpdateSessionInput,
} from '@badminton/contracts';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionsService } from './sessions.service';

@ApiTags('sessions')
@Controller({ path: 'sessions', version: '1' })
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'List playing sessions with their stats' })
  list(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(listSessionsSchema)) query: ListSessionsQuery,
  ): Promise<Paginated<SessionSummary>> {
    return this.sessions.list(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a session' })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SessionSummary> {
    return this.sessions.findOne(userId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a session' })
  create(
    @CurrentUser('id') userId: string,
    @Body(zodBody(createSessionSchema)) input: CreateSessionInput,
  ): Promise<SessionSummary> {
    return this.sessions.create(userId, input);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a session' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateSessionSchema)) input: UpdateSessionInput,
  ): Promise<SessionSummary> {
    return this.sessions.update(userId, id, input);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a session and the matches it contains' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deletedMatches: number }> {
    return this.sessions.remove(userId, id);
  }
}
