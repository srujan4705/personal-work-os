import type { ReadOnlyHttpClient } from '../http/read-only-http-client';
import type { ExternalActivity, ExternalRepository, Page, SourceControlProvider } from '../providers';

const API = 'https://api.github.com';

interface RawCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author?: { date?: string }; committer?: { date?: string } };
}
interface RawIssue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  pull_request?: { merged_at?: string | null };
  repository_url: string;
}

/**
 * READ-ONLY GitHub provider using REST GET endpoints only (the query-language API is excluded: it only accepts POST).
 * Supports ETags so unchanged resources cost no rate limit.
 */
export class GithubApiReader implements SourceControlProvider {
  constructor(private readonly http: ReadOnlyHttpClient) {}

  async getViewer(): Promise<{ login: string }> {
    const res = await this.http.get<{ login: string }>(`${API}/user`);
    return { login: res.data!.login };
  }

  async listRepositories(): Promise<ExternalRepository[]> {
    const out: ExternalRepository[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await this.http.get<{ id: number; full_name: string; html_url: string }[]>(`${API}/user/repos`, {
        query: { per_page: 100, page, sort: 'pushed', affiliation: 'owner,collaborator,organization_member' },
      });
      const repos = res.data ?? [];
      out.push(...repos.map((r) => ({ externalId: String(r.id), fullName: r.full_name, url: r.html_url })));
      if (repos.length < 100) break;
    }
    return out;
  }

  /** Commits authored by the viewer in one repository. */
  async listActivity(repo: ExternalRepository, since: Date, etag?: string, login?: string): Promise<Page<ExternalActivity>> {
    const res = await this.http.get<RawCommit[]>(`${API}/repos/${repo.fullName}/commits`, {
      query: { author: login, since: since.toISOString(), per_page: 100 },
      etag,
    });
    const items = (res.data ?? []).map((c) => ({
      externalId: `commit:${c.sha}`,
      type: 'COMMIT' as const,
      title: c.commit.message.split('\n')[0]!.slice(0, 300),
      url: c.html_url,
      occurredAt: new Date(c.commit.author?.date ?? c.commit.committer?.date ?? Date.now()),
    }));
    return { items, nextCursor: null, etag: res.etag };
  }

  /** Pull requests and issues found with GitHub search (a GET endpoint). */
  async searchIssues(query: string): Promise<(RawIssue & { repoFullName: string })[]> {
    const res = await this.http.get<{ items?: RawIssue[] }>(`${API}/search/issues`, { query: { q: query, per_page: 100, sort: 'updated' } });
    return (res.data?.items ?? []).map((i) => ({ ...i, repoFullName: i.repository_url.replace(`${API}/repos/`, '') }));
  }

  async listPullReviews(repoFullName: string, prNumber: number): Promise<{ id: number; user?: { login?: string }; submitted_at?: string; html_url: string; state: string }[]> {
    const res = await this.http.get<{ id: number; user?: { login?: string }; submitted_at?: string; html_url: string; state: string }[]>(
      `${API}/repos/${repoFullName}/pulls/${prNumber}/reviews`, { query: { per_page: 100 } },
    );
    return res.data ?? [];
  }
}
