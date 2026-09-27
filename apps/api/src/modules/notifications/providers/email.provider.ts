import nodemailer, { type Transporter } from 'nodemailer';
import { prisma } from '../../../lib/prisma';
import { env } from '../../../config/env';
import type { NotificationProvider } from './types';

let transport: Transporter | undefined;
function getTransport() {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transport;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class EmailNotificationProvider implements NotificationProvider {
  readonly channel = 'EMAIL' as const;

  async isAvailable() {
    return !!(env.SMTP_HOST && env.SMTP_FROM);
  }

  async send(userId: string, message: { title: string; body: string; url?: string | null; actionLabel?: string | null }) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const link = message.url?.startsWith('https://') ? `<p><a href="${esc(message.url)}">${esc(message.actionLabel ?? 'Open')}</a></p>` : '';
    await getTransport().sendMail({
      from: env.SMTP_FROM,
      to: user.email,
      subject: `${env.EMAIL_SUBJECT_PREFIX} ${message.title}`.trim(),
      text: `${message.body}${message.url ? `\n\n${message.url}` : ''}`,
      html: `<div style="font-family:system-ui,sans-serif"><h3>${esc(message.title)}</h3><p style="white-space:pre-line">${esc(message.body)}</p>${link}<p style="color:#888;font-size:12px">Sent by Personal Work OS · ${esc(env.APP_URL)}</p></div>`,
    });
  }
}
