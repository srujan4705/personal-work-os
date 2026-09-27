import type { CalendarProvider, ProjectProvider, SprintProvider } from '../providers';

/** Zoho implementations are just read-only providers. No write surface exists. */
export type ZohoCalendarReader = CalendarProvider;
export type ZohoProjectsReader = ProjectProvider;
export type ZohoSprintsReader = SprintProvider;
