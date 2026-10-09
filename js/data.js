export const EVENT = {
  title: 'Ghost House Games',
  year: 2026,
  month: 10,
  first: 10,
  last: 31,
};

const CLOSED = new Set([12, 19, 31]);

const NOTES = {
  10: { between: ['Opening Day'] },
  17: { between: ['Costume Parade 1PM', 'Lights on Tour 2 - 3PM'] },
  30: { bottom: ['Closing Night'] },
  31: { halloween: true },
};

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${EVENT.year}-${pad(EVENT.month)}-${pad(d)}`;
export const weekday = (d) => new Date(EVENT.year, EVENT.month - 1, d).getDay();

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayName = (d) => WEEKDAY_NAMES[weekday(d)];
export const monthName = (d) => new Date(EVENT.year, EVENT.month - 1, d).toLocaleString('en-US', { month: 'long' });

function shiftTimes(d) {
  const wd = weekday(d);
  if (CLOSED.has(d)) return [];
  if (wd === 6) return [[d === 17 ? '1:45' : '2:45', '6:30'], ['6:15', '10:15']];
  if (wd === 0) return [['2:45', '6:00'], ['5:45', '9:15']];
  if (wd === 5 && d !== 30) return [['5:45', '10:15']];
  return [['5:45', '9:15']];
}

const to24 = (t, pm = true) => {
  const [h, m] = t.split(':').map(Number);
  return pad(h < 12 && pm ? h + 12 : h) + pad(m);
};

export function shiftsFor(d) {
  return shiftTimes(d).map(([s, e]) => ({
    id: to24(s),
    start: s,
    end: e,
    label: `${s} - ${e}`,
  }));
}

export const DAYS = Array.from({ length: EVENT.last - EVENT.first + 1 }, (_, i) => {
  const date = EVENT.first + i;
  const note = NOTES[date] || {};
  return {
    date,
    iso: isoDate(date),
    weekday: weekday(date),
    closed: CLOSED.has(date),
    halloween: !!note.halloween,
    between: note.between || [],
    bottom: note.bottom || [],
    shifts: shiftsFor(date),
  };
});

export const WEEK_ROWS = (() => {
  const rows = [];
  let row = [];
  for (const day of DAYS) {
    row.push(day);
    if (day.weekday === 6) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  return rows;
})();

export const BOARDS = ['purple', 'lime', 'yellow'];

export const BOOTHS = [
  { id: 'ring-toss', name: 'Ring Toss', logo: 'ring-toss.webp' },
  { id: 'pumpkin-walk', name: 'Pumpkin Walk', logo: 'pumpkin-walk.webp' },
  { id: 'wheel-of-fortune', name: 'Wheel of Fortune' },
  { id: 'lollipops', name: 'Lollipops', logo: 'lollipops.webp' },
  { id: 'basket-toss', name: 'Basket Toss', logo: 'basket-toss.webp' },
  { id: 'mini-golf', name: 'Mini Golf' },
  { id: 'bean-bag-toss', name: 'Bean Bag Toss', logo: 'bean-bag-toss.webp' },
  { id: 'witches-hats', name: 'Witches Hats', logo: 'witches-hats.webp' },
  { id: 'ducks-of-doom', name: 'Ducks of Doom' },
  { id: 'lucky-drop', name: 'Lucky Drop', logo: 'lucky-drop.webp' },
  { id: 'on-a-roll', name: 'On a Roll' },
  { id: 'treasure-chest-1', name: 'Treasure Chest 1', logo: 'treasure-chest-1.webp' },
  { id: 'treasure-chest-2', name: 'Treasure Chest 2', logo: 'treasure-chest-2.webp' },
].map((b, i) => ({ ...b, board: BOARDS[i % BOARDS.length] }));

export const boothById = (id) => BOOTHS.find((b) => b.id === id);

export async function loadLayout() {
  const res = await fetch('data/slots.json');
  return (await res.json()).booths;
}

export async function loadPrivate() {
  try {
    const res = await fetch('data/private.local.json');
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

export const CONFIG = {
  liabilityUrl: 'assets/liability-form.pdf',
  siteName: 'Ghost House Games',
};

export async function loadRelease() {
  const res = await fetch('data/release.json');
  return res.json();
}

export const weekFor = (release, date) => release.weeks.find((w) => date >= w.from && date <= w.to);

export function lockFor(release, date, now, admin) {
  const week = weekFor(release, date);
  if (!week || admin) return null;
  const opens = new Date(week.opens);
  return now >= opens ? null : { week, opens };
}

export const fmtOpen = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export const shiftLabel = (layout, boothId, date, idx, fallback) => layout[boothId]?.[date]?.[idx]?.lb || fallback;

export const dayByDate = (date) => DAYS.find((d) => d.date === date);

export function daysTag(now) {
  const open = new Date(EVENT.year, EVENT.month - 1, EVENT.first);
  const close = new Date(EVENT.year, EVENT.month - 1, EVENT.last);
  const day = 86400000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (today < open) {
    const n = Math.round((open - today) / day);
    return { n, text: n === 1 ? 'more day!' : 'more days!' };
  }
  if (today < close) {
    const n = Math.round((close - today) / day);
    return { n, text: n === 1 ? 'day left!' : 'days left!' };
  }
  return null;
}
