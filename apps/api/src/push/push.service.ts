import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { PUSH_TRANSPORT, type PushMessage, type PushTransport } from './push-transport';

/**
 * Which notifications reach a phone.
 *
 * The others still exist in the app's notification list; they just do not interrupt
 * anyone. Streaks announce themselves on every win from the fifth onwards, and milestones
 * have an "approaching" variant as well as a "reached" one. Pushed, both would become the
 * kind of chatter that gets an app's notifications switched off — and then the reminder
 * that actually matters stops arriving too.
 */
export const PUSHED_TYPES: readonly NotificationType[] = [
  'INACTIVITY',
  'GOAL_PROGRESS',
  'GOAL_DEADLINE',
  'ACHIEVEMENT',
];

/**
 * A notification older than this is history, not news.
 *
 * Stops a backlog being pushed in one burst — after the job has been down for a day, or
 * when someone installs the app with weeks of in-app notifications behind them.
 */
const PUSH_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Local hours during which a push may be sent, in the user's own time zone.
 *
 * A reminder about badminton at three in the morning is not a reminder, it is a reason
 * to uninstall. Anything arriving overnight waits for the morning rather than being
 * dropped — the push window is wide enough to cover the gap.
 */
export const DELIVERY_HOURS = { from: 9, until: 21 } as const;

export interface DispatchResult {
  sent: number;
  /** Held for the user's morning; they stay eligible and go on a later run. */
  deferred: number;
  failed: number;
  /** Device tokens reported dead by the provider and cleared. */
  tokensCleared: number;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    @Inject(PUSH_TRANSPORT) private readonly transport: PushTransport,
  ) {}

  /**
   * Pushes every notification that is due and has not been pushed yet.
   *
   * Safe to run concurrently, on several instances: each notification is *claimed* with
   * a conditional update before it is sent, and only the runner whose update matched a
   * row sends it. Claiming before sending makes delivery at-most-once — a crash between
   * the claim and the send loses that push. That is the deliberate choice: the
   * notification still appears in the app either way, and a duplicate push is the worse
   * failure.
   */
  async dispatchPending(now: Date = new Date()): Promise<DispatchResult> {
    const result: DispatchResult = { sent: 0, deferred: 0, failed: 0, tokensCleared: 0 };

    const due = await this.prisma.notification.findMany({
      where: {
        pushedAt: null,
        type: { in: [...PUSHED_TYPES] },
        createdAt: { gte: new Date(now.getTime() - PUSH_WINDOW_MS) },
        user: {
          disabledAt: null,
          devices: { some: { pushToken: { not: null } } },
        },
      },
      include: { user: { select: { timeZone: true } } },
      orderBy: { createdAt: 'asc' },
      // Bounded per run; anything beyond goes on the next one.
      take: 500,
    });

    for (const notification of due) {
      if (!isWithinDeliveryHours(now, notification.user.timeZone)) {
        result.deferred += 1;
        continue;
      }

      const claimed = await this.prisma.notification.updateMany({
        where: { id: notification.id, pushedAt: null },
        data: { pushedAt: now },
      });
      // Another runner got there first.
      if (claimed.count === 0) continue;

      const tokens = await this.devices.pushTokensFor(notification.userId);
      if (tokens.length === 0) continue;

      const messages: PushMessage[] = tokens.map((to) => ({
        to,
        title: notification.title,
        body: notification.body,
        data: { notificationId: notification.id, type: notification.type },
      }));

      const tickets = await this.transport.send(messages);

      let delivered = false;
      for (const [index, ticket] of tickets.entries()) {
        if (ticket.ok) {
          delivered = true;
          continue;
        }
        if (ticket.deviceGone) {
          await this.devices.invalidatePushToken(messages[index]!.to);
          result.tokensCleared += 1;
        }
      }

      if (delivered) result.sent += 1;
      else result.failed += 1;
    }

    if (result.sent + result.failed + result.tokensCleared > 0) {
      this.logger.log({ message: 'Push dispatch finished', ...result });
    }

    return result;
  }
}

/**
 * Whether `now` falls inside the delivery window in the given time zone.
 *
 * An unrecognised zone falls back to UTC rather than failing: a bad value in one
 * account's settings must not stop everyone else's reminders.
 */
export function isWithinDeliveryHours(now: Date, timeZone: string): boolean {
  const hour = localHour(now, timeZone);
  return hour >= DELIVERY_HOURS.from && hour < DELIVERY_HOURS.until;
}

function localHour(now: Date, timeZone: string): number {
  const read = (zone: string) =>
    Number(
      new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: zone })
        .formatToParts(now)
        .find((part) => part.type === 'hour')?.value ?? now.getUTCHours(),
    );

  try {
    return read(timeZone);
  } catch {
    return read('UTC');
  }
}
