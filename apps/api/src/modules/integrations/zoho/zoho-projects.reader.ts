import type { ReadOnlyHttpClient } from '../http/read-only-http-client';
import type { ExternalProject, ExternalWorkItem, Page } from '../providers';
import type { ZohoProjectsReader } from './zoho.readers';
import { str } from './zoho.util';

const PAGE = 100;

interface RawTask {
  id_string?: string;
  id?: number | string;
  key?: string;
  name?: string;
  description?: string;
  status?: { name?: string; type?: string };
  priority?: string;
  details?: { owners?: { name?: string; id?: string | number }[] };
  link?: { web?: { url?: string }; self?: { url?: string } };
  start_date_long?: number;
  end_date_long?: number;
  completed_time_long?: number;
  project?: { id_string?: string; id?: number | string };
}

/** READ-ONLY Zoho Projects provider (REST v1, portal-scoped). */
export class ZohoProjectsApiReader implements ZohoProjectsReader {
  constructor(
    private readonly http: ReadOnlyHttpClient,
    private readonly host: string,
    private readonly portalId: string,
  ) {}

  private url(path: string) {
    return `https://${this.host}/restapi/portal/${encodeURIComponent(this.portalId)}${path}`;
  }

  async listProjects(): Promise<ExternalProject[]> {
    const out: ExternalProject[] = [];
    for (let index = 1; ; index += PAGE) {
      const res = await this.http.get<{ projects?: { id_string?: string; id?: number; name?: string; key?: string; status?: string; link?: { web?: { url?: string } } }[] }>(
        this.url('/projects/'), { query: { index, range: PAGE, status: 'active' } },
      );
      const page = res.data?.projects ?? [];
      for (const p of page) {
        const id = p.id_string ?? str(p.id);
        if (id) out.push({ externalId: id, name: p.name ?? 'Project', key: p.key ?? null, status: p.status ?? null, externalUrl: p.link?.web?.url ?? null });
      }
      if (page.length < PAGE) return out;
    }
  }

  async listTasks(projectId: string, opts: { cursor?: string } = {}): Promise<Page<ExternalWorkItem>> {
    const index = Number(opts.cursor ?? 1);
    const res = await this.http.get<{ tasks?: RawTask[] }>(this.url(`/projects/${encodeURIComponent(projectId)}/tasks/`), { query: { index, range: PAGE } });
    const tasks = res.data?.tasks ?? [];
    return { items: tasks.map((t) => this.map(t, projectId)).filter((t): t is ExternalWorkItem => !!t), nextCursor: tasks.length < PAGE ? null : String(index + PAGE) };
  }

  async getTask(projectId: string, taskId: string): Promise<ExternalWorkItem | null> {
    const res = await this.http.get<{ tasks?: RawTask[] }>(this.url(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/`));
    const t = res.data?.tasks?.[0];
    return t ? this.map(t, projectId) : null;
  }

  /** Ids of tasks assigned to the connected user (Zoho "My Tasks"). */
  async listMyTaskIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (let index = 1; ; index += PAGE) {
      const res = await this.http.get<{ tasks?: RawTask[] }>(this.url('/mytasks/'), { query: { index, range: PAGE } });
      const page = res.data?.tasks ?? [];
      for (const t of page) {
        const id = t.id_string ?? str(t.id);
        if (id) ids.add(id);
      }
      if (page.length < PAGE) return ids;
    }
  }

  private map(t: RawTask, projectId: string): ExternalWorkItem | null {
    const id = t.id_string ?? str(t.id);
    if (!id) return null;
    return {
      externalId: id,
      projectExternalId: projectId,
      sprintExternalId: null,
      ticketKey: t.key ?? null,
      title: t.name ?? '(Untitled task)',
      description: str(t.description),
      status: t.status?.name ?? null,
      priority: t.priority ?? null,
      assigneeName: t.details?.owners?.map((o) => o.name).filter(Boolean).join(', ') || null,
      isAssignedToMe: false,
      externalUrl: t.link?.web?.url ?? null,
      startDate: t.start_date_long ? new Date(t.start_date_long) : null,
      dueDate: t.end_date_long ? new Date(t.end_date_long) : null,
      completedAt: t.completed_time_long ? new Date(t.completed_time_long) : t.status?.type === 'closed' ? new Date() : null,
    };
  }
}

/** Lists the portals the token can see (used to pick a portal during setup). */
export async function listZohoPortals(http: ReadOnlyHttpClient, host: string) {
  const res = await http.get<{ portals?: { id_string?: string; id?: number; name?: string }[] }>(`https://${host}/restapi/portals/`);
  return (res.data?.portals ?? []).map((p) => ({ id: p.id_string ?? String(p.id), name: p.name ?? 'Portal' }));
}
