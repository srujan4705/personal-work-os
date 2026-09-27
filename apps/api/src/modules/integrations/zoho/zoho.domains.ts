/** Per-data-centre Zoho hosts. All data hosts are read through ReadOnlyHttpClient. */
export type ZohoDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';

const TLD: Record<ZohoDataCenter, string> = {
  com: 'zoho.com', eu: 'zoho.eu', in: 'zoho.in', 'com.au': 'zoho.com.au', jp: 'zoho.jp', ca: 'zohocloud.ca', sa: 'zoho.sa',
};

export function zohoHosts(dc: ZohoDataCenter) {
  const tld = TLD[dc];
  return {
    accounts: `accounts.${tld}`,
    calendar: `calendar.${tld}`,
    projects: `projectsapi.${tld}`,
    sprints: `sprintsapi.${tld}`,
  };
}

export const ZOHO_ACCOUNT_HOSTS = Object.values(TLD).map((t) => `accounts.${t}`);
