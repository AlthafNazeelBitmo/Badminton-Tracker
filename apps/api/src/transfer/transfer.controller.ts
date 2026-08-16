import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  exportQuerySchema,
  importCommitSchema,
  importPreviewSchema,
  type ExportQuery,
  type ImportCommitInput,
  type ImportCommitResponse,
  type ImportPreviewInput,
  type ImportPreviewResponse,
} from '@badminton/contracts';
import { zodBody, zodQuery } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ImportService } from './import.service';
import { ExportService } from './export.service';

@ApiTags('transfer')
@Controller({ path: 'transfer', version: '1' })
export class TransferController {
  constructor(
    private readonly importer: ImportService,
    private readonly exporter: ExportService,
  ) {}

  @Post('import/preview')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowSeconds: 600 })
  @ApiOperation({
    summary: 'Validate a CSV and report exactly what would be imported',
    description: 'Writes nothing. Every row comes back marked READY, INVALID or DUPLICATE.',
  })
  preview(
    @CurrentUser('id') userId: string,
    @Body(zodBody(importPreviewSchema)) input: ImportPreviewInput,
  ): Promise<ImportPreviewResponse> {
    return this.importer.preview(userId, input);
  }

  @Post('import/commit')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 10, windowSeconds: 600 })
  @ApiOperation({ summary: 'Import the rows the user accepted after previewing' })
  commit(
    @CurrentUser('id') userId: string,
    @Body(zodBody(importCommitSchema)) input: ImportCommitInput,
  ): Promise<ImportCommitResponse> {
    return this.importer.commit(userId, input);
  }

  @Get('import/template')
  @Header('Cache-Control', 'public, max-age=86400')
  @ApiOperation({ summary: 'Download the CSV import template' })
  template(@Res() response: Response): void {
    send(response, this.exporter.template());
  }

  @Get('export')
  @RateLimit({ limit: 20, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Export matches, sessions, players, venues or statistics' })
  async export(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(exportQuerySchema)) query: ExportQuery,
    @Res() response: Response,
  ): Promise<void> {
    send(response, await this.exporter.export(userId, query));
  }
}

function send(
  response: Response,
  file: { filename: string; contentType: string; body: string },
): void {
  response.setHeader('Content-Type', file.contentType);
  // The filename is generated server-side from a fixed vocabulary, so it cannot carry
  // user input into the header.
  response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  response.send(file.body);
}
