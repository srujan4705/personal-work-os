import type { ReadOnlyHttpClient } from '../http/read-only-http-client';
import type { ExternalProject, ExternalSprint, ExternalWorkItem } from '../providers';
import type { ZohoSprintsReader } from './zoho.readers';
import { decodeColumnar, parseZohoDateTime, str } from './zoho.util';

const SPRINT_TYPE: Record<ExternalSprint['status'], number> = { UPCOMING: 1, ACTIVE: 2, COMPLETED: 3 };

/** READ-ONLY Zoho Sprints provider. Ids are prefixed "sprints:" locally to avoid clashes with Zoho Projects. */
export class ZohoSprintsApiReader implements ZohoSprintsReader {
  constructor(
    private readonly http: ReadOnlyHttpClient,
    private readonly host: string,
    private readonly teamId: string,
    private readonly onShape?: (resource: string, keys: string[]) => void,
  ) {}

  private url(path: string) {
    return `https://${this.host}/zsapi/team/${encodeURIComponent(this.teamId)}${path}`;
  }

  async listProjects(): Promise<ExternalProject[]> {
    const res = await this.http.get<Record<string, unknown>>(this.url('/projects/'), { query: { action: 'data', index: 1, range: 100 } });
    this.onShape?.('projects', Object.keys(res.data ?? {}));
    return decodeColumnar(res.data, 'project').map((p) => ({
      externalId: String(p.id),
      name: str(p.projName) ?? str(p.projectName) ?? str(p.name) ?? 'Project',
      key: str(p.projKey) ?? str(p.projectKey) ?? str(p.prefix),
      status: null,
      externalUrl: null,
    }));
  }

  async listSprints(projectId: string, status?: ExternalSprint['status']): Promise<ExternalSprint[]> {
    const types = status ? [SPRINT_TYPE[status]] : [1, 2, 3];
    const res = await this.http.get<Record<string, unknown>>(this.url(`/projects/${encodeURIComponent(projectId)}/sprints/`), {
      query: { action: 'data', index: 1, range: 100, type: JSON.stringify(types) },
    });
    this.onShape?.('sprints', Object.keys(res.data ?? {}));
    return decodeColumnar(res.data, 'sprint').map((s) => {
      const type = Number(s.sprintType ?? s.type);
      return {
        externalId: String(s.id),
        projectExternalId: projectId,
        name: str(s.sprintName) ?? str(s.name) ?? `Sprint ${s.id}`,
        goal: str(s.description) ?? str(s.goal),
        status: type === 1 ? 'UPCOMING' : type === 2 ? 'ACTIVE' : 'COMPLETED',
        startDate: parseZohoDateTime(s.startDate ?? s.fromDate ?? null),
        endDate: parseZohoDateTime(s.endDate ?? s.toDate ?? null),
        externalUrl: null,
      } satisfies ExternalSprint;
    });
  }

  async listSprintItems(projectId: string, sprintId: string): Promise<ExternalWorkItem[]> {
    const res = await this.http.get<Record<string, unknown>>(this.url(`/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/item/`), {
      query: { action: 'sprintitems', index: 1, range: 200 },
    });
    this.onShape?.('items', Object.keys(res.data ?? {}));
    return decodeColumnar(res.data, 'item').map((i) => ({
      externalId: String(i.id),
      projectExternalId: projectId,
      sprintExternalId: sprintId,
      ticketKey: str(i.itemNo) ?? str(i.itemKey),
      title: str(i.itemName) ?? str(i.name) ?? '(Untitled item)',
      description: str(i.description),
      status: str(i.statusName) ?? str(i.status),
      priority: str(i.priorityName) ?? str(i.priority),
      assigneeName: str(i.ownerName) ?? null,
      isAssignedToMe: false,
      externalUrl: null,
      startDate: parseZohoDateTime(i.startDate ?? null),
      dueDate: parseZohoDateTime(i.endDate ?? i.dueDate ?? null),
      completedAt: i.isCompleted === true || i.completed === true ? new Date() : null,
    }));
  }
}

export async function listZohoSprintsTeams(http: ReadOnlyHttpClient, host: string) {
  const res = await http.get<{ portals?: { zsoid?: string | number; orgName?: string; teamName?: string }[] }>(`https://${host}/zsapi/teams/`);
  return (res.data?.portals ?? []).map((p) => ({ id: String(p.zsoid), name: p.teamName ?? p.orgName ?? 'Team' }));
}
