import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG_TOKEN, type Env } from '../config/env';

export interface PushMessage {
  /** An Expo push token, `ExponentPushToken[…]`. */
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** The outcome for one message, in the same position as the message that produced it. */
export type PushTicket =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /**
       * The token no longer addresses an installed app — uninstalled, or the user
       * revoked permission. Sending to it again can never succeed.
       */
      deviceGone: boolean;
    };

/**
 * The one thing that talks to a push provider.
 *
 * An interface rather than a direct HTTP call so the integration suite can swap in a
 * recorder: tests need to prove *what* would be sent and to *whom*, and they must never
 * send a real notification to a real phone.
 */
export interface PushTransport {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

export const PUSH_TRANSPORT = Symbol('PUSH_TRANSPORT');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo's documented ceiling for one request. */
export const EXPO_BATCH_SIZE = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Expo's push service, which forwards to APNs and FCM.
 *
 * Expo rather than the two platform services directly, because the app already gets its
 * tokens from Expo and this keeps Apple's and Google's credentials inside EAS instead of
 * in this server's environment.
 *
 * Only push *tickets* are read, not the delivery receipts Expo publishes later. A ticket
 * already reports `DeviceNotRegistered` for the common case — the app was uninstalled —
 * and polling receipts would need its own job and storage for a marginal gain.
 */
@Injectable()
export class ExpoPushTransport implements PushTransport {
  private readonly logger = new Logger(ExpoPushTransport.name);

  constructor(@Inject(CONFIG_TOKEN) private readonly config: Env) {}

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (messages.length === 0) return [];

    const tickets: PushTicket[] = [];
    for (let start = 0; start < messages.length; start += EXPO_BATCH_SIZE) {
      tickets.push(...(await this.sendBatch(messages.slice(start, start + EXPO_BATCH_SIZE))));
    }
    return tickets;
  }

  private async sendBatch(batch: PushMessage[]): Promise<PushTicket[]> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.config.EXPO_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${this.config.EXPO_ACCESS_TOKEN}`;
    }

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          batch.map((message) => ({
            ...message,
            // Matches the channel the app creates on Android; without a channel the
            // notification is dropped there without any error.
            channelId: 'reminders',
            // Reminders, not alarms.
            sound: null,
          })),
        ),
        // A hung provider must not stall the job loop behind it.
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const reason = `Expo push service returned ${response.status}`;
        this.logger.warn({ message: reason, batch: batch.length });
        return batch.map(() => ({ ok: false as const, error: reason, deviceGone: false }));
      }

      const payload = (await response.json()) as { data?: ExpoTicket[] };
      const data = payload.data ?? [];

      return batch.map((_, index): PushTicket => {
        const ticket = data[index];
        if (ticket?.status === 'ok') return { ok: true };
        const code = ticket?.details?.error ?? 'UnknownError';
        return {
          ok: false,
          error: ticket?.message ?? code,
          deviceGone: code === 'DeviceNotRegistered',
        };
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn({ message: 'Expo push request failed', reason, batch: batch.length });
      return batch.map(() => ({ ok: false as const, error: reason, deviceGone: false }));
    }
  }
}
