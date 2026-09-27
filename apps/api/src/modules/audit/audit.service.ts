import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { AuditActor } from '../../generated/prisma/enums';

/** Records important local changes. Metadata must never contain secrets. */
export async function audit(
  userId: string | null,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId?: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { userId, actor, action, entityType, entityId: entityId ?? null, metadata: (metadata ?? undefined) as object | undefined },
    });
  } catch (err) {
    logger.warn({ err, action }, 'audit.write_failed');
  }
}
