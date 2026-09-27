/**
 * OAuth scopes requested from Zoho. READ scopes only — enforced by test.
 * Verify exact names against the Zoho API docs for your data centre during
 * Phase 2 setup (documented in docs/MANUAL_SETUP.md).
 */
export const ZOHO_READ_SCOPES = [
  'ZohoCalendar.calendar.READ',
  'ZohoCalendar.event.READ',
  'ZohoProjects.portals.READ',
  'ZohoProjects.projects.READ',
  'ZohoProjects.tasks.READ',
  'ZohoSprints.teams.READ',
  'ZohoSprints.projects.READ',
  'ZohoSprints.sprints.READ',
  'ZohoSprints.items.READ',
] as const;

/** Zoho Calendar limits the date range per events request; ranges are chunked to this. */
export const ZOHO_CALENDAR_MAX_RANGE_DAYS = 31;
