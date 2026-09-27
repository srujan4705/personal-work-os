import { AppError } from '../../lib/errors';
import { TOOLS, isToolName, type ToolArgs, type ToolName, type ToolPermission } from '@pwos/ai-contracts';

/**
 * TOOL GATEWAY — the only path from an LLM (web assistant or Telegram) to data.
 *
 *   AI provider → tool request → ToolGateway → application service handler → Local DB / read-only provider
 *
 * Responsibilities, all enforced here and never delegated to the model:
 *   1. Allowlist     — only names in TOOLS, and only if a handler is registered.
 *   2. Validation    — arguments parsed with the tool's strict Zod schema.
 *   3. Identity      — userId comes from ToolContext (session / linked Telegram), never from args.
 *   4. Permission    — READ_ONLY runs; LOCAL_WRITE per policy; DANGEROUS_WRITE always confirms.
 *   5. Confirmation  — one state machine for every tool (see ActionStatus).
 *   6. Audit         — every accepted call is recorded through ActionStore.
 */

export type ConfirmationPolicy = 'ALWAYS_CONFIRM_WRITES' | 'CONFIRM_DANGEROUS_ONLY';

export type ActionStatus =
  | 'PROPOSED'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'EXECUTED'
  | 'FAILED';

export interface ToolContext {
  userId: string;
  conversationId: string | null;
  confirmationPolicy: ConfirmationPolicy;
}

/** What a handler receives: validated args plus server-side identity. */
export interface HandlerContext {
  userId: string;
}

export type ToolHandler<N extends ToolName> = (args: ToolArgs<N>, ctx: HandlerContext) => Promise<unknown>;
export type ToolHandlers = { [N in ToolName]: ToolHandler<N> };

export interface ActionRecord {
  id: string;
  userId: string;
  conversationId: string | null;
  toolName: ToolName;
  arguments: unknown;
  permission: ToolPermission;
  status: ActionStatus;
  confirmationRequired: boolean;
  confirmed: boolean;
  error: string | null;
  expiresAt: Date | null;
}

export interface ActionStore {
  create(record: Omit<ActionRecord, 'id'>): Promise<ActionRecord>;
  findById(id: string): Promise<ActionRecord | null>;
  /**
   * Atomic compare-and-set: applies only if the current status equals `from`.
   * Returns null when the record was not in `from` (e.g. concurrent confirm).
   * Prisma implementation: updateMany({ where: { id, status: from } }) and check count === 1.
   */
  transition(
    id: string,
    from: ActionStatus,
    to: ActionStatus,
    patch?: Partial<Pick<ActionRecord, 'confirmed' | 'error'>>,
  ): Promise<ActionRecord | null>;
}

export interface GatewayLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export type GatewayErrorCode = 'UNKNOWN_TOOL' | 'INVALID_ARGUMENTS' | 'NOT_FOUND' | 'INVALID_STATE' | 'EXPIRED';

export type GatewayResult =
  | { status: 'EXECUTED'; actionId: string; toolName: ToolName; data: unknown }
  | { status: 'AWAITING_CONFIRMATION'; actionId: string; toolName: ToolName; summary: string; expiresAt: Date }
  | { status: 'CANCELLED'; actionId: string; toolName: ToolName }
  | { status: 'FAILED'; actionId: string; toolName: ToolName; message: string }
  | { status: 'REJECTED'; code: GatewayErrorCode; message: string };

export interface ToolCall {
  name: string;
  arguments: unknown;
}

export function requiresConfirmation(permission: ToolPermission, policy: ConfirmationPolicy): boolean {
  if (permission === 'READ_ONLY') return false;
  if (permission === 'DANGEROUS_WRITE') return true;
  return policy === 'ALWAYS_CONFIRM_WRITES';
}

const DEFAULT_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

export class ToolGateway {
  private readonly now: () => Date;
  private readonly confirmationTtlMs: number;

  constructor(
    private readonly handlers: ToolHandlers,
    private readonly store: ActionStore,
    private readonly logger: GatewayLogger,
    opts: { now?: () => Date; confirmationTtlMs?: number } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.confirmationTtlMs = opts.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
  }

