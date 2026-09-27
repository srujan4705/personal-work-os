/**
 * Provider-independent, READ-ONLY interfaces for external systems.
 * Every method must start with "list" or "get" (enforced by test).
 * Implementations return normalized DTOs — raw provider payloads never leave the provider.
 */

export interface DateRange {
  from: Date;
  to: Date;
}

export interface ExternalCalendar {
  externalId: string;
  name: string;
  isPrimary: boolean;
}

export interface ExternalCalendarEvent {
  externalId: string;
  calendarExternalId: string;
  title: string;
  description: string | null;
  location: string | null;
  meetingUrl: string | null;
  organizer: string | null;
  attendees: { name: string | null; email: string | null }[];
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
}

export interface ExternalProject {
  externalId: string;
  name: string;
  key: string | null;
  status: string | null;
  externalUrl: string | null;
}

export interface ExternalWorkItem {
  externalId: string;
  projectExternalId: string;
  sprintExternalId: string | null;
  ticketKey: string | null;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  assigneeName: string | null;
  isAssignedToMe: boolean;
  externalUrl: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
}

export interface ExternalSprint {
  externalId: string;
  projectExternalId: string;
  name: string;
  goal: string | null;
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED';
  startDate: Date | null;
  endDate: Date | null;
  externalUrl: string | null;
}

export interface ExternalRepository {
  externalId: string;
  fullName: string;
  url: string;
}

export interface ExternalActivity {
  externalId: string;
  type: 'COMMIT' | 'PULL_REQUEST_OPENED' | 'PULL_REQUEST_MERGED' | 'REVIEW' | 'ISSUE';
  title: string;
  url: string | null;
  occurredAt: Date;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  etag?: string | null;
}

export interface CalendarProvider {
  listCalendars(): Promise<ExternalCalendar[]>;
  /** Implementations chunk `range` to respect provider range limits. */
  listEvents(calendarId: string, range: DateRange): Promise<ExternalCalendarEvent[]>;
  getEvent(calendarId: string, eventId: string): Promise<ExternalCalendarEvent | null>;
}

export interface ProjectProvider {
  listProjects(): Promise<ExternalProject[]>;
  listTasks(projectId: string, opts?: { cursor?: string; updatedSince?: Date }): Promise<Page<ExternalWorkItem>>;
  getTask(projectId: string, taskId: string): Promise<ExternalWorkItem | null>;
}

export interface SprintProvider {
  listSprints(projectId: string, status?: ExternalSprint['status']): Promise<ExternalSprint[]>;
  listSprintItems(projectId: string, sprintId: string): Promise<ExternalWorkItem[]>;
}

export interface SourceControlProvider {
  listRepositories(): Promise<ExternalRepository[]>;
  /** REST GET only: GitHub GraphQL is excluded because every GraphQL call is a POST. */
  listActivity(repo: ExternalRepository, since: Date, etag?: string): Promise<Page<ExternalActivity>>;
}
