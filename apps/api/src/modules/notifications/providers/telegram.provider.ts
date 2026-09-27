import { prisma } from '../../../lib/prisma';
import { env } from '../../../config/env';
import { escapeHtml, telegramApi } from '../../telegram/telegram.api';
import type { NotificationProvider } from './types';

export class TelegramNotificationProvider implements NotificationProvider {
  readonly channel = 'TELEGRAM' as const;

  async isAvailable(userId: string) {
    return !!env.TELEGRAM_BOT_TOKEN && (await prisma.telegramLink.count({ where: { userId } })) > 0;
  }

  async send(userId: string, message: { title: string; body: string; url?: string | null; actionLabel?: string | null }) {
    const link = await prisma.telegramLink.findFirstOrThrow({ where: { userId } });
    const buttons = message.url && message.url.startsWith('https://') ? [[{ text: message.actionLabel ?? 'Open', url: message.url }]] : undefined;
    await telegramApi.sendMessage(String(link.telegramChatId), `<b>${escapeHtml(message.title)}</b>\n${escapeHtml(message.body)}`, buttons);
  }
}