  async execute(call: ToolCall, ctx: ToolContext): Promise<GatewayResult> {
    if (!isToolName(call.name)) {
      this.logger.warn({ userId: ctx.userId, toolName: call.name }, 'ai.tool.rejected.unknown');
      return { status: 'REJECTED', code: 'UNKNOWN_TOOL', message: `Tool "${call.name}" is not available.` };
    }
    const name = call.name;
    const def = TOOLS[name];

    const parsed = def.input.safeParse(call.arguments);
    if (!parsed.success) {
      this.logger.warn({ userId: ctx.userId, toolName: name }, 'ai.tool.rejected.invalid_arguments');
      return {
        status: 'REJECTED',
        code: 'INVALID_ARGUMENTS',
        message: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
      };
    }

    const needsConfirmation = requiresConfirmation(def.permission, ctx.confirmationPolicy);
    const proposed = await this.store.create({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: name,
      arguments: parsed.data,
      permission: def.permission,
      status: 'PROPOSED',
      confirmationRequired: needsConfirmation,
      confirmed: false,
      error: null,
      expiresAt: needsConfirmation ? new Date(this.now().getTime() + this.confirmationTtlMs) : null,
    });

    if (needsConfirmation) {
      const awaiting = await this.store.transition(proposed.id, 'PROPOSED', 'AWAITING_CONFIRMATION');
      if (!awaiting) return this.invalidState();
      this.logger.info({ userId: ctx.userId, toolName: name, actionId: awaiting.id }, 'ai.action.awaiting_confirmation');
      const summarize = def.summarize as ((a: unknown) => string) | undefined;
      return {
        status: 'AWAITING_CONFIRMATION',
        actionId: awaiting.id,
        toolName: name,
        summary: summarize ? summarize(parsed.data) : `Run ${name}.`,
        expiresAt: awaiting.expiresAt!,
      };
    }

    const confirmed = await this.store.transition(proposed.id, 'PROPOSED', 'CONFIRMED');
    if (!confirmed) return this.invalidState();
    return this.run(confirmed, parsed.data);
  }

  async confirm(actionId: string, ctx: Pick<ToolContext, 'userId'>): Promise<GatewayResult> {
    const action = await this.loadOwned(actionId, ctx.userId);
    if (!action) return { status: 'REJECTED', code: 'NOT_FOUND', message: 'Action not found.' };
    if (action.status !== 'AWAITING_CONFIRMATION') return this.invalidState();

    if (action.expiresAt && action.expiresAt.getTime() <= this.now().getTime()) {
      await this.store.transition(action.id, 'AWAITING_CONFIRMATION', 'CANCELLED', { error: 'EXPIRED' });
      return { status: 'REJECTED', code: 'EXPIRED', message: 'This action expired. Please ask again.' };
    }

    // Defence in depth: stored args are re-validated before execution.
    const parsed = TOOLS[action.toolName].input.safeParse(action.arguments);
    if (!parsed.success) {
      await this.store.transition(action.id, 'AWAITING_CONFIRMATION', 'FAILED', { error: 'INVALID_ARGUMENTS' });
      return { status: 'REJECTED', code: 'INVALID_ARGUMENTS', message: 'Stored action arguments are invalid.' };
    }

    const confirmed = await this.store.transition(action.id, 'AWAITING_CONFIRMATION', 'CONFIRMED', { confirmed: true });
    if (!confirmed) return this.invalidState(); // lost a race with another confirm/cancel
    this.logger.info({ userId: ctx.userId, toolName: action.toolName, actionId }, 'ai.action.confirmed');
    return this.run(confirmed, parsed.data);
  }

  async cancel(actionId: string, ctx: Pick<ToolContext, 'userId'>): Promise<GatewayResult> {
    const action = await this.loadOwned(actionId, ctx.userId);
    if (!action) return { status: 'REJECTED', code: 'NOT_FOUND', message: 'Action not found.' };
    const cancelled = await this.store.transition(action.id, 'AWAITING_CONFIRMATION', 'CANCELLED');
    if (!cancelled) return this.invalidState();
    this.logger.info({ userId: ctx.userId, toolName: action.toolName, actionId }, 'ai.action.rejected_by_user');
    return { status: 'CANCELLED', actionId: action.id, toolName: action.toolName };
  }

  private async run(action: ActionRecord, args: unknown): Promise<GatewayResult> {
    const handler = this.handlers[action.toolName] as (a: unknown, c: HandlerContext) => Promise<unknown>;
    try {
      const data = await handler(args, { userId: action.userId });
      await this.store.transition(action.id, 'CONFIRMED', 'EXECUTED');
      this.logger.info({ userId: action.userId, toolName: action.toolName, actionId: action.id }, 'ai.tool.executed');
      return { status: 'EXECUTED', actionId: action.id, toolName: action.toolName, data };
    } catch (err) {
      const code = err instanceof Error ? err.name : 'Error';
      await this.store.transition(action.id, 'CONFIRMED', 'FAILED', { error: code });
      this.logger.warn({ userId: action.userId, toolName: action.toolName, actionId: action.id, code }, 'ai.tool.failed');
      // Internal error details are logged, never returned to the model. Business-rule
      // errors (4xx AppError, e.g. "ticket not found") are safe and useful to show.
      const message = err instanceof AppError && err.status < 500 ? err.message : 'The action failed.';
      return { status: 'FAILED', actionId: action.id, toolName: action.toolName, message };
    }
  }

  /** Returns null for other users' actions too, so existence is not leaked. */
  private async loadOwned(actionId: string, userId: string): Promise<ActionRecord | null> {
    const action = await this.store.findById(actionId);
    return action && action.userId === userId ? action : null;
  }

  private invalidState(): GatewayResult {
    return { status: 'REJECTED', code: 'INVALID_STATE', message: 'This action is no longer awaiting confirmation.' };
  }
}
