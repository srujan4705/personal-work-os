import { env } from '../../config/env';
import { AppError } from '../../lib/errors';

/** Minimal Telegram Bot API client (bot messaging only — unrelated to Zoho/GitHub). */
async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new AppError(503, 'TELEGRAM_NOT_CONFIGURED', 'Telegram is not configured.');
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 40_000 : 15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new AppError(502, 'TELEGRAM_ERROR', `Telegram ${method} failed: ${json.description ?? res.status}`);
  return json.result as T;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export const escapeHtml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const telegramApi = {
  sendMessage: (chatId: string, text: string, buttons?: InlineButton[][]) =>
    call<{ message_id: number }>('sendMessage', {
      chat_id: chatId, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true,
      ...(buttons && { reply_markup: { inline_keyboard: buttons } }),
    }),
  answerCallbackQuery: (id: string, text?: string) => call('answerCallbackQuery', { callback_query_id: id, ...(text && { text }) }),
  editReplyMarkup: (chatId: string, messageId: number) => call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
  getUpdates: (offset: number) => call<TelegramUpdate[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }),
  deleteWebhook: () => call('deleteWebhook', {}),
};

export interface TelegramUpdate {
  update_id: number;
  message?: { message_id: number; text?: string; chat: { id: number; type: string }; from?: { id: number; username?: string } };
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { message_id: number; chat: { id: number } } };
}
