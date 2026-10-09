const KEY = 'ghg2026.edits.v1';
const ADMIN_KEY_STORAGE = 'ghg2026.adminKey';

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

async function probeApi() {
  try {
    const res = await fetch('api/state', { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export const adminKeyStore = {
  get: () => {
    try {
      return localStorage.getItem(ADMIN_KEY_STORAGE) || '';
    } catch {
      return '';
    }
  },
  set: (v) => {
    try {
      v ? localStorage.setItem(ADMIN_KEY_STORAGE, v) : localStorage.removeItem(ADMIN_KEY_STORAGE);
    } catch {}
  },
};

export async function createStore({ taken, people = {} }) {
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const initial = await probeApi();
  const remote = !!initial;

  const edits = remote ? {} : readSaved();
  let srvTaken = new Set(initial?.taken || []);
  let srvFree = new Set(initial?.free || []);
  let adminPeople = people;

  const save = () => {
    if (remote) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(edits));
    } catch {}
  };

  const isTaken = (id) => {
    if (remote) return srvFree.has(id) ? false : srvTaken.has(id) || taken.has(id);
    return id in edits ? !!edits[id] : taken.has(id);
  };

  const get = (id) => {
    if (!remote && id in edits) return edits[id];
    if (adminPeople[id] && (isTaken(id) || id.includes('_cl'))) return { ...adminPeople[id] };
    return isTaken(id) ? { name: null } : null;
  };

  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

  const store = {
    remote,
    adminSignedIn: false,
    adminError: '',
    adminClaims: 0,
    get,
    isTaken,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async refresh() {
      if (!remote) return;
      const state = await probeApi();
      if (!state) return;
      const t = new Set(state.taken);
      const f = new Set(state.free);
      if (sameSet(t, srvTaken) && sameSet(f, srvFree)) return;
      srvTaken = t;
      srvFree = f;
      emit();
    },
    async claimMany(ids, person) {
      if (!remote) {
        const done = [];
        const lost = [];
        for (const id of ids) {
          if (isTaken(id)) {
            lost.push(id);
            continue;
          }
          edits[id] = { ...person, source: 'online', at: new Date().toISOString() };
          done.push(id);
        }
        save();
        emit();
        return { done, lost, locked: [] };
      }
      const res = await fetch('api/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: ids, person }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not reach the server. Please try again.');
      for (const id of body.done || []) srvTaken.add(id);
      for (const id of body.lost || []) srvTaken.add(id);
      emit();
      store.refresh();
      return { done: body.done || [], lost: body.lost || [], locked: body.locked || [] };
    },
    async set(id, person) {
      if (!remote) {
        edits[id] = person ? { ...person, source: 'admin', at: new Date().toISOString() } : null;
        save();
        emit();
        return { ok: true };
      }
      const res = await fetch('api/admin/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-key': adminKeyStore.get() },
        body: JSON.stringify({ slotId: id, person }),
      });
      if (!res.ok) throw new Error('Admin action failed');
      if (person) {
        srvFree.delete(id);
        srvTaken.add(id);
        adminPeople = { ...adminPeople, [id]: person };
      } else {
        srvTaken.delete(id);
        srvFree.add(id);
        const { [id]: _gone, ...rest } = adminPeople;
        adminPeople = rest;
      }
      emit();
      return { ok: true };
    },
    async loadAdmin() {
      if (!remote) return true;
      const key = adminKeyStore.get();
      if (!key) return false;
      const res = await fetch('api/admin/claims', { headers: { 'x-admin-key': key }, cache: 'no-store' });
      if (!res.ok) {
        const info = await res.json().catch(() => ({}));
        store.adminError = info.code || `http-${res.status}`;
        return false;
      }
      store.adminError = '';
      const { claims } = await res.json();
      store.adminSignedIn = true;
      store.adminClaims = claims.length;
      const map = { ...people };
      for (const c of claims) map[c.slot_id] = { name: c.name, phone: c.phone, email: c.email, minor: !!c.minor, source: c.source };
      adminPeople = map;
      emit();
      return true;
    },
  };
  return store;
}
