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
  createPlayerSchema,
  listPlayersSchema,
  updatePlayerSchema,
  type CreatePlayerInput,
  type ListPlayersQuery,
  type Paginated,
  type PlayerSummary,
  type UpdatePlayerInput,
} from '@badminton/contracts';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { PlayersService } from './players.service';

@ApiTags('players')
@Controller({ path: 'players', version: '1' })
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Get()
  @ApiOperation({ summary: 'List players in your address book' })
  list(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(listPlayersSchema)) query: ListPlayersQuery,
  ): Promise<Paginated<PlayerSummary>> {
    return this.players.list(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single player' })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlayerSummary> {
    return this.players.findOne(userId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Add a player' })
  create(
    @CurrentUser('id') userId: string,
    @Body(zodBody(createPlayerSchema)) input: CreatePlayerInput,
  ): Promise<PlayerSummary> {
    return this.players.create(userId, input);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a player' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updatePlayerSchema)) input: UpdatePlayerInput,
  ): Promise<PlayerSummary> {
    return this.players.update(userId, id, input);
  }

  @Post(':id/merge/:targetId')
  @ApiOperation({ summary: 'Merge a duplicate player into another' })
  merge(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
  ): Promise<PlayerSummary> {
    return this.players.merge(userId, id, targetId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a player who has never played' })
  remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.players.remove(userId, id);
  }
}
