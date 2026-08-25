#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUTPUT_DIR = path.join(FRONTEND_ROOT, 'test-results', 'stress');
const VALID_AUTH_MODES = new Set(['none', 'cookie', 'e2e']);
const VALID_PROFILES = new Set(['smoke', 'dashboard', 'workshop']);

const DEFAULT_OPTIONS = Object.freeze({
  baseUrl: 'http://localhost:3000',
  auth: 'none',
  durationMs: 60_000,
  vusPerSite: 2,
  maxSites: 4,
  minSites: 2,
  pageSize: 100,
  requestTimeoutMs: 30_000,
  thinkMs: 250,
  maxErrorRate: 0.02,
  maxP95Ms: 10_000,
  profile: 'workshop',
  warmup: true,
  e2eEmail: 'e2e-workshop-stress@forestgeo.si.edu',
  e2eRole: 'global'
});

export function parseDurationMs(value, fallbackMs = undefined) {
  if (value === undefined || value === null || value === '') {
    if (fallbackMs !== undefined) return fallbackMs;
    throw new Error('Duration is required');
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid duration: ${value}`);
    return value;
  }

  const trimmed = String(value).trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!match) throw new Error(`Invalid duration: ${value}`);

  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid duration: ${value}`);

  if (unit === 'm') return Math.round(amount * 60_000);
  if (unit === 's') return Math.round(amount * 1_000);
  return Math.round(amount);
}

export function parseRate(value, fallbackRate = undefined) {
  if (value === undefined || value === null || value === '') {
    if (fallbackRate !== undefined) return fallbackRate;
    throw new Error('Rate is required');
  }

  const raw = String(value).trim();
  const isPercent = raw.endsWith('%');
  const numeric = Number(isPercent ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`Invalid rate: ${value}`);

  if (isPercent) return numeric / 100;
  return numeric > 1 ? numeric / 100 : numeric;
}

