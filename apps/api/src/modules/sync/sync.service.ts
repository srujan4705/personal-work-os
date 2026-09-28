import { extractTicketKeys } from "@pwos/shared";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { AppError, badRequest } from "../../lib/errors";
import { addDays, localDate, zonedTimeToUtc } from "../../lib/time";
import { audit } from "../audit/audit.service";
import { getUserContext } from "../settings/settings.service";
import { ReadOnlyHttpClient } from "../integrations/http/read-only-http-client";
import { zohoHosts } from "../integrations/zoho/zoho.domains";
import { ZohoCalendarApiReader } from "../integrations/zoho/zoho-calendar.reader";
import {
  ZohoProjectsApiReader,
  listZohoPortals,
} from "../integrations/zoho/zoho-projects.reader";
import {
  ZohoSprintsApiReader,
  listZohoSprintsTeams,
} from "../integrations/zoho/zoho-sprints.reader";
import { GithubApiReader } from "../integrations/github/github.reader";
import { getZohoAccessToken } from "../integrations/oauth/zoho-oauth";
import { refreshSuggestionsForDate } from "../suggestions/suggestion.service";
import type { ExternalProvider } from "../../generated/prisma/enums";
import type { ExternalWorkItem } from "../integrations/providers";

export type SyncNotifier = (
  userId: string,
  resource: string,
  message: string,
) => Promise<void>;
let onSyncFailure: SyncNotifier = async () => {};
export const setSyncFailureNotifier = (fn: SyncNotifier) => {
  onSyncFailure = fn;
};

interface SyncOutcome {
  resource: string;
  ok: boolean;
  count?: number;
  error?: string;
}

/** Runs one resource sync, recording state. Failures are isolated and never throw. */
async function runResource(
  userId: string,
  provider: ExternalProvider,
  resource: string,
  fn: (state: {
    cursor: string | null;
    etag: string | null;
    lastSuccessAt: Date | null;
  }) => Promise<{
    count: number;
    cursor?: string | null;
    etag?: string | null;
  }>,
): Promise<SyncOutcome> {
  const key = { userId_provider_resource: { userId, provider, resource } };
  const state = await prisma.syncState.upsert({
    where: key,
    create: { userId, provider, resource },
    update: {},
  });
  logger.info({ userId, provider, resource }, "sync.started");
  try {
    const res = await fn(state);
    await prisma.syncState.update({
      where: key,
      data: {
        lastSyncedAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: null,
        ...(res.cursor !== undefined && { cursor: res.cursor }),
        ...(res.etag !== undefined && { etag: res.etag }),
      },
    });
    logger.info(
      { userId, provider, resource, count: res.count },
      "sync.completed",
    );
    return { resource, ok: true, count: res.count };
  } catch (err) {
    const message =
      err instanceof AppError
        ? err.message
        : err instanceof Error
          ? `${err.name}: ${err.message}`.slice(0, 300)
          : "Unknown error";
    await prisma.syncState.update({
      where: key,
      data: { lastSyncedAt: new Date(), lastError: message },
    });
    logger.warn({ userId, provider, resource, err: message }, "sync.failed");
    await onSyncFailure(
      userId,
      `${provider.toLowerCase()}:${resource}`,
      message,
    ).catch(() => {});
    return { resource, ok: false, error: message };
  }
}

function zohoClient(userId: string, hosts: string[]) {
  return new ReadOnlyHttpClient({
    allowedHosts: hosts,
    authorization: async () =>
      `Zoho-oauthtoken ${await getZohoAccessToken(userId)}`,
  });
}

const shapeLogger = (resource: string, keys: string[]) => {
  if (env.ZOHO_DEBUG_SHAPES)
    logger.info({ resource, keys }, "zoho.response_shape");
};

