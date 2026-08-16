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
  createVenueSchema,
  listVenuesSchema,
  updateVenueSchema,
  type CreateVenueInput,
  type ListVenuesQuery,
  type Paginated,
  type UpdateVenueInput,
  type VenueSummary,
} from '@badminton/contracts';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { VenuesService } from './venues.service';

@ApiTags('venues')
@Controller({ path: 'venues', version: '1' })
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  @Get()
  @ApiOperation({ summary: 'List venues' })
  list(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(listVenuesSchema)) query: ListVenuesQuery,
  ): Promise<Paginated<VenueSummary>> {
    return this.venues.list(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a venue' })
  findOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VenueSummary> {
    return this.venues.findOne(userId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Add a venue' })
  create(
    @CurrentUser('id') userId: string,
    @Body(zodBody(createVenueSchema)) input: CreateVenueInput,
  ): Promise<VenueSummary> {
    return this.venues.create(userId, input);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a venue' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateVenueSchema)) input: UpdateVenueInput,
  ): Promise<VenueSummary> {
    return this.venues.update(userId, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a venue (sessions keep their matches)' })
  remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.venues.remove(userId, id);
  }
}