function parsePositiveInt(value, name, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseNonNegativeInt(value, name, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

export function parseSiteSpec(spec) {
  const [schema, plotIDRaw, censusIDRaw, plotCensusNumberRaw] = String(spec).split(':');
  if (!schema) throw new Error(`Invalid site spec '${spec}'. Expected schema[:plotID[:censusID[:plotCensusNumber]]]`);

  return {
    schema,
    plotID: parsePositiveInt(plotIDRaw, 'plotID'),
    censusID: parsePositiveInt(censusIDRaw, 'censusID'),
    plotCensusNumber: parsePositiveInt(plotCensusNumberRaw, 'plotCensusNumber')
  };
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function parseArgMap(args) {
  const values = new Map();
  const flags = new Set();
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const equalsIndex = arg.indexOf('=');
    if (equalsIndex !== -1) {
      const key = arg.slice(2, equalsIndex);
      const value = arg.slice(equalsIndex + 1);
      if (!values.has(key)) values.set(key, []);
      values.get(key).push(value);
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      if (!values.has(key)) values.set(key, []);
      values.get(key).push(next);
      index += 1;
    } else {
      flags.add(key);
    }
  }

  return { values, flags, positionals };
}

function getLast(values, key) {
  const items = values.get(key);
  return items?.[items.length - 1];
}

function getAll(values, key) {
  return values.get(key) ?? [];
}

function splitCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseHeaders(headerValues) {
  const headers = {};
  for (const value of headerValues) {
    const separator = value.indexOf(':');
    if (separator <= 0) throw new Error(`Invalid header '${value}'. Expected 'Name: value'.`);
    const name = value.slice(0, separator).trim();
    const headerValue = value.slice(separator + 1).trim();
    if (!name || !headerValue) throw new Error(`Invalid header '${value}'. Expected 'Name: value'.`);
    headers[name] = headerValue;
  }
  return headers;
}

function defaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(DEFAULT_OUTPUT_DIR, `workshop-stress-${stamp}.json`);
}

export function parseCliOptions(args, env = process.env) {
  const { values, flags } = parseArgMap(args);
  if (flags.has('help') || flags.has('h')) {
    return { help: true };
  }

  const auth = getLast(values, 'auth') ?? env.STRESS_AUTH ?? (env.STRESS_COOKIE ? 'cookie' : DEFAULT_OPTIONS.auth);
  if (!VALID_AUTH_MODES.has(auth)) throw new Error(`Invalid auth mode '${auth}'. Use none, cookie, or e2e.`);

  const profile = getLast(values, 'profile') ?? env.STRESS_PROFILE ?? DEFAULT_OPTIONS.profile;
  if (!VALID_PROFILES.has(profile)) throw new Error(`Invalid profile '${profile}'. Use smoke, dashboard, or workshop.`);

  const maxSites = parsePositiveInt(getLast(values, 'max-sites') ?? env.STRESS_MAX_SITES, 'max-sites', DEFAULT_OPTIONS.maxSites);
  const siteSpecs = [...getAll(values, 'site'), ...splitCsv(getLast(values, 'sites') ?? env.STRESS_SITES)].map(parseSiteSpec);

  const outputRaw = flags.has('no-output') ? undefined : (getLast(values, 'output') ?? env.STRESS_OUTPUT ?? defaultOutputPath());

  return {
    help: false,
    baseUrl: normalizeBaseUrl(getLast(values, 'base-url') ?? env.STRESS_BASE_URL ?? DEFAULT_OPTIONS.baseUrl),
    auth,
    cookie: getLast(values, 'cookie') ?? env.STRESS_COOKIE,
    headers: parseHeaders([...getAll(values, 'header'), ...splitCsv(env.STRESS_HEADERS)]),
    durationMs: parseDurationMs(getLast(values, 'duration') ?? env.STRESS_DURATION, DEFAULT_OPTIONS.durationMs),
    vusPerSite: parsePositiveInt(getLast(values, 'vus-per-site') ?? env.STRESS_VUS_PER_SITE, 'vus-per-site', DEFAULT_OPTIONS.vusPerSite),
    maxSites,
    minSites: parsePositiveInt(getLast(values, 'min-sites') ?? env.STRESS_MIN_SITES, 'min-sites', Math.min(DEFAULT_OPTIONS.minSites, maxSites)),
    pageSize: parsePositiveInt(getLast(values, 'page-size') ?? env.STRESS_PAGE_SIZE, 'page-size', DEFAULT_OPTIONS.pageSize),
    requestTimeoutMs: parseDurationMs(getLast(values, 'request-timeout') ?? env.STRESS_REQUEST_TIMEOUT, DEFAULT_OPTIONS.requestTimeoutMs),
    thinkMs: parseNonNegativeInt(getLast(values, 'think-ms') ?? env.STRESS_THINK_MS, 'think-ms', DEFAULT_OPTIONS.thinkMs),
    maxErrorRate: parseRate(getLast(values, 'max-error-rate') ?? env.STRESS_MAX_ERROR_RATE, DEFAULT_OPTIONS.maxErrorRate),
    maxP95Ms: parseDurationMs(getLast(values, 'max-p95') ?? env.STRESS_MAX_P95, DEFAULT_OPTIONS.maxP95Ms),
    profile,
    warmup: flags.has('no-warmup') ? false : parseBoolean(getLast(values, 'warmup') ?? env.STRESS_WARMUP, DEFAULT_OPTIONS.warmup),
    e2eEmail: getLast(values, 'e2e-email') ?? env.STRESS_E2E_EMAIL ?? DEFAULT_OPTIONS.e2eEmail,
    e2eRole: getLast(values, 'e2e-role') ?? env.STRESS_E2E_ROLE ?? DEFAULT_OPTIONS.e2eRole,
    scenario: getLast(values, 'scenario') ?? env.STRESS_SCENARIO,
    output: outputRaw,
    siteSpecs
  };
}

export function normalizeArrayResponse(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.output)) return body.output;
  if (Array.isArray(body?.sites)) return body.sites;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

