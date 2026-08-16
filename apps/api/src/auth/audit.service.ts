import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.refresh'
  | 'auth.password_changed'
  | 'auth.password_reset_requested'
  | 'auth.password_reset_completed'
  | 'auth.email_verified'
  | 'data.import'
  | 'data.export'
  | 'data.match_deleted'
  | 'data.session_deleted'
  | 'data.player_deleted'
  | 'admin.user_disabled';

export interface AuditContext {
  userId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only log of security-relevant actions.
 *
 * Writing an audit entry must never break the operation it describes, so failures are
 * logged and swallowed. The log stores a hash of the IP rather than the address itself:
 * enough to correlate one actor's requests, not enough to be a fresh pile of personal
 * data.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(action: AuditAction, context: AuditContext = {}): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          userId: context.userId ?? null,
          entity: context.entity ?? null,
          entityId: context.entityId ?? null,
          ipHash: context.ipHash ?? null,
          userAgent: context.userAgent?.slice(0, 300) ?? null,
          metadata: (context.metadata ?? undefined) as never,
        },
      });
    } catch (error) {
      this.logger.error({
        message: 'Failed to write audit log',
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
