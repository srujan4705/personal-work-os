export type Label = 'CONFIRMED' | 'SUGGESTED' | 'OBSERVED' | 'EXTERNAL';

export interface Entry {
  id: string;
  ticketKey: string | null;
  ticketTitle: string | null;
  ticketUrl: string | null;
  projectName: string | null;
  activityType: string;
  durationMinutes: number;
  startTime: string | null;
  endTime: string | null;
  description: string | null;
  source: string;
  version: number;
}

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  entryIds: string[];
}

export interface Timesheet {
  timesheet: { id: string; date: string; status: 'DRAFT' | 'SUBMITTED' | 'LOCKED'; dayType: string; submissionNote: string | null };
  entries: Entry[];
  issues: Issue[];
  summary: { loggedMinutes: number; expectedMinutes: number; remainingMinutes: number };
}

export interface Suggestion {
  id: string;
  source: string;
  activityType: string;
  durationMinutes: number | null;
  startTime: string | null;
  endTime: string | null;
  description: string | null;
  ticketKey: string | null;
  evidence: { basis?: string; activities?: { type: string; title: string; repo: string }[] } | null;
}

export interface Timer {
  id: string;
  status: 'RUNNING' | 'PAUSED';
  activityType: string;
  ticketKey: string | null;
  ticketTitle: string | null;
  description: string | null;
  elapsedSeconds: number;
}

export interface TimelineItem {
  id: string;
  kind: string;
  label: Label;
  time: string | null;
  endTime: string | null;
  title: string;
  detail: string | null;
  durationMinutes: number | null;
  url: string | null;
}

export interface Gap {
  start: string;
  end: string;
  minutes: number;
  message: string;
  observed: { at: string; label: string }[];
}
