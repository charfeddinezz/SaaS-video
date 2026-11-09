#!/usr/bin/env node
/**
 * Dependency-free catalog validator.
 * Usage: node scripts/validate-catalog.mjs
 */
import { readFileSync } from 'node:fs';

const CAPS = new Set([
  'llm', 'text2video', 'image2video', 'reference2video', 'video2video', 'text2image', 'image2image',
  'tts', 'dubbing', 'music', 'sfx', 'lipsync', 'avatar', 'edit', 'caption',
  'stem-separation', 'vector', 'storyboard', 'upload',
]);
const CATEGORIES = new Set(['video', 'image', 'audio', 'edit', 'publish', 'llm']);
const PERIODS = new Set(['day', 'week', 'month', 'once']);
const ACCESS = new Set(['browser', 'api', 'both', 'none']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);

const raw = readFileSync(new URL('../catalog/sites.json', import.meta.url), 'utf8');
const catalog = JSON.parse(raw);
const problems = [];

if (!Array.isArray(catalog.sites)) problems.push('sites is not an array');
else {
  if (catalog.sites.length < 50) problems.push(`only ${catalog.sites.length} sites (need >= 50)`);
  const ids = new Set();
  catalog.sites.forEach((site, i) => {
    const at = `sites[${i}] ${site?.id ?? '?'}`;
    if (!site.id) problems.push(`${at}: missing id`);
    else if (ids.has(site.id)) problems.push(`${at}: duplicate id`);
    else ids.add(site.id);
    if (!site.name) problems.push(`${at}: missing name`);
    if (!/^https?:\/\//.test(site.url ?? '')) problems.push(`${at}: bad url`);
    if (!CATEGORIES.has(site.category)) problems.push(`${at}: bad category "${site.category}"`);
    if (!Array.isArray(site.caps) || site.caps.length === 0) problems.push(`${at}: empty caps`);
    for (const cap of site.caps ?? []) if (!CAPS.has(cap)) problems.push(`${at}: bad cap "${cap}"`);
    if (site.free !== null) {
      if (!site.free || typeof site.free.amount !== 'number' || site.free.amount <= 0) {
        problems.push(`${at}: bad free.amount`);
      }
      if (site.free && !PERIODS.has(site.free.period)) problems.push(`${at}: bad free.period`);
      if (site.free && typeof site.free.unit !== 'string') problems.push(`${at}: bad free.unit`);
    }
    if (!ACCESS.has(site.access)) problems.push(`${at}: bad access`);
    if (!CONFIDENCE.has(site.confidence)) problems.push(`${at}: bad confidence`);
  });
}

if (problems.length > 0) {
  console.error(`✗ ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const byCategory = {};
for (const site of catalog.sites) byCategory[site.category] = (byCategory[site.category] ?? 0) + 1;
const free = catalog.sites.filter((s) => s.free !== null).length;
const browser = catalog.sites.filter((s) => s.access === 'browser').length;
console.log(`✓ catalog valid: ${catalog.sites.length} sites (${free} with a free tier, ${browser} browser-driven)`);
console.log(`  ${Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join('  ')}`);
