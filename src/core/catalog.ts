import { readFileSync } from 'node:fs';
import { SITE_CAPABILITIES, type Catalog, type Capability, type SiteEntry } from './types.js';

const CATALOG_URL = new URL('../../catalog/sites.json', import.meta.url);

export class CatalogError extends Error {}

/** Load and validate the machine-readable site catalog. */
export function loadCatalog(url: URL = CATALOG_URL): Catalog {
  const raw = readFileSync(url, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new CatalogError('catalog root must be an object');
  }
  const catalog = parsed as Catalog;
  const problems = validateCatalog(catalog);
  if (problems.length > 0) {
    throw new CatalogError(`invalid catalog:\n- ${problems.join('\n- ')}`);
  }
  return catalog;
}

export function validateCatalog(catalog: Catalog): string[] {
  const problems: string[] = [];
  if (!Array.isArray(catalog.sites)) {
    return ['sites must be an array'];
  }
  if (catalog.sites.length < 50) {
    problems.push(`expected at least 50 sites, found ${catalog.sites.length}`);
  }
  const seen = new Set<string>();
  for (const [index, site] of catalog.sites.entries()) {
    const where = `sites[${index}] (${site?.id ?? 'unknown'})`;
    if (!site || typeof site !== 'object') {
      problems.push(`${where}: not an object`);
      continue;
    }
    if (!site.id || typeof site.id !== 'string') problems.push(`${where}: missing id`);
    else if (seen.has(site.id)) problems.push(`${where}: duplicate id`);
    else seen.add(site.id);
    if (!site.name) problems.push(`${where}: missing name`);
    if (!site.url || !/^https?:\/\//.test(site.url)) problems.push(`${where}: invalid url`);
    if (!Array.isArray(site.caps) || site.caps.length === 0) problems.push(`${where}: caps must be non-empty`);
    for (const cap of site.caps ?? []) {
      if (!SITE_CAPABILITIES.includes(cap)) problems.push(`${where}: unknown capability "${cap}"`);
    }
    if (site.free !== null) {
      const free = site.free;
      if (!free || typeof free.amount !== 'number' || free.amount <= 0) problems.push(`${where}: free.amount must be > 0`);
      if (free && !['day', 'week', 'month', 'once'].includes(free.period)) problems.push(`${where}: bad free.period`);
      if (free && typeof free.unit !== 'string') problems.push(`${where}: bad free.unit`);
    }
    if (!['browser', 'api', 'both', 'none'].includes(site.access)) problems.push(`${where}: bad access`);
    if (!['high', 'medium', 'low'].includes(site.confidence)) problems.push(`${where}: bad confidence`);
  }
  return problems;
}

export function sitesFor(catalog: Catalog, capability: Capability): SiteEntry[] {
  return catalog.sites.filter(
    (site) => site.caps.includes(capability) && site.free !== null && site.access !== 'none',
  );
}

export function summarize(catalog: Catalog): Record<string, number> {
  const out: Record<string, number> = {};
  for (const site of catalog.sites) {
    out[site.category] = (out[site.category] ?? 0) + 1;
  }
  out['_total'] = catalog.sites.length;
  out['_withFreeTier'] = catalog.sites.filter((s) => s.free !== null).length;
  out['_browserOnly'] = catalog.sites.filter((s) => s.access === 'browser').length;
  return out;
}