export async function zohoOptions(userId: string) {
  const hosts = zohoHosts(env.ZOHO_DATA_CENTER);
  const http = zohoClient(userId, [hosts.projects, hosts.sprints]);
  const [portals, teams] = await Promise.all([
    listZohoPortals(http, hosts.projects).catch(() => []),
    listZohoSprintsTeams(http, hosts.sprints).catch(() => []),
  ]);
  return { portals, teams };
}

async function upsertProject(
  userId: string,
  p: {
    externalId: string;
    name: string;
    key: string | null;
    status: string | null;
    externalUrl: string | null;
  },
) {
  return prisma.project.upsert({
    where: {
      userId_provider_externalId: {
        userId,
        provider: "ZOHO",
        externalId: p.externalId,
      },
    },
    create: { userId, provider: "ZOHO", ...p, syncedAt: new Date() },
    update: {
      name: p.name,
      key: p.key,
      status: p.status,
      externalUrl: p.externalUrl,
      syncedAt: new Date(),
    },
  });
}

async function upsertWorkItem(
  userId: string,
  w: ExternalWorkItem,
  projectId: string | null,
  sprintId: string | null,
  externalId = w.externalId,
) {
  const data = {
    ticketKey: w.ticketKey,
    title: w.title,
    description: w.description,
    status: w.status,
    priority: w.priority,
    assigneeName: w.assigneeName,
    isAssignedToMe: w.isAssignedToMe,
    externalUrl: w.externalUrl,
    startDate: w.startDate,
    dueDate: w.dueDate,
    externalCompletedAt: w.completedAt,
    projectId,
    syncedAt: new Date(),
  };
  const item = await prisma.workItem.upsert({
    where: {
      userId_provider_externalId: { userId, provider: "ZOHO", externalId },
    },
    create: { userId, provider: "ZOHO", externalId, ...data, sprintId },
    update: { ...data, ...(sprintId && { sprintId }) },
  });
  if (sprintId) {
    await prisma.workItemSprintSnapshot.upsert({
      where: { workItemId_sprintId: { workItemId: item.id, sprintId } },
      create: { workItemId: item.id, sprintId, status: w.status },
      update: { status: w.status, capturedAt: new Date() },
    });
  }
  return item;
}

