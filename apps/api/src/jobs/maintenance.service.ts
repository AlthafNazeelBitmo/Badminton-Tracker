import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../progress/notifications.service';
import { PushService, type DispatchResult } from '../push/push.service';

export interface ReminderRunResult extends DispatchResult {
  usersChecked: number;
  notificationsCreated: number;
}

/**
 * The work that happens without a request asking for it.
 *
 * Kept separate from the scheduler that calls it, so the same methods run from the
 * in-process timers, from the `jobs` command a platform scheduler invokes, and directly
 * from the integration tests — one implementation, three ways in.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {}

  /**
   * Generates notifications for everyone who can receive a push, then sends what is due.
   *
   * Generation used to happen only when the web app asked for it. That made the
   * inactivity reminder useless by construction: the person it exists for is the one
   * who has stopped opening the app, so they were the one person who never got it.
   *
   * Only users with a push-enabled device are generated for. Anyone else would get
   * nothing from it yet, and the web app still generates on demand when they visit.
   */
  async runReminders(now: Date = new Date()): Promise<ReminderRunResult> {
    const users = await this.prisma.user.findMany({
      where: { disabledAt: null, devices: { some: { pushToken: { not: null } } } },
      select: { id: true },
    });

    let created = 0;
    for (const user of users) {
      try {
        created += (await this.notifications.generate(user.id)).created;
      } catch (error) {
        // One account's bad data must not stop everyone else's reminders.
        this.logger.error({
          message: 'Notification generation failed',
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const dispatch = await this.push.dispatchPending(now);

    return { usersChecked: users.length, notificationsCreated: created, ...dispatch };
  }

  /**
   * Deletes idempotency records past their retention window.
   *
   * Each queued write from the phone leaves one behind, so without this the table grows
   * by a row per offline match forever.
   *
   * Purging cannot create a duplicate. A phone retrying after its key has gone sends the
   * same client-assigned match id, which the database refuses as `409 DUPLICATE`; the app
   * checks that the match exists and treats the entry as delivered. The key is the fast
   * path that returns the original response; the id is what actually guarantees one match.
   */
  async purgeExpiredIdempotencyKeys(now: Date = new Date()): Promise<{ deleted: number }> {
    const result = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    if (result.count > 0) {
      this.logger.log({ message: 'Purged expired idempotency keys', deleted: result.count });
    }

    return { deleted: result.count };
  }
}
