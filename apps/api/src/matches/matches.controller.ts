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
  createMatchSchema,
  listMatchesSchema,
  updateMatchSchema,
  type CreateMatchInput,
  type ListMatchesQuery,
  type MatchDetail,
  type MatchSummary,
  type Paginated,
  type UpdateMatchInput,
} from '@badminton/contracts';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { Idempotent } from '../common/idempotency.interceptor';
import { MatchesService } from './matches.service';

@ApiTags('matches')
@Controller({ path: 'matches', version: '1' })
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  @ApiOperation({ summary: 'List matches with filtering and sorting' })
  list(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(listMatchesSchema)) query: ListMatchesQuery,
  ): Promise<Paginated<MatchSummary>> {
    return this.matches.list(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a match with derived statistics and insights' })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MatchDetail> {
    return this.matches.findOne(userId, id);
  }

  @Post()
  // Safe to retry from the mobile app's offline queue: a repeat with the same
  // Idempotency-Key returns the original match rather than creating a second one.
  @Idempotent()
  @ApiOperation({
    summary: 'Record a match',
    description:
      'Accepts an existing sessionId or an inline session description. Opponents and ' +
      'partners may be given by id or by name; unknown names are created automatically, ' +
      'which is what makes quick entry a single request.',
  })
  create(
    @CurrentUser('id') userId: string,
    @Body(zodBody(createMatchSchema)) input: CreateMatchInput,
  ): Promise<MatchDetail> {
    return this.matches.create(userId, input);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Replace a match' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateMatchSchema)) input: UpdateMatchInput,
  ): Promise<MatchDetail> {
    return this.matches.update(userId, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a match' })
  remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.matches.remove(userId, id);
  }
}
