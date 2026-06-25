// Shared helpers for the asset pipeline. Node 22+, no deps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');
export const ASSETS = path.join(ROOT, 'game/public/assets');

export function loadEnv() {
  const envPath = path.join(ROOT, 'fal-agent/.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
    }
  }
  return process.env;
}

export const MESHY_KEY = 'msy_aVQigKOV7L6IXK9oqi1PklYACTGWSICsmzFv';

export function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

export async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url.slice(0, 120)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  log('saved', path.relative(ROOT, dest), `${(buf.length / 1024).toFixed(0)}kB`);
  return dest;
}

// ---- fal.ai queue API ----
export async function falQueue(endpoint, payload, { pollMs = 4000, timeoutMs = 600000 } = {}) {
  const key = loadEnv().FAL_KEY;
  if (!key) throw new Error('FAL_KEY missing');
  const auth = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  const submit = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST', headers: auth, body: JSON.stringify(payload),
  });
  const sub = await submit.json();
  if (!submit.ok) throw new Error(`fal submit ${submit.status}: ${JSON.stringify(sub).slice(0, 300)}`);
  const statusUrl = sub.status_url, responseUrl = sub.response_url;
  log('fal queued', endpoint, sub.request_id);
  const start = Date.now();
  for (;;) {
    await sleep(pollMs);
    const st = await (await fetch(statusUrl, { headers: auth })).json();
    if (st.status === 'COMPLETED') break;
    if (st.status === 'FAILED' || Date.now() - start > timeoutMs) {
      throw new Error(`fal ${endpoint} ${st.status || 'TIMEOUT'}: ${JSON.stringify(st).slice(0, 300)}`);
    }
  }
  return await (await fetch(responseUrl, { headers: auth })).json();
}

// Find the first URL-ish string in a nested response matching given extensions.
export function findUrl(obj, exts) {
  const re = new RegExp(`\\.(${exts.join('|')})(\\?|$)`, 'i');
  const stack = [obj];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string' && v.startsWith('http') && (re.test(v) || exts.length === 0)) return v;
    if (v && typeof v === 'object') stack.push(...Object.values(v));
  }
  return null;
}

// ---- Meshy API ----
export async function meshyPost(pathname, payload) {
  const res = await fetch(`https://api.meshy.ai${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MESHY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`meshy ${pathname} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

export async function meshyWait(pathname, id, { pollMs = 8000, timeoutMs = 1500000 } = {}) {
  const start = Date.now();
  for (;;) {
    await sleep(pollMs);
    const res = await fetch(`https://api.meshy.ai${pathname}/${id}`, {
      headers: { Authorization: `Bearer ${MESHY_KEY}` },
    });
    const task = await res.json();
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`meshy task ${id} ${task.status}: ${JSON.stringify(task.task_error || {}).slice(0, 300)}`);
    }
    if (Date.now() - start > timeoutMs) throw new Error(`meshy task ${id} timeout`);
    log('meshy', id.slice(0, 8), task.status, `${task.progress ?? 0}%`);
  }
}

export function updateManifest(patch) {
  const file = path.join(ASSETS, 'manifest.json');
  fs.mkdirSync(ASSETS, { recursive: true });
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const merged = { ...cur, ...patch };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  log('manifest updated:', Object.keys(patch).join(', '));
}