export async function syncZoho(
  userId: string,
  now = new Date(),
): Promise<SyncOutcome[]> {
  const integration = await prisma.zohoIntegration.findUnique({
    where: { userId },
  });
  if (!integration || integration.status === "DISCONNECTED")
    throw badRequest("ZOHO_NOT_CONNECTED", "Zoho is not connected.");
  const ctx = await getUserContext(userId);
  const hosts = zohoHosts(env.ZOHO_DATA_CENTER);
  const results: SyncOutcome[] = [];
  await audit(userId, "SYSTEM", "sync.zoho.started", "SyncState");

  results.push(
    await runResource(userId, "ZOHO", "calendar_events", async () => {
      const reader = new ZohoCalendarApiReader(
        zohoClient(userId, [hosts.calendar]),
        hosts.calendar,
      );
      const todayStr = localDate(now, ctx.tz);
      const from = zonedTimeToUtc(
        addDays(todayStr, -env.ZOHO_SYNC_PAST_DAYS),
        "00:00",
        ctx.tz,
      );
      const to = zonedTimeToUtc(
        addDays(todayStr, env.ZOHO_SYNC_FUTURE_DAYS),
        "00:00",
        ctx.tz,
      );
      let count = 0;
      for (const cal of await reader.listCalendars()) {
        const events = await reader.listEvents(cal.externalId, { from, to });
        const seen: string[] = [];
        for (const e of events) {
          const { attendees, externalId, ...rest } = e;
          const data = {
            ...rest,
            attendees,
            isDeleted: false,
            syncedAt: new Date(),
          };
          await prisma.calendarEvent.upsert({
            where: {
              userId_provider_externalId: {
                userId,
                provider: "ZOHO",
                externalId,
              },
            },
            create: { userId, provider: "ZOHO", externalId, ...data },
            update: data,
          });
          seen.push(externalId);
          count++;
        }
        // Events inside the synced window that disappeared remotely are marked deleted locally.
        await prisma.calendarEvent.updateMany({
          where: {
            userId,
            provider: "ZOHO",
            calendarExternalId: cal.externalId,
            startAt: { gte: from, lt: to },
            externalId: { notIn: seen },
          },
          data: { isDeleted: true },
        });
      }
      return { count };
    }),
  );

  if (integration.portalId) {
    results.push(
      await runResource(userId, "ZOHO", "projects_tasks", async () => {
        const reader = new ZohoProjectsApiReader(
          zohoClient(userId, [hosts.projects]),
          hosts.projects,
          integration.portalId!,
        );
        const mine = await reader
          .listMyTaskIds()
          .catch(() => new Set<string>());
        let count = 0;
        for (const p of await reader.listProjects()) {
          const project = await upsertProject(userId, p);
          let cursor: string | undefined;
          for (let guard = 0; guard < 50; guard++) {
            const page = await reader.listTasks(p.externalId, { cursor });
            for (const t of page.items) {
              await upsertWorkItem(
                userId,
                { ...t, isAssignedToMe: mine.has(t.externalId) },
                project.id,
                null,
              );
              count++;
            }
            if (!page.nextCursor) break;
            cursor = page.nextCursor;
          }
        }
        return { count };
      }),
    );
  }

  if (integration.sprintsTeamId) {
    results.push(
      await runResource(userId, "ZOHO", "sprints", async () => {
        const reader = new ZohoSprintsApiReader(
          zohoClient(userId, [hosts.sprints]),
          hosts.sprints,
          integration.sprintsTeamId!,
          shapeLogger,
        );
        let count = 0;
        for (const p of await reader.listProjects()) {
          const project = await upsertProject(userId, {
            ...p,
            externalId: `sprints:${p.externalId}`,
          });
          for (const s of await reader.listSprints(p.externalId)) {
            const sprintData = {
              name: s.name,
              goal: s.goal,
              status: s.status,
              startDate: s.startDate,
              endDate: s.endDate,
              externalUrl: s.externalUrl,
              projectId: project.id,
              syncedAt: new Date(),
            };
            const sprint = await prisma.sprint.upsert({
              where: {
                userId_provider_externalId: {
                  userId,
                  provider: "ZOHO",
                  externalId: `sprints:${s.externalId}`,
                },
              },
              create: {
                userId,
                provider: "ZOHO",
                externalId: `sprints:${s.externalId}`,
                ...sprintData,
              },
              update: sprintData,
            });
            count++;
            if (
              s.status === "COMPLETED" &&
              s.endDate &&
              s.endDate < new Date(now.getTime() - 60 * 86_400_000)
            )
              continue;
            for (const item of await reader.listSprintItems(
              p.externalId,
              s.externalId,
            )) {
              const key =
                item.ticketKey && project.key && /^\d+$/.test(item.ticketKey)
                  ? `${project.key}-${item.ticketKey}`
                  : item.ticketKey;
              await upsertWorkItem(
                userId,
                { ...item, ticketKey: key, isAssignedToMe: true },
                project.id,
                sprint.id,
                `sprints:${item.externalId}`,
              );
              count++;
            }
          }
        }
        return { count };
      }),
    );
  }

  await prisma.zohoIntegration.update({
    where: { userId },
    data: {
      lastError: results.find((r) => !r.ok)?.error ?? null,
      status: results.every((r) => r.ok) ? "CONNECTED" : "ERROR",
    },
  });
  await refreshSuggestionsForDate(userId, localDate(now, ctx.tz)).catch(
    () => {},
  );
  await audit(userId, "SYSTEM", "sync.zoho.completed", "SyncState", null, {
    results,
  });
  return results;
}

export function githubConfigured() {
  return !!env.GITHUB_TOKEN;
}

