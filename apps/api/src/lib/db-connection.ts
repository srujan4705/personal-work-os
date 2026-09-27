/**
 * Builds node-postgres connection options. Without a CA this is just the URL (unchanged
 * behaviour). With a CA (e.g. Supabase's root certificate) TLS is enforced with full
 * certificate verification; TLS parameters in the URL are removed because node-postgres
 * lets URL parameters override the ssl object.
 * Dependency-free on purpose: used by both the app and the standalone migration runner.
 */
const URL_TLS_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'uselibpqcompat'];

export function decodeCa(value: string): string {
  const text = value.includes('BEGIN CERTIFICATE') ? value : Buffer.from(value, 'base64').toString('utf8');
  if (!text.includes('BEGIN CERTIFICATE')) throw new Error('DATABASE_SSL_CA must be a PEM certificate or base64 of one.');
  return text.replace(/\\n/g, '\n');
}

export function pgConnectionConfig(url: string, ca?: string): { connectionString: string; ssl?: { ca: string; rejectUnauthorized: true } } {
  if (!ca) return { connectionString: url };
  const u = new URL(url);
  for (const p of URL_TLS_PARAMS) u.searchParams.delete(p);
  return { connectionString: u.toString(), ssl: { ca: decodeCa(ca), rejectUnauthorized: true } };
}
