// The AGPL families, read from files fetched by bench/fetch/fetch.mjs.
//
// Their labels are not vendored (the keys of the Nextcloud files are English UI
// strings and the files are AGPL). The label here is a plain Map and Set
// comparison of the same extracted facts, written in this file and separate
// from the kit. That is a weaker independence than the python oracles behind
// the vendored families: the extraction of facts is shared by both sides.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { newTally, scoreMirrorPair } from './vendored.mjs';

function flatten(root) {
  const out = new Map();
  const stack = [['', root]];
  while (stack.length > 0) {
    const [path, value] = stack.pop();
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of Object.keys(value)) stack.push([path === '' ? key : `${path}.${key}`, value[key]]);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

// ICU MessageFormat: {name}, {name, plural, one {...} other {...}}. Branch text is message text, not names.
function placeholdersIcu(s) {
  const names = new Set();
  const stack = [];
  for (const c of s) {
    if (c === '{') {
      const parent = stack[stack.length - 1];
      if (parent !== undefined && parent.plural && parent.commas >= 2 && parent.depthBranch === 0) {
        stack.push({ kind: 'branch', header: '', commas: 0, plural: false, depthBranch: 0 });
        parent.depthBranch = 1;
        continue;
      }
      stack.push({ kind: 'arg', header: '', commas: 0, plural: false, depthBranch: 0 });
    } else if (c === '}') {
      const frame = stack.pop();
      if (frame === undefined) continue;
      if (frame.kind === 'arg') {
        const m = /^\s*([^,\s}]+)/.exec(frame.header);
        if (m !== null) names.add(m[1]);
      } else {
        const parent = stack[stack.length - 1];
        if (parent !== undefined) parent.depthBranch = 0;
      }
    } else {
      const frame = stack[stack.length - 1];
      if (frame !== undefined && frame.kind === 'arg') {
        if (c === ',' && frame.commas < 2) {
          frame.commas += 1;
          if (frame.commas === 2) {
            const type = frame.header.split(',')[1]?.trim();
            frame.plural = type === 'plural' || type === 'select' || type === 'selectordinal';
          }
        }
        if (frame.commas < 2 || !frame.plural) frame.header += c;
      }
    }
  }
  return [...names].sort();
}

const tagsOf = (s) => [...new Set([...s.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]))].sort();
const urlsOf = (s) => [...s.matchAll(/https?:\/\/[^\s"<>)\]}]+/g)].map((m) => m[0]).sort();
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The independent label: key in neither side, in one side, or in both with different facts. */
function label(canonFacts, mirrorFacts, same) {
  const truth = { missing: [], extra: [], drift: [] };
  for (const [k, a] of canonFacts) {
    const b = mirrorFacts.get(k);
    if (b === undefined) truth.missing.push(k);
    else if (!same(a, b)) truth.drift.push(k);
  }
  for (const k of mirrorFacts.keys()) if (!canonFacts.has(k)) truth.extra.push(k);
  return truth;
}

function mastodon(report, kit, dir) {
  const id = 'fetched/compareMirror/i18n-mastodon';
  const matrix = report.matrix(id, {
    check: 'compareMirror',
    what: 'mastodon: every key of every locale file against en.json, ICU placeholder names, tag names and URLs',
    denominators: 'keys in the union of both files, summed over locale files',
  });
  const facts = (flat) => new Map([...flat].map(([k, v]) => [k, { id: k, ph: placeholdersIcu(v), tags: tagsOf(v), urls: urlsOf(v) }]));
  const canonical = facts(flatten(JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8'))));
  const same = (a, b) => sameList(a.ph, b.ph) && sameList(a.tags, b.tags) && sameList(a.urls, b.urls);
  const tally = newTally();
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json') || file === 'en.json' || file === 'defaultMessages.json') continue;
    const mirror = facts(flatten(JSON.parse(readFileSync(join(dir, file), 'utf8'))));
    const ids = new Set([...canonical.keys(), ...mirror.keys()]);
    scoreMirrorPair(matrix, tally, kit, [...canonical.values()], [...mirror.values()], { fields: ['ph', 'tags', 'urls'] }, label(canonical, mirror, same), ids);
  }
  report.note(id, 'locales', tally.pairs);
  report.note(id, 'resultStatus', tally.statuses);
}

const PLACEHOLDER = /%(?:\d+\$)?[sdnf]|\{[A-Za-z0-9_]+\}/g;

function nextcloud(report, kit, dir) {
  const id = 'fetched/compareMirror/nextcloud-l10n';
  const matrix = report.matrix(id, {
    check: 'compareMirror',
    what: 'nextcloud core translations: en_GB against every other locale, and ten pairs of regional variants; keys are the English strings, field is the set of %s, %1$s and {name} placeholders',
    denominators: 'keys in the union of both files, summed over 66 locale pairs',
  });
  const load = (loc) => {
    const raw = JSON.parse(readFileSync(join(dir, `${loc}.json`), 'utf8')).translations;
    return new Map(
      Object.entries(raw).map(([k, v]) => {
        const names = new Set();
        for (const part of Array.isArray(v) ? v : [v]) if (typeof part === 'string') for (const m of part.matchAll(PLACEHOLDER)) names.add(m[0]);
        return [k, { id: k, ph: [...names].sort() }];
      }),
    );
  };
  const locales = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  const pairs = locales.filter((l) => l !== 'en_GB').map((l) => ['en_GB', l]);
  pairs.push(['de', 'de_DE'], ['de_DE', 'de'], ['es', 'es_MX'], ['es', 'es_EC'], ['es_MX', 'es_EC'], ['pt_BR', 'pt_PT'], ['pt_PT', 'pt_BR'], ['zh_CN', 'zh_TW'], ['zh_TW', 'zh_HK'], ['zh_CN', 'zh_HK']);
  const cache = new Map();
  const get = (loc) => {
    if (!cache.has(loc)) cache.set(loc, load(loc));
    return cache.get(loc);
  };
  const same = (a, b) => sameList(a.ph, b.ph);
  const tally = newTally();
  for (const [c, m] of pairs) {
    const canonical = get(c);
    const mirror = get(m);
    const ids = new Set([...canonical.keys(), ...mirror.keys()]);
    scoreMirrorPair(matrix, tally, kit, [...canonical.values()], [...mirror.values()], { fields: ['ph'] }, label(canonical, mirror, same), ids);
  }
  report.note(id, 'localePairs', tally.pairs);
  report.note(id, 'resultStatus', tally.statuses);
  report.note(id, 'itemsInLookalikeGroups', tally.lookalikeMatchItems);
}

export function runFetched(report, kit, cache) {
  mastodon(report, kit, join(cache, 'mastodon-locales'));
  nextcloud(report, kit, join(cache, 'nextcloud-core-l10n'));
}
