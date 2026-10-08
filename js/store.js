const KEY = 'ghg2026.edits.v1';

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function createStore({ taken, people = {} }) {
  const edits = readSaved();
  const listeners = new Set();

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(edits));
    } catch {}
  };
  const emit = () => listeners.forEach((fn) => fn());

  const get = (id) => {
    if (id in edits) return edits[id];
    if (taken.has(id)) return { name: people[id]?.name ?? null, ...people[id] };
    return people[id] ? { ...people[id] } : null;
  };

  return {
    get,
    isTaken: (id) => (id in edits ? !!edits[id] : taken.has(id)),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async claim(id, person) {
      if (id in edits ? edits[id] : taken.has(id)) return { ok: false, reason: 'taken' };
      edits[id] = { ...person, source: 'online', at: new Date().toISOString() };
      save();
      emit();
      return { ok: true };
    },
    async set(id, person) {
      edits[id] = person ? { ...person, source: 'admin', at: new Date().toISOString() } : null;
      save();
      emit();
      return { ok: true };
    },
  };
}
