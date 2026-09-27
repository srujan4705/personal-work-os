import type { NotificationChannel } from '../../../generated/prisma/enums';
import type { NotificationMessage } from '../templates';

/** Channel abstraction. WhatsApp can be added later as another implementation. */
export interface NotificationProvider {
  readonly channel: NotificationChannel;
  isAvailable(userId: string): Promise<boolean>;
  send(userId: string, message: NotificationMessage): Promise<void>;
}