export async function syncGithub(
  userId: string,
  now = new Date(),
): Promise<SyncOutcome[]> {
  if (!env.GITHUB_TOKEN)
    throw badRequest(
      "GITHUB_NOT_CONFIGURED",
      "GitHub is not configured. Set GITHUB_TOKEN (read-only). See docs/MANUAL_SETUP.md, section G.",
    );
  const reader = new GithubApiReader(
    new ReadOnlyHttpClient({
      allowedHosts: ["api.github.com"],
      authorization: async () => `Bearer ${env.GITHUB_TOKEN}`,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }),
  );
  const ctx = await getUserContext(userId);
  const results: SyncOutcome[] = [];
  let login = "";

  results.push(
    await runResource(userId, "GITHUB", "repositories", async () => {
      login = (await reader.getViewer()).login;
      await prisma.githubIntegration.upsert({
        where: { userId },
        create: { userId, login, status: "CONNECTED", connectedAt: new Date() },
        update: { login, status: "CONNECTED", lastError: null },
      });
      const allowList = env.GITHUB_REPOS?.split(",")
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean);
      const repos = await reader.listRepositories();
      for (const r of repos) {
        const selectedByEnv = allowList
          ? allowList.includes(r.fullName.toLowerCase())
          : true;
        await prisma.githubRepository.upsert({
          where: { userId_externalId: { userId, externalId: r.externalId } },
          create: {
            userId,
            externalId: r.externalId,
            fullName: r.fullName,
            url: r.url,
            isSelected: selectedByEnv,
            syncedAt: new Date(),
          },
          update: { fullName: r.fullName, url: r.url, syncedAt: new Date() },
        });
      }
      return { count: repos.length };
    }),
  );
  if (!login) return results;

  const selected = await prisma.githubRepository.findMany({
    where: { userId, isSelected: true },
    orderBy: { syncedAt: "desc" },
    take: 50,
  });
  const defaultSince = new Date(
    now.getTime() - env.GITHUB_SYNC_DAYS * 86_400_000,
  );

  for (const repo of selected) {
    results.push(
      await runResource(
        userId,
        "GITHUB",
        `repo:${repo.externalId}:commits`,
        async (state) => {
          const since =
            state.lastSuccessAt && state.lastSuccessAt > defaultSince
              ? new Date(state.lastSuccessAt.getTime() - 86_400_000)
              : defaultSince;
          const page = await reader.listActivity(
            {
              externalId: repo.externalId,
              fullName: repo.fullName,
              url: repo.url,
            },
            since,
            state.etag ?? undefined,
            login,
          );
          for (const a of page.items)
            await upsertActivity(
              userId,
              repo.id,
              a,
              extractTicketKeys(a.title),
            );
          return { count: page.items.length, etag: page.etag ?? null };
        },
      ),
    );
  }

  results.push(
    await runResource(
      userId,
      "GITHUB",
      "pull_requests_reviews_issues",
      async () => {
        const sinceDay = localDate(defaultSince, "UTC");
        const repoByName = new Map(
          selected.map((r) => [r.fullName.toLowerCase(), r]),
        );
        let count = 0;
        const authored = [
          ...(await reader.searchIssues(
            `author:${login} is:pr updated:>=${sinceDay}`,
          )),
          ...(await reader.searchIssues(
            `author:${login} is:issue updated:>=${sinceDay}`,
          )),
        ];
        for (const i of authored) {
          const repo = repoByName.get(i.repoFullName.toLowerCase());
          if (!repo) continue;
          const keys = extractTicketKeys(i.title);
          if (i.pull_request) {
            await upsertActivity(
              userId,
              repo.id,
              {
                externalId: `pr:${i.id}:opened`,
                type: "PULL_REQUEST_OPENED",
                title: `#${i.number} ${i.title}`,
                url: i.html_url,
                occurredAt: new Date(i.created_at),
              },
              keys,
            );
            if (i.pull_request.merged_at) {
              await upsertActivity(
                userId,
                repo.id,
                {
                  externalId: `pr:${i.id}:merged`,
                  type: "PULL_REQUEST_MERGED",
                  title: `#${i.number} ${i.title}`,
                  url: i.html_url,
                  occurredAt: new Date(i.pull_request.merged_at),
                },
                keys,
              );
            }
          } else {
            await upsertActivity(
              userId,
              repo.id,
              {
                externalId: `issue:${i.id}`,
                type: "ISSUE",
                title: `#${i.number} ${i.title}`,
                url: i.html_url,
                occurredAt: new Date(i.created_at),
              },
              keys,
            );
          }
          count++;
        }
        const reviewed = await reader.searchIssues(
          `is:pr reviewed-by:${login} updated:>=${sinceDay}`,
        );
        for (const pr of reviewed.slice(0, 30)) {
          const repo = repoByName.get(pr.repoFullName.toLowerCase());
          if (!repo) continue;
          for (const r of await reader.listPullReviews(
            pr.repoFullName,
            pr.number,
          )) {
            if (
              r.user?.login?.toLowerCase() !== login.toLowerCase() ||
              !r.submitted_at
            )
              continue;
            await upsertActivity(
              userId,
              repo.id,
              {
                externalId: `review:${r.id}`,
                type: "REVIEW",
                title: `Reviewed #${pr.number} ${pr.title}`,
                url: r.html_url,
                occurredAt: new Date(r.submitted_at),
              },
              extractTicketKeys(pr.title),
            );
            count++;
          }
        }
        return { count };
      },
    ),
  );

  await prisma.githubIntegration.update({
    where: { userId },
    data: {
      lastError: results.find((r) => !r.ok)?.error ?? null,
      status: results.every((r) => r.ok) ? "CONNECTED" : "ERROR",
    },
  });
  await refreshSuggestionsForDate(userId, localDate(now, ctx.tz)).catch(
    () => {},
  );
  await audit(userId, "SYSTEM", "sync.github.completed", "SyncState", null, {
    results: results.length,
    failed: results.filter((r) => !r.ok).length,
  });
  return results;
}

