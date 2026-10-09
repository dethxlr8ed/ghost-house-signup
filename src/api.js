const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });

const BOOTH_NAMES = {
  'ring-toss': 'Ring Toss',
  'pumpkin-walk': 'Pumpkin Walk',
  'wheel-of-fortune': 'Wheel of Fortune',
  lollipops: 'Lollipops',
  'basket-toss': 'Basket Toss',
  'mini-golf': 'Mini Golf',
  'bean-bag-toss': 'Bean Bag Toss',
  'witches-hats': 'Witches Hats',
  'ducks-of-doom': 'Ducks of Doom',
  'lucky-drop': 'Lucky Drop',
  'on-a-roll': 'On a Roll',
  'treasure-chest-1': 'Treasure Chest 1',
  'treasure-chest-2': 'Treasure Chest 2',
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS edits (
    slot_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    name TEXT, phone TEXT, email TEXT,
    minor INTEGER DEFAULT 0, grade TEXT, ec_name TEXT, ec_phone TEXT,
    school TEXT, source TEXT, at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS paper (
    slot_id TEXT PRIMARY KEY,
    name TEXT, phone TEXT, email TEXT, src TEXT, uncertain INTEGER DEFAULT 0, note TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT, action TEXT, slot_id TEXT, who TEXT, detail TEXT
  )`,
];

const CLAIM_SQL = `INSERT INTO edits (slot_id, status, name, phone, email, minor, grade, ec_name, ec_phone, school, source, at)
  VALUES (?, 'taken', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(slot_id) DO UPDATE SET status = 'taken', name = excluded.name, phone = excluded.phone, email = excluded.email,
    minor = excluded.minor, grade = excluded.grade, ec_name = excluded.ec_name, ec_phone = excluded.ec_phone,
    school = excluded.school, source = excluded.source, at = excluded.at
  WHERE edits.status = 'free'`;

const FORCE_SQL = CLAIM_SQL.replace("WHERE edits.status = 'free'", '');

const FREE_SQL = `INSERT INTO edits (slot_id, status, at) VALUES (?, 'free', ?)
  ON CONFLICT(slot_id) DO UPDATE SET status = 'free', name = NULL, phone = NULL, email = NULL, minor = 0,
    grade = NULL, ec_name = NULL, ec_phone = NULL, school = NULL, source = 'admin', at = excluded.at`;

let schemaReady = false;
let indexCache = null;
let indexFor = null;

async function ensureSchema(db) {
  if (schemaReady) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  schemaReady = true;
}

function buildIndex(slots) {
  if (indexCache && indexFor === slots) return indexCache;
  const kid = new Map();
  const cl = new Set();
  for (const [booth, days] of Object.entries(slots.booths)) {
    for (const [date, shifts] of Object.entries(days)) {
      shifts.forEach((sh, idx) => {
        for (const sp of sh.spots) {
          if (sp.k === 'cl') cl.add(sp.id);
          if (sp.k === 'kid') kid.set(sp.id, { booth, date: Number(date), idx, shiftId: sh.id, label: sh.lb || null, base: sp.t === 1, n: sp.n });
        }
      });
    }
  }
  kid.cl = cl;
  indexCache = kid;
  indexFor = slots;
  return kid;
}

function weekLock(release, date, now) {
  const week = release.weeks.find((w) => date >= w.from && date <= w.to);
  if (!week) return null;
  const opens = new Date(week.opens);
  return now >= opens ? null : { week: week.label, opens: opens.toISOString() };
}

const digits = (s) => String(s || '').replace(/\D/g, '');
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

function cleanPerson(p) {
  if (!p || typeof p !== 'object') return { error: 'Missing details.' };
  const name = clip(p.name, 80);
  const phone = clip(p.phone, 30);
  const email = clip(p.email, 120);
  if (name.length < 2) return { error: 'Please enter your name.' };
  if (!phone && !email) return { error: 'Please add a phone number or an email.' };
  if (phone && digits(phone).length < 7) return { error: 'That phone number looks too short.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email does not look right.' };
  const minor = p.minor === true || p.minor === 1;
  const out = { name, phone, email, minor: minor ? 1 : 0, school: clip(p.school, 80), grade: '', ecName: '', ecPhone: '' };
  if (minor) {
    out.grade = clip(p.grade, 20);
    out.ecName = clip(p.emergencyName, 80);
    out.ecPhone = clip(p.emergencyPhone, 30);
    if (!out.grade || !out.ecName || digits(out.ecPhone).length < 7) return { error: 'Volunteers under 18 need a grade and an emergency contact name and phone.' };
  }
  return { person: out };
}

async function readJson(request, limit = 16000) {
  const text = await request.text();
  if (text.length > limit) throw new Error('too large');
  return JSON.parse(text || '{}');
}

async function loadState(db) {
  const { results } = await db.prepare('SELECT slot_id, status FROM edits').all();
  const taken = [];
  const free = [];
  for (const r of results || []) (r.status === 'taken' ? taken : free).push(r.slot_id);
  return { taken, free };
}

async function ownedBy(db, slotId, person) {
  const { results } = await db.prepare('SELECT status, name, phone, email FROM edits WHERE slot_id = ?').bind(slotId).all();
  const row = results && results[0];
  if (!row || row.status !== 'taken') return false;
  const sameName = String(row.name || '').trim().toLowerCase() === person.name.trim().toLowerCase();
  const samePhone = person.phone && digits(row.phone) === digits(person.phone);
  const sameEmail = person.email && String(row.email || '').toLowerCase() === person.email.toLowerCase();
  return sameName && Boolean(samePhone || sameEmail);
}

const STATE_KEY = 'https://cache.ghost-house.internal/api-state';

async function invalidateState() {
  if (typeof caches === 'undefined') return;
  try {
    await caches.default.delete(new Request(STATE_KEY));
  } catch {}
}

async function stateResponse(env, now) {
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const key = new Request(STATE_KEY);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { headers: HEADERS });
  }
  const body = JSON.stringify({ ...(await loadState(env.DB)), at: now.toISOString() });
  if (cache) {
    try {
      await cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=5' } }));
    } catch {}
  }
  return new Response(body, { headers: HEADERS });
}

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const ax = new Uint8Array(x);
  const by = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i] ^ by[i];
  return diff === 0;
}

async function isAdmin(request, env) {
  const key = request.headers.get('x-admin-key') || '';
  return Boolean(env.ADMIN_KEY) && key.length > 0 && (await sameSecret(key, env.ADMIN_KEY));
}

function personBinds(slotId, person, source, at) {
  return [slotId, person.name, person.phone, person.email, person.minor, person.grade, person.ecName, person.ecPhone, person.school, source, at];
}

async function claim(request, env, data, now) {
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
  const ids = [...new Set(Array.isArray(body.items) ? body.items.map(String) : [])].slice(0, 40);
  if (!ids.length) return json({ error: 'Pick at least one shift.' }, 400);
  if (body.person && body.person.website) return json({ ok: true, done: ids, lost: [], locked: [] });
  const checked = cleanPerson(body.person);
  if (checked.error) return json({ error: checked.error }, 400);

  const index = buildIndex(data.slots);
  const state = await loadState(env.DB);
  const taken = new Set(state.taken);
  const free = new Set(state.free);
  const at = now.toISOString();
  const done = [];
  const fresh = [];
  const lost = [];
  const locked = [];
  const invalid = [];

  for (const id of ids) {
    const info = index.get(id);
    if (!info) {
      invalid.push(id);
      continue;
    }
    const lock = weekLock(data.release, info.date, now);
    if (lock) {
      locked.push({ id, week: lock.week, opens: lock.opens });
      continue;
    }
    if (taken.has(id)) {
      (await ownedBy(env.DB, id, checked.person) ? done : lost).push(id);
      continue;
    }
    if (info.base && !free.has(id)) {
      lost.push(id);
      continue;
    }
    const res = await env.DB.prepare(CLAIM_SQL).bind(...personBinds(id, checked.person, 'online', at)).run();
    if (res.meta.changes === 1) {
      done.push(id);
      fresh.push(id);
    } else {
      (await ownedBy(env.DB, id, checked.person) ? done : lost).push(id);
    }
  }

  if (fresh.length) {
    await env.DB.batch(
      fresh.map((id) => env.DB.prepare('INSERT INTO log (at, action, slot_id, who, detail) VALUES (?, ?, ?, ?, ?)').bind(at, 'claim', id, checked.person.name, checked.person.phone || checked.person.email)),
    );
  }
  return json({ ok: true, done, lost, locked, invalid });
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function whenOf(info) {
  if (info.label) return info.label.split(' ')[0];
  const h = Number(info.shiftId.slice(0, 2));
  return `${h % 12 || 12}:${info.shiftId.slice(2)}`;
}

async function adminRoutes(request, env, data, now, path) {
  if (path === '/api/admin/claims' && request.method === 'GET') {
    const { results } = await env.DB.prepare("SELECT * FROM edits WHERE status = 'taken' ORDER BY at").all();
    return json({ claims: results || [] });
  }
  if (path === '/api/admin/set' && request.method === 'POST') {
    let body;
    try {
      body = await readJson(request);
    } catch {
      return json({ error: 'Bad request.' }, 400);
    }
    const id = String(body.slotId || '');
    const index = buildIndex(data.slots);
    if (!index.has(id)) return json({ error: 'Unknown spot.' }, 400);
    const at = now.toISOString();
    if (body.person) {
      const person = { name: clip(body.person.name, 80) || 'Filled', phone: clip(body.person.phone, 30), email: '', minor: 0, grade: '', ecName: '', ecPhone: '', school: '' };
      await env.DB.prepare(FORCE_SQL).bind(...personBinds(id, person, 'admin', at)).run();
      await env.DB.prepare('INSERT INTO log (at, action, slot_id, who, detail) VALUES (?, ?, ?, ?, ?)').bind(at, 'admin-set', id, person.name, '').run();
    } else {
      await env.DB.prepare(FREE_SQL).bind(id, at).run();
      await env.DB.prepare('INSERT INTO log (at, action, slot_id, who, detail) VALUES (?, ?, ?, ?, ?)').bind(at, 'admin-free', id, '', '').run();
    }
    return json({ ok: true });
  }
  if (path === '/api/admin/roster' && request.method === 'GET') {
    const online = await env.DB.prepare("SELECT * FROM edits WHERE status = 'taken' ORDER BY at").all();
    const freed = await env.DB.prepare("SELECT slot_id FROM edits WHERE status = 'free'").all();
    const paper = await env.DB.prepare('SELECT * FROM paper').all();
    return json({ online: online.results || [], freed: (freed.results || []).map((r) => r.slot_id), paper: paper.results || [] });
  }
  if (path === '/api/admin/import' && request.method === 'POST') {
    let body;
    try {
      body = await readJson(request, 600000);
    } catch {
      return json({ error: 'That file is too large or not valid.' }, 400);
    }
    const index = buildIndex(data.slots);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length > 3000) return json({ error: 'Too many rows.' }, 400);
    const good = [];
    let skipped = 0;
    for (const r of rows) {
      const id = String(r.slotId || '');
      if (!(index.has(id) || index.cl.has(id)) || !clip(r.name, 80)) {
        skipped++;
        continue;
      }
      good.push(env.DB.prepare('INSERT OR REPLACE INTO paper (slot_id, name, phone, email, src, uncertain, note) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, clip(r.name, 80), clip(r.phone, 30), clip(r.email, 120), clip(r.src, 20), r.uncertain ? 1 : 0, clip(r.note, 200)));
    }
    if (body.replace !== false) await env.DB.prepare('DELETE FROM paper').run();
    for (let i = 0; i < good.length; i += 50) await env.DB.batch(good.slice(i, i + 50));
    await env.DB.prepare('INSERT INTO log (at, action, slot_id, who, detail) VALUES (?, ?, ?, ?, ?)').bind(now.toISOString(), 'import-paper', '', 'admin', `${good.length} rows, ${skipped} skipped`).run();
    return json({ ok: true, imported: good.length, skipped });
  }
  if (path === '/api/admin/export.csv' && request.method === 'GET') {
    const index = buildIndex(data.slots);
    const { results } = await env.DB.prepare("SELECT * FROM edits WHERE status = 'taken' ORDER BY slot_id").all();
    const head = ['booth', 'date', 'start', 'spot', 'name', 'phone', 'email', 'under18', 'grade', 'emergency_name', 'emergency_phone', 'school', 'source', 'claimed_at'];
    const lines = [head.join(',')];
    for (const r of results || []) {
      const info = index.get(r.slot_id);
      if (!info) continue;
      lines.push([BOOTH_NAMES[info.booth] || info.booth, `Oct ${info.date}`, whenOf(info), info.n, r.name, r.phone, r.email, r.minor ? 'yes' : 'no', r.grade, r.ec_name, r.ec_phone, r.school, r.source, r.at].map(csvCell).join(','));
    }
    return new Response(lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="ghost-house-signups.csv"', 'cache-control': 'no-store' } });
  }
  return json({ error: 'Not found.' }, 404);
}

export async function handle(request, env, data, now = new Date()) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });

  const origin = request.headers.get('origin');
  if (request.method !== 'GET' && origin && new URL(origin).host !== url.host) return json({ error: 'Forbidden.' }, 403);

  try {
    await ensureSchema(env.DB);
    if (path === '/api/state' && request.method === 'GET') return await stateResponse(env, now);
    if (path === '/api/claim' && request.method === 'POST') {
      const res = await claim(request, env, data, now);
      await invalidateState();
      return res;
    }
    if (path.startsWith('/api/admin/')) {
      if (!env.ADMIN_KEY) return json({ error: 'The admin key is not set on the server yet.', code: 'no-key' }, 503);
      if (!(await isAdmin(request, env))) return json({ error: 'That key does not match.', code: 'wrong-key' }, 401);
      const res = await adminRoutes(request, env, data, now, path);
      if (request.method === 'POST') await invalidateState();
      return res;
    }
    return json({ error: 'Not found.' }, 404);
  } catch (err) {
    console.error('api error', err && err.message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
