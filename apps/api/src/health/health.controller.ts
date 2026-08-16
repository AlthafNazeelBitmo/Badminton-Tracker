import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/current-user.decorator';
import { SkipRateLimit } from '../common/rate-limit.guard';

/**
 * Liveness and readiness probes.
 *
 * `/live` answers "is the process up" and must never touch the database — otherwise a
 * database blip causes the orchestrator to restart healthy application containers.
 * `/ready` answers "can this instance serve traffic" and does check the database.
 */
@ApiTags('health')
// Version-neutral and outside the /api prefix: orchestrator probes should not have to
// track the API's version, and a probe URL that moves with a version bump is a probe
// that silently stops working.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipRateLimit()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Public()
  @SkipRateLimit()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe, including database connectivity' })
  async ready(): Promise<{ status: string; database: string; latencyMs: number }> {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up', latencyMs: Date.now() - startedAt };
    } catch {
      // The reason is logged by Prisma; the probe body stays free of internals.
      return { status: 'degraded', database: 'down', latencyMs: Date.now() - startedAt };
    }
  }
}
