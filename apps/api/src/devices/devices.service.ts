import { Injectable, Logger } from '@nestjs/common';
import type { DeviceSummary, RegisterDeviceInput } from '@badminton/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';

/**
 * Device registry for native clients.
 *
 * A device row exists so the platform can send a push notification and so a user can see
 * — and revoke — where they are signed in. It is keyed by an installation id the client
 * generates once and keeps in secure storage.
 */
@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers or refreshes a device.
   *
   * Upsert rather than insert: the app calls this on every launch to refresh its push
   * token (which the OS may rotate) and its last-seen time. Inserting each time would
   * accumulate a row per launch and send duplicate notifications.
   */
  async register(userId: string, input: RegisterDeviceInput): Promise<DeviceSummary> {
    // A push token addresses one app installation, so it must belong to exactly one
    // device row. If this token is already claimed by a different row — the same handset
    // signed into another account, or restored from a backup — release the old claim
    // first, or notifications for this user would go to whoever held it before.
    if (input.pushToken) {
      await this.prisma.device.updateMany({
        where: {
          pushToken: input.pushToken,
          OR: [{ userId: { not: userId } }, { installationId: { not: input.installationId } }],
        },
        data: { pushToken: null },
      });
    }

    const device = await this.prisma.device.upsert({
      where: {
        userId_installationId: { userId, installationId: input.installationId },
      },
      create: {
        userId,
        installationId: input.installationId,
        platform: input.platform,
        pushToken: input.pushToken ?? null,
        appVersion: input.appVersion ?? null,
        osVersion: input.osVersion ?? null,
        deviceName: input.deviceName ?? null,
        locale: input.locale ?? null,
        timeZone: input.timeZone ?? null,
      },
      update: {
        platform: input.platform,
        pushToken: input.pushToken ?? null,
        appVersion: input.appVersion ?? null,
        osVersion: input.osVersion ?? null,
        deviceName: input.deviceName ?? null,
        locale: input.locale ?? null,
        timeZone: input.timeZone ?? null,
        lastSeenAt: new Date(),
      },
    });

    return toSummary(device, input.installationId);
  }

  async list(userId: string, currentInstallationId?: string): Promise<DeviceSummary[]> {
    const devices = await this.prisma.device.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });
    return devices.map((device) => toSummary(device, currentInstallationId));
  }

  /**
   * Removes a device, stopping its notifications.
   *
   * This does not revoke the device's session: signing out is a separate action, and
   * conflating them would mean turning off notifications logged you out.
   */
  async remove(userId: string, id: string): Promise<void> {
    const device = await this.prisma.device.findFirst({ where: { id, userId } });
    if (!device) throw new NotFoundError('Device');
    await this.prisma.device.delete({ where: { id } });
  }

  /** Push tokens for a user, for the notification sender. */
  async pushTokensFor(userId: string): Promise<string[]> {
    const devices = await this.prisma.device.findMany({
      where: { userId, pushToken: { not: null } },
      select: { pushToken: true },
    });
    return devices
      .map((device) => device.pushToken)
      .filter((token): token is string => token !== null);
  }

  /**
   * Drops a token the push service reported as unregistered.
   *
   * Continuing to send to a dead token wastes quota and, on some providers, counts
   * against sender reputation.
   */
  async invalidatePushToken(pushToken: string): Promise<void> {
    const result = await this.prisma.device.updateMany({
      where: { pushToken },
      data: { pushToken: null },
    });
    if (result.count > 0) {
      this.logger.log({ message: 'Cleared unregistered push token', devices: result.count });
    }
  }
}

function toSummary(
  device: {
    id: string;
    platform: 'IOS' | 'ANDROID' | 'WEB';
    deviceName: string | null;
    appVersion: string | null;
    pushToken: string | null;
    lastSeenAt: Date;
    createdAt: Date;
    installationId: string;
  },
  currentInstallationId?: string,
): DeviceSummary {
  return {
    id: device.id,
    platform: device.platform,
    deviceName: device.deviceName,
    appVersion: device.appVersion,
    // The token itself is never returned: the client already has it, and echoing it
    // would put a push credential into a response that may be cached or logged.
    pushEnabled: device.pushToken !== null,
    lastSeenAt: device.lastSeenAt.toISOString(),
    createdAt: device.createdAt.toISOString(),
    isCurrent: currentInstallationId === device.installationId,
  };
}