function getNumber(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function getString(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return undefined;
}

function encodePath(value) {
  return encodeURIComponent(String(value));
}

function withQuery(pathname, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function buildStepPlan(target, options) {
  const schemaPath = encodePath(target.schema);
  const plotID = target.plotID;
  const censusID = target.censusID;
  const plotCensusNumber = target.plotCensusNumber ?? 0;
  const pageSize = options.pageSize;

  const siteSelectionSteps = [
    {
      operation: 'fetch-plots',
      method: 'GET',
      path: withQuery('/api/fetchall/plots/0/0', { schema: target.schema })
    },
    {
      operation: 'fetch-census',
      method: 'GET',
      path: withQuery(`/api/fetchall/census/${plotID}/0`, { schema: target.schema, plotID })
    }
  ];

  const dashboardStep = {
    operation: 'dashboard-metrics',
    method: 'GET',
    path: `/api/dashboardmetrics/all/${schemaPath}/${plotID}/${censusID}`
  };

  if (options.profile === 'smoke') {
    return [...siteSelectionSteps, dashboardStep];
  }

  if (options.profile === 'dashboard') {
    return [...siteSelectionSteps, dashboardStep, dashboardStep];
  }

  return [
    ...siteSelectionSteps,
    dashboardStep,
    {
      operation: 'fixeddata-species',
      method: 'GET',
      path: `/api/fixeddata/species/${schemaPath}/0/${pageSize}/${plotID}/${plotCensusNumber}`
    },
    {
      operation: 'fixeddata-viewfulltable',
      method: 'GET',
      path: `/api/fixeddata/viewfulltable/${schemaPath}/0/${pageSize}/${plotID}/${plotCensusNumber}`
    },
    {
      operation: 'errors-explorer-query',
      method: 'POST',
      path: '/api/errors/explorer/query',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema: target.schema,
        plotID,
        censusID,
        page: 0,
        pageSize: Math.min(100, pageSize),
        filters: {}
      })
    }
  ];
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}

export function summarizeSamples(samples) {
  const durations = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
  const successCount = samples.filter(sample => sample.ok).length;
  const failedCount = samples.length - successCount;
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  const statuses = {};

  for (const sample of samples) {
    const statusKey = sample.status === null ? 'network' : String(sample.status);
    statuses[statusKey] = (statuses[statusKey] ?? 0) + 1;
  }

  return {
    count: samples.length,
    successCount,
    failedCount,
    errorRate: samples.length === 0 ? 0 : failedCount / samples.length,
    minMs: durations[0] ?? 0,
    avgMs: samples.length === 0 ? 0 : totalMs / samples.length,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    maxMs: durations[durations.length - 1] ?? 0,
    statuses
  };
}

function groupBy(samples, key) {
  const grouped = new Map();
  for (const sample of samples) {
    const groupKey = sample[key];
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(sample);
  }
  return Object.fromEntries([...grouped.entries()].map(([groupKey, groupSamples]) => [groupKey, summarizeSamples(groupSamples)]));
}

export function buildReportSummary(samples) {
  return {
    overall: summarizeSamples(samples),
    bySite: groupBy(samples, 'site'),
    byOperation: groupBy(samples, 'operation')
  };
}

export function evaluateThresholds(summary, options, targetCount) {
  const failures = [];
  if (targetCount < options.minSites) {
    failures.push(`Only ${targetCount} site target(s) resolved; expected at least ${options.minSites}.`);
  }
  if (summary.overall.count === 0) {
    failures.push('No requests were recorded.');
  }
  if (summary.overall.errorRate > options.maxErrorRate) {
    failures.push(`Error rate ${formatPercent(summary.overall.errorRate)} exceeded ${formatPercent(options.maxErrorRate)}.`);
  }
  if (summary.overall.p95Ms > options.maxP95Ms) {
    failures.push(`Overall p95 ${formatMs(summary.overall.p95Ms)} exceeded ${formatMs(options.maxP95Ms)}.`);
  }
  return failures;
}

function splitSetCookieHeader(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map(item => item.trim());
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('set-cookie');
  return splitSetCookieHeader(combined);
}

class CookieJar {
  constructor(rawCookieHeader = '') {
    this.rawCookieHeader = rawCookieHeader.trim();
    this.cookies = new Map();
  }

  addFromResponse(headers) {
    for (const setCookie of getSetCookieHeaders(headers)) {
      const pair = setCookie.split(';', 1)[0];
      const equalsIndex = pair.indexOf('=');
      if (equalsIndex <= 0) continue;
      this.cookies.set(pair.slice(0, equalsIndex), pair.slice(equalsIndex + 1));
    }
  }

  header() {
    const stored = [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    return [this.rawCookieHeader, stored].filter(Boolean).join('; ');
  }
}

class StressHttpClient {
  constructor(options, cookieJar) {
    this.options = options;
    this.cookieJar = cookieJar;
  }

  url(pathname) {
    return new URL(pathname, `${this.options.baseUrl}/`).toString();
  }

  headers(extraHeaders = {}) {
    const headers = {
      'user-agent': 'forestgeo-workshop-stress/1.0',
      accept: 'application/json,text/plain,*/*',
      ...this.options.headers,
      ...extraHeaders
    };
    const cookie = this.cookieJar.header();
    if (cookie) headers.cookie = cookie;
    return headers;
  }

  async fetchText(pathname, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);

