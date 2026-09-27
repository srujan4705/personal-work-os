import type { NotificationProvider } from './types';

/** In-app notifications are the stored Notification rows themselves (shown in Settings → History). */
export class InAppNotificationProvider implements NotificationProvider {
  readonly channel = 'IN_APP' as const;
  async isAvailable() {
    return true;
  }
  async send() {}
}