async function upsertActivity(
  userId: string,
  repositoryId: string,
  a: {
    externalId: string;
    type:
      | "COMMIT"
      | "PULL_REQUEST_OPENED"
      | "PULL_REQUEST_MERGED"
      | "REVIEW"
      | "ISSUE";
    title: string;
    url: string | null;
    occurredAt: Date;
  },
  ticketKeys: string[],
) {
  await prisma.githubActivity.upsert({
    where: { userId_externalId: { userId, externalId: a.externalId } },
    create: {
      userId,
      repositoryId,
      externalId: a.externalId,
      type: a.type,
      title: a.title,
      url: a.url,
      occurredAt: a.occurredAt,
      ticketKeys,
      syncedAt: new Date(),
    },
    update: {
      title: a.title,
      url: a.url,
      occurredAt: a.occurredAt,
      ticketKeys,
      syncedAt: new Date(),
    },
  });
}

export async function syncStatus(userId: string) {
  const [states, zoho, github] = await Promise.all([
    prisma.syncState.findMany({
      where: { userId },
      orderBy: [{ provider: "asc" }, { resource: "asc" }],
    }),
    prisma.zohoIntegration.findUnique({ where: { userId } }),
    prisma.githubIntegration.findUnique({ where: { userId } }),
  ]);
  return {
    zoho: {
      configured: !!(env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET),
      status: zoho?.status ?? "DISCONNECTED",
      portalId: zoho?.portalId ?? null,
      sprintsTeamId: zoho?.sprintsTeamId ?? null,
      lastError: zoho?.lastError ?? null,
      dataCenter: env.ZOHO_DATA_CENTER,
    },
    github: {
      configured: githubConfigured(),
      status: github?.status ?? "DISCONNECTED",
      login: github?.login ?? null,
      lastError: github?.lastError ?? null,
    },
    states: states.map((s) => ({
      provider: s.provider,
      resource: s.resource,
      lastSyncedAt: s.lastSyncedAt,
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
    })),
  };
}