    try {
      const response = await fetch(this.url(pathname), {
        redirect: 'manual',
        ...init,
        headers: this.headers(init.headers),
        signal: controller.signal
      });
      this.cookieJar.addFromResponse(response.headers);
      const text = await response.text();
      return { response, text };
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchJson(pathname, init = {}) {
    const { response, text } = await this.fetchText(pathname, init);
    if (!response.ok) {
      throw new Error(`${init.method ?? 'GET'} ${pathname} returned HTTP ${response.status}: ${truncate(text, 240)}`);
    }
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`${init.method ?? 'GET'} ${pathname} returned non-JSON response: ${truncate(text, 240)}`);
    }
  }

  async runMeasuredStep(target, step) {
    const startedAt = performance.now();
    const startedIso = new Date().toISOString();
    let status = null;
    let ok = false;
    let bytes = 0;
    let error;

    try {
      const { response, text } = await this.fetchText(step.path, {
        method: step.method,
        headers: step.headers,
        body: step.body
      });
      status = response.status;
      ok = response.ok;
      bytes = Buffer.byteLength(text);
      if (!response.ok) {
        error = truncate(text, 300) || response.statusText || `HTTP ${response.status}`;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    return {
      site: target.schema,
      operation: step.operation,
      worker: undefined,
      status,
      ok,
      durationMs: performance.now() - startedAt,
      bytes,
      error,
      timestamp: startedIso
    };
  }
}

async function loginWithE2ECredentials(client, options) {
  const csrf = await client.fetchJson('/api/auth/csrf');
  if (!csrf?.csrfToken) throw new Error('E2E login failed: /api/auth/csrf did not return csrfToken.');

  const body = new URLSearchParams({
    email: options.e2eEmail,
    userStatus: options.e2eRole,
    csrfToken: csrf.csrfToken
  });

  const { response, text } = await client.fetchText('/api/auth/callback/e2e-credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  if (![200, 302, 303].includes(response.status)) {
    throw new Error(`E2E login failed with HTTP ${response.status}: ${truncate(text, 240)}`);
  }

  const session = await client.fetchJson('/api/auth/session');
  if (!session?.user) throw new Error('E2E login did not produce an authenticated session.');
  return session.user;
}

async function loadScenarioSites(scenarioPath) {
  if (!scenarioPath) return [];
  const resolved = path.isAbsolute(scenarioPath) ? scenarioPath : path.resolve(FRONTEND_ROOT, scenarioPath);
  const raw = await fs.readFile(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  const sites = Array.isArray(parsed) ? parsed : parsed.sites;
  if (!Array.isArray(sites)) throw new Error(`Scenario file ${resolved} must be an array or an object with a sites array.`);
  return sites.map(site => ({
    schema: site.schema ?? site.schemaName,
    plotID: site.plotID,
    censusID: site.censusID,
    plotCensusNumber: site.plotCensusNumber,
    label: site.label ?? site.siteName
  }));
}

async function discoverSiteSpecs(client, options) {
  const scenarioSites = await loadScenarioSites(options.scenario);
  if (scenarioSites.length > 0) return scenarioSites;
  if (options.siteSpecs.length > 0) return options.siteSpecs;

  const sitesBody = await client.fetchJson('/api/fetchall/sites');
  return normalizeArrayResponse(sitesBody)
    .map(site => ({
      schema: getString(site, ['schemaName', 'SchemaName', 'schema']),
      label: getString(site, ['siteName', 'SiteName', 'name'])
    }))
    .filter(site => site.schema)
    .slice(0, options.maxSites);
}

async function completeSiteTarget(client, siteSpec) {
  if (!siteSpec.schema) throw new Error('Site target is missing schema.');

  let plotID = Number(siteSpec.plotID);
  let censusID = Number(siteSpec.censusID);
  let plotCensusNumber = Number(siteSpec.plotCensusNumber);

  if (!Number.isFinite(plotID) || plotID <= 0) {
    const plotsBody = await client.fetchJson(withQuery('/api/fetchall/plots/0/0', { schema: siteSpec.schema }));
    const plots = normalizeArrayResponse(plotsBody);
    const selectedPlot = plots.find(plot => plot.isActive !== false && plot.IsActive !== false) ?? plots[0];
    plotID = getNumber(selectedPlot, ['plotID', 'PlotID']);
  }

  if (!Number.isFinite(plotID) || plotID <= 0) {
    throw new Error(`No usable plot found for ${siteSpec.schema}.`);
  }

  if (!Number.isFinite(censusID) || censusID <= 0 || !Number.isFinite(plotCensusNumber) || plotCensusNumber <= 0) {
    const censusBody = await client.fetchJson(withQuery(`/api/fetchall/census/${plotID}/0`, { schema: siteSpec.schema, plotID }));
    const censusRows = normalizeArrayResponse(censusBody)
      .map(row => ({
        censusID: getNumber(row, ['censusID', 'CensusID']),
        plotCensusNumber: getNumber(row, ['plotCensusNumber', 'PlotCensusNumber'])
      }))
      .filter(row => row.censusID && row.plotCensusNumber)
      .sort((left, right) => right.plotCensusNumber - left.plotCensusNumber || right.censusID - left.censusID);

    const selectedCensus = censusRows[0];
    if (!Number.isFinite(censusID) || censusID <= 0) censusID = selectedCensus?.censusID;
    if (!Number.isFinite(plotCensusNumber) || plotCensusNumber <= 0) plotCensusNumber = selectedCensus?.plotCensusNumber;
  }

  if (!Number.isFinite(censusID) || censusID <= 0) {
    throw new Error(`No usable census found for ${siteSpec.schema} plot ${plotID}.`);
  }

  return {
    schema: siteSpec.schema,
    label: siteSpec.label ?? siteSpec.schema,
    plotID,
    censusID,
    plotCensusNumber
  };
}

async function resolveTargets(client, options) {
  const specs = (await discoverSiteSpecs(client, options)).slice(0, options.maxSites);
  const targets = [];
  const errors = [];

  for (const spec of specs) {
    try {
      targets.push(await completeSiteTarget(client, spec));
    } catch (error) {
      errors.push(`${spec.schema ?? 'unknown'}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { targets, errors };
}

async function warmupTargets(client, targets, options) {
  await Promise.all(
    targets.map(async target => {
      for (const step of buildStepPlan(target, options)) {
        const { response, text } = await client.fetchText(step.path, {
          method: step.method,
          headers: step.headers,
          body: step.body
        });
        if (!response.ok) {
          throw new Error(`Warmup ${target.schema}/${step.operation} returned HTTP ${response.status}: ${truncate(text, 240)}`);
        }
      }
    })
  );
}

async function runStress(client, targets, options) {
  const samples = [];
  const deadline = performance.now() + options.durationMs;
  let stopRequested = false;

  const stop = () => {
    stopRequested = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const progressTimer = setInterval(() => {
    const elapsedMs = Math.max(1, options.durationMs - Math.max(0, deadline - performance.now()));
    const summary = summarizeSamples(samples);
    const rps = samples.length / (elapsedMs / 1000);
    console.log(
      `[stress] ${formatMs(elapsedMs)} elapsed, ${samples.length} requests, ${rps.toFixed(1)} rps, error ${formatPercent(summary.errorRate)}, p95 ${formatMs(summary.p95Ms)}`
    );
  }, 10_000);
  progressTimer.unref?.();

  async function worker(target, workerIndex) {
    if (options.thinkMs > 0) {
      await sleep(Math.random() * Math.min(options.thinkMs, 1000));
    }

    while (!stopRequested && performance.now() < deadline) {
      for (const step of buildStepPlan(target, options)) {
        if (stopRequested || performance.now() >= deadline) break;
        const sample = await client.runMeasuredStep(target, step);
        sample.worker = `${target.schema}#${workerIndex}`;
        samples.push(sample);
      }

      if (options.thinkMs > 0) {
        await sleep(Math.random() * options.thinkMs);
      }
    }
  }

  const workers = [];
  for (const target of targets) {
    for (let index = 0; index < options.vusPerSite; index += 1) {
      workers.push(worker(target, index + 1));
    }
  }

  try {
    await Promise.all(workers);
  } finally {
    clearInterval(progressTimer);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }

  return samples;
}

function truncate(value, maxLength) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatMs(value) {
  if (!Number.isFinite(value)) return '0ms';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatSummaryLine(summary) {
  return `count=${summary.count} ok=${summary.successCount} failed=${summary.failedCount} error=${formatPercent(summary.errorRate)} avg=${formatMs(summary.avgMs)} p50=${formatMs(summary.p50Ms)} p95=${formatMs(summary.p95Ms)} p99=${formatMs(summary.p99Ms)} max=${formatMs(summary.maxMs)}`;
}

function topErrors(samples, limit = 8) {
  const counts = new Map();
  for (const sample of samples) {
    if (sample.ok) continue;
    const key = `${sample.operation} ${sample.status ?? 'network'} ${sample.error ?? ''}`.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function printSummary(report, thresholdFailures) {
  console.log('\nOverall');
  console.log(`  ${formatSummaryLine(report.summary.overall)}`);

  console.log('\nBy site');
  for (const [site, summary] of Object.entries(report.summary.bySite)) {
    console.log(`  ${site}: ${formatSummaryLine(summary)}`);
  }

  console.log('\nBy operation');
  for (const [operation, summary] of Object.entries(report.summary.byOperation)) {
    console.log(`  ${operation}: ${formatSummaryLine(summary)}`);
  }

  const errors = topErrors(report.samples);
  if (errors.length > 0) {
    console.log('\nTop errors');
    for (const [message, count] of errors) {
      console.log(`  ${count}x ${message}`);
    }
  }

  if (thresholdFailures.length > 0) {
    console.log('\nThreshold failures');
    for (const failure of thresholdFailures) {
      console.log(`  - ${failure}`);
    }
  } else {
    console.log('\nThresholds passed');
  }
}

function redactOptions(options) {
  const redacted = { ...options, siteSpecs: options.siteSpecs };
  if (redacted.cookie) redacted.cookie = '<redacted>';
  for (const headerName of Object.keys(redacted.headers ?? {})) {
    if (/cookie|authorization/i.test(headerName)) redacted.headers[headerName] = '<redacted>';
  }
  return redacted;
}

async function writeReport(report, outputPath) {
  if (!outputPath) return undefined;
  const resolved = path.isAbsolute(outputPath) ? outputPath : path.resolve(FRONTEND_ROOT, outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return resolved;
}

function usage() {
  return `
ForestGEO workshop stress runner

Usage:
  node tests/stress/workshop-stress.mjs [options]

Common options:
  --base-url=http://localhost:3000
  --auth=none|cookie|e2e
  --cookie="name=value; other=value"
  --site=forestgeo_panama[:plotID[:censusID[:plotCensusNumber]]]
  --sites=forestgeo_panama,forestgeo_testing_mason
  --scenario=tests/stress/workshop-stress.example.json
  --duration=60s
  --vus-per-site=2
  --max-sites=4
  --min-sites=2
  --profile=smoke|dashboard|workshop
  --max-error-rate=2%
  --max-p95=10s
  --output=test-results/stress/run.json

Environment aliases use STRESS_* names, for example STRESS_BASE_URL, STRESS_COOKIE,
STRESS_AUTH, STRESS_DURATION, STRESS_VUS_PER_SITE, and STRESS_SITES.
`.trim();
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const cookieJar = new CookieJar(options.cookie);
  const client = new StressHttpClient(options, cookieJar);

  console.log(`Stress target: ${options.baseUrl}`);
  console.log(`Profile: ${options.profile}, duration: ${formatMs(options.durationMs)}, VUs/site: ${options.vusPerSite}, auth: ${options.auth}`);

  if (options.auth === 'e2e') {
    const user = await loginWithE2ECredentials(client, options);
    console.log(`Authenticated via E2E credentials as ${user.email ?? 'unknown user'} (${user.userStatus ?? 'unknown role'}).`);
  }

  const { targets, errors } = await resolveTargets(client, options);
  for (const error of errors) {
    console.warn(`[stress] skipped target: ${error}`);
  }

  if (targets.length === 0) {
    throw new Error('No stress targets resolved. Provide --site/--scenario or verify /api/fetchall/sites is available.');
  }

  console.log('\nTargets');
  for (const target of targets) {
    console.log(`  ${target.schema}: plot=${target.plotID}, census=${target.censusID}, pcn=${target.plotCensusNumber}`);
  }

  if (options.warmup) {
    console.log('\nWarming routes');
    await warmupTargets(client, targets, options);
  }

  console.log('\nRunning stress workload');
  const samples = await runStress(client, targets, options);
  const summary = buildReportSummary(samples);
  const thresholdFailures = evaluateThresholds(summary, options, targets.length);
  const report = {
    generatedAt: new Date().toISOString(),
    options: redactOptions(options),
    targets,
    summary,
    thresholdFailures,
    samples
  };

  printSummary(report, thresholdFailures);
  const outputPath = await writeReport(report, options.output);
  if (outputPath) console.log(`\nReport written to ${outputPath}`);

  if (thresholdFailures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
