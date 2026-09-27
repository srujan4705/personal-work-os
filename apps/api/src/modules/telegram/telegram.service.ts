import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { randomToken, sha256 } from '../../lib/crypto';
import { badRequest } from '../../lib/errors';
import { audit } from '../audit/audit.service';
import { cancelAction, chat, confirmAction } from '../assistant/assistant.service';
import { escapeHtml, telegramApi, type InlineButton, type TelegramUpdate } from './telegram.api';

const LINK_TTL_MS = 10 * 60_000;

/** One-time link code, shown once in Settings. Only its hash is stored. */
export async function createLinkCode(userId: string) {
  if (!env.TELEGRAM_BOT_TOKEN) throw badRequest('TELEGRAM_NOT_CONFIGURED', 'Set TELEGRAM_BOT_TOKEN first. See docs/MANUAL_SETUP.md, section E.');
  const code = randomToken(12);
  await prisma.telegramLinkToken.deleteMany({ where: { userId, usedAt: null } });
  await prisma.telegramLinkToken.create({ data: { userId, tokenHash: sha256(code), expiresAt: new Date(Date.now() + LINK_TTL_MS) } });
  return {
    code,
    expiresAt: new Date(Date.now() + LINK_TTL_MS),
    deepLink: env.TELEGRAM_BOT_USERNAME ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${code}` : null,
    instructions: `Open your bot in Telegram and send: /start ${code}`,
  };
}

export async function linkStatus(userId: string) {
  const link = await prisma.telegramLink.findUnique({ where: { userId } });
  return { configured: !!env.TELEGRAM_BOT_TOKEN, mode: env.TELEGRAM_MODE, linked: !!link, linkedAt: link?.linkedAt ?? null, botUsername: env.TELEGRAM_BOT_USERNAME ?? null };
}

export async function unlink(userId: string) {
  await prisma.telegramLink.deleteMany({ where: { userId } });
  await audit(userId, 'USER', 'telegram.unlinked', 'TelegramLink');
  return { unlinked: true };
}

async function consumeCode(code: string, telegramUserId: number, chatId: number) {
  const token = await prisma.telegramLinkToken.findUnique({ where: { tokenHash: sha256(code) } });
  if (!token || token.usedAt || token.expiresAt <= new Date()) return false;
  const used = await prisma.telegramLinkToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) return false;
  await prisma.telegramLink.deleteMany({ where: { OR: [{ userId: token.userId }, { telegramUserId: BigInt(telegramUserId) }] } });
  await prisma.telegramLink.create({ data: { userId: token.userId, telegramUserId: BigInt(telegramUserId), telegramChatId: BigInt(chatId) } });
  await audit(token.userId, 'USER', 'telegram.linked', 'TelegramLink');
  return true;
}

/** Only linked Telegram accounts, in their linked private chat, are authorised. */
async function authorizedUser(telegramUserId: number, chatId: number) {
  const link = await prisma.telegramLink.findUnique({ where: { telegramUserId: BigInt(telegramUserId) } });
  return link && link.telegramChatId === BigInt(chatId) ? link.userId : null;
}

function actionButtons(actions: { actionId: string }[]): InlineButton[][] | undefined {
  return actions.length ? actions.map((a) => [{ text: '✅ Confirm', callback_data: `c:${a.actionId}` }, { text: '✖ Cancel', callback_data: `x:${a.actionId}` }]) : undefined;
}

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    const q = update.callback_query;
    const chatId = q.message?.chat.id;
    const userId = chatId ? await authorizedUser(q.from.id, chatId) : null;
    if (!userId || !q.data) {
      await telegramApi.answerCallbackQuery(q.id, 'Not authorised.');
      return;
    }
    const [kind, actionId] = q.data.split(':');
    const result = kind === 'c' ? await confirmAction(userId, actionId!) : await cancelAction(userId, actionId!);
    await telegramApi.answerCallbackQuery(q.id, result.status === 'EXECUTED' ? 'Done' : undefined);
    if (q.message) await telegramApi.editReplyMarkup(String(q.message.chat.id), q.message.message_id).catch(() => {});
    await telegramApi.sendMessage(String(chatId), escapeHtml(result.reply));
    return;
  }

  const msg = update.message;
  if (!msg?.text || !msg.from) return;
  if (msg.chat.type !== 'private') return; // bot only works in a private chat

  const start = /^\/start(?:\s+(\S+))?/.exec(msg.text.trim());
  if (start?.[1]) {
    const linked = await consumeCode(start[1], msg.from.id, msg.chat.id);
    await telegramApi.sendMessage(String(msg.chat.id), linked ? 'Linked! Try /today or /help.' : 'That link code is invalid or expired. Create a new one in Settings → Telegram.');
    return;
  }

  const userId = await authorizedUser(msg.from.id, msg.chat.id);
  if (!userId) {
    logger.info({ telegramUserId: msg.from.id }, 'telegram.unauthorized_message');
    await telegramApi.sendMessage(String(msg.chat.id), 'This chat is not linked. Open Personal Work OS → Settings → Telegram to link it.');
    return;
  }
  const reply = await chat(userId, { message: msg.text.slice(0, 4000), channel: 'TELEGRAM' });
  await telegramApi.sendMessage(String(msg.chat.id), escapeHtml(reply.reply), actionButtons(reply.actions));
}

/** Long-polling mode for setups without a public HTTPS URL. */
export function startTelegramPolling(): () => void {
  let stopped = false;
  let offset = 0;
  const loop = async () => {
    await telegramApi.deleteWebhook().catch(() => {});
    while (!stopped) {
      try {
        const updates = await telegramApi.getUpdates(offset);
        for (const u of updates) {
          offset = u.update_id + 1;
          await handleUpdate(u).catch((err) => logger.warn({ err: err instanceof Error ? err.message : err }, 'telegram.update_failed'));
        }
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : err }, 'telegram.poll_failed');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  void loop();
  logger.info('telegram.polling_started');
  return () => {
    stopped = true;
  };
}
