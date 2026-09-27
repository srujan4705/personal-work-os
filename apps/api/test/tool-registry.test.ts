import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOLS, TOOL_NAMES, toProviderToolSpec } from '@pwos/ai-contracts';

describe('AI tool registry', () => {
  it('external data sources are READ_ONLY only', () => {
    for (const name of TOOL_NAMES) {
      const t = TOOLS[name];
      if (t.dataSource !== 'LOCAL_DB') expect(t.permission, name).toBe('READ_ONLY');
    }
  });

  it('no tool name targets writing to Zoho or GitHub', () => {
    for (const name of TOOL_NAMES) {
      if (/zoho|github/i.test(name)) {
        expect(name).toMatch(/^(get|list)_/);
        expect(TOOLS[name].permission).toBe('READ_ONLY');
      }
    }
  });

  it('no tool accepts a user identity or secret-like argument', () => {
    for (const name of TOOL_NAMES) {
      const json = JSON.stringify(toProviderToolSpec(name).parameters).toLowerCase();
      for (const bad of ['userid', 'user_id', 'token', 'password', 'secret', 'apikey', 'sql']) {
        expect(json, `${name} contains ${bad}`).not.toContain(`"${bad}`);
      }
    }
  });

  it('every schema is strict (rejects unknown keys)', () => {
    for (const name of TOOL_NAMES) {
      const schema = TOOLS[name].input as z.ZodType;
      const spec = z.toJSONSchema(schema) as { additionalProperties?: unknown };
      expect(spec.additionalProperties, name).toBe(false);
    }
  });

  it('every write tool has a confirmation summary', () => {
    for (const name of TOOL_NAMES) {
      if (TOOLS[name].permission !== 'READ_ONLY') expect(TOOLS[name].summarize, name).toBeTypeOf('function');
    }
  });
});
