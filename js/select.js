const items = new Map();
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const selection = {
  list: () => [...items.values()].sort((a, b) => a.date - b.date || a.idx - b.idx),
  has: (id) => items.has(id),
  size: () => items.size,
  toggle(item) {
    if (items.has(item.id)) {
      items.delete(item.id);
      emit();
      return null;
    }
    let swapped = null;
    for (const [k, v] of items) {
      if (v.date === item.date && v.idx === item.idx) {
        swapped = v;
        items.delete(k);
      }
    }
    items.set(item.id, item);
    emit();
    return swapped || true;
  },
  remove(id) {
    items.delete(id);
    emit();
  },
  clear() {
    items.clear();
    emit();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
