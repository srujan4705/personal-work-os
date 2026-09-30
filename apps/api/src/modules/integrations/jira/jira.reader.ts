import type { ReadOnlyHttpClient } from '../http/read-only-http-client';
import { ProviderHttpError } from '../http/read-only-http-client';
import type { ExternalProject, ExternalSprint, ExternalWorkItem, SprintProvider } from '../providers';

const PAGE = 100;
const ISSUE_FIELDS = 'summary,description,status,priority,assignee,project,duedate,created,resolutiondate';

interface RawIssue {
  id?: string;
  key?: string;
  fields?: {
    summary?: string;
    description?: unknown; // Atlassian Document Format — not plain text, only used for presence checks
    status?: { name?: string };
    priority?: { name?: string };
    assignee?: { displayName?: string; accountId?: string };
    project?: { id?: string; key?: string; name?: string };
    duedate?: string | null;
    created?: string;
    resolutiondate?: string | null;
  };
}

interface RawBoard {
  id?: number;
  type?: string; // 'scrum' | 'kanban' | 'simple' — only scrum boards have sprints
}

interface RawSprint {
  id?: number;
  name?: string;
  goal?: string;
  state?: 'active' | 'future' | 'closed';
  startDate?: string;
  endDate?: string;
}

/** A synced issue together with the project it belongs to (projects are discovered from issues). */
export interface JiraIssue {
  project: ExternalProject;
  item: ExternalWorkItem;
}

/**
 * READ-ONLY Jira Cloud provider.
 * Issue search uses GET /rest/api/3/search/jql (the old /rest/api/3/search was removed by
 * Atlassian — see developer.atlassian.com/changelog/#CHANGE-2046). It pages with
 * nextPageToken and returns no total. Boards/sprints use the Agile API v1.0.
 */
export class JiraApiReader implements SprintProvider {
  constructor(
    private readonly http: ReadOnlyHttpClient,
    private readonly baseUrl: string, // e.g. "https://yourcompany.atlassian.net"
    private readonly meAccountId: string,
  ) {}

  private api(path: string) {
    return `${this.baseUrl}/rest/api/3${path}`;
  }

  private agile(path: string) {
    return `${this.baseUrl}/rest/agile/1.0${path}`;
  }

  private map(i: RawIssue, sprintId: string | null): JiraIssue | null {
    const f = i.fields ?? {};
    if (!i.id || !f.project?.id) return null;
    return {
      project: {
        externalId: f.project.id,
        name: f.project.name ?? f.project.key ?? 'Project',
        key: f.project.key ?? null,
        status: null,
        externalUrl: f.project.key ? `${this.baseUrl}/browse/${encodeURIComponent(f.project.key)}` : null,
      },
      item: {
        externalId: i.id,
        projectExternalId: f.project.id,
        sprintExternalId: sprintId,
        ticketKey: i.key ?? null,
        title: f.summary ?? '(Untitled issue)',
        description: f.description ? '(see Jira for full description)' : null,
        status: f.status?.name ?? null,
        priority: f.priority?.name ?? null,
        assigneeName: f.assignee?.displayName ?? null,
        isAssignedToMe: !!f.assignee?.accountId && f.assignee.accountId === this.meAccountId,
        externalUrl: i.key ? `${this.baseUrl}/browse/${encodeURIComponent(i.key)}` : null,
        startDate: null,
        dueDate: f.duedate ? new Date(f.duedate) : null,
        completedAt: f.resolutiondate ? new Date(f.resolutiondate) : null,
      },
    };
  }

  /** One page of issues assigned to the user: still open, or touched in the last 30 days. */
  async listMyIssues(pageToken?: string): Promise<{ items: JiraIssue[]; nextPageToken: string | null }> {
    const res = await this.http.get<{ issues?: RawIssue[]; nextPageToken?: string }>(this.api('/search/jql'), {
      query: {
        jql: 'assignee = currentUser() AND (statusCategory != Done OR updated >= -30d) ORDER BY updated DESC',
        maxResults: PAGE,
        fields: ISSUE_FIELDS,
        nextPageToken: pageToken,
      },
    });
    const items = (res.data?.issues ?? []).map((i) => this.map(i, null)).filter((i): i is JiraIssue => !!i);
    return { items, nextPageToken: res.data?.nextPageToken ?? null };
  }

  /** Active/future/closed sprints across the project's scrum boards. Kanban boards have no sprints and are skipped. */
  async listSprints(projectId: string, status?: ExternalSprint['status']): Promise<ExternalSprint[]> {
    const state = status ? { UPCOMING: 'future', ACTIVE: 'active', COMPLETED: 'closed' }[status] : undefined;
    const boards = await this.http.get<{ values?: RawBoard[] }>(this.agile('/board'), { query: { projectKeyOrId: projectId, type: 'scrum', maxResults: 50 } });
    const out: ExternalSprint[] = [];
    const seen = new Set<string>();
    for (const board of boards.data?.values ?? []) {
      if (!board.id || (board.type && board.type !== 'scrum')) continue;
      let sprints: RawSprint[];
      try {
        const res = await this.http.get<{ values?: RawSprint[] }>(this.agile(`/board/${board.id}/sprint`), { query: { state, maxResults: 50 } });
        sprints = res.data?.values ?? [];
      } catch (err) {
        // A board can still refuse sprint queries (e.g. sprints disabled). Skip it rather than fail the whole sync.
        if (err instanceof ProviderHttpError && (err.status === 400 || err.status === 403 || err.status === 404)) continue;
        throw err;
      }
      for (const s of sprints) {
        if (!s.id || seen.has(String(s.id))) continue;
        seen.add(String(s.id));
        out.push({
          externalId: String(s.id),
          projectExternalId: projectId,
          name: s.name ?? `Sprint ${s.id}`,
          goal: s.goal ?? null,
          status: s.state === 'active' ? 'ACTIVE' : s.state === 'future' ? 'UPCOMING' : 'COMPLETED',
          startDate: s.startDate ? new Date(s.startDate) : null,
          endDate: s.endDate ? new Date(s.endDate) : null,
          externalUrl: null,
        });
      }
    }
    return out;
  }

  async listSprintItems(projectId: string, sprintId: string): Promise<ExternalWorkItem[]> {
    const out: ExternalWorkItem[] = [];
    for (let startAt = 0; startAt < 1000; startAt += PAGE) {
      const res = await this.http.get<{ issues?: RawIssue[]; total?: number }>(this.agile(`/sprint/${encodeURIComponent(sprintId)}/issue`), {
        query: { fields: ISSUE_FIELDS, startAt, maxResults: PAGE },
      });
      const page = res.data?.issues ?? [];
      for (const i of page) {
        const mapped = this.map(i, sprintId);
        // Keep items from other projects on a shared board out of this project's sprint.
        if (mapped && mapped.project.externalId === projectId) out.push(mapped.item);
      }
      if (page.length < PAGE || (res.data?.total !== undefined && startAt + page.length >= res.data.total)) break;
    }
    return out;
  }
}

/** Verifies the base URL + credentials and returns the account id needed for "assigned to me" checks. Used once, during Connect. */
export async function verifyJiraCredentials(http: ReadOnlyHttpClient, baseUrl: string): Promise<{ accountId: string; displayName: string }> {
  const res = await http.get<{ accountId?: string; displayName?: string }>(`${baseUrl}/rest/api/3/myself`);
  if (!res.data?.accountId) throw new Error('Jira did not return an account id — check the base URL, email and API token.');
  return { accountId: res.data.accountId, displayName: res.data.displayName ?? 'Jira user' };
}
