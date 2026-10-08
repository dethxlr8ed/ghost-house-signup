import { DAYS, BOOTHS, WEEK_ROWS, lockFor, fmtOpen, shiftLabel, weekFor, weekdayName, monthName } from './data.js';
import { copyText } from './util.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export function openIds(ctx, boothId, date, idx) {
  const shift = ctx.layout[boothId]?.[date]?.[idx];
  if (!shift) return [];
  return shift.spots.filter((s) => s.k === 'kid' && !ctx.store.isTaken(s.id)).map((s) => s.id);
}

export function countOpen(ctx, from, to) {
  let n = 0;
  for (const b of BOOTHS)
    for (const day of DAYS) {
      if (day.date < from || day.date > to) continue;
      day.shifts.forEach((_, i) => (n += openIds(ctx, b.id, day.date, i).length));
    }
  return n;
}

export function countUnlockedOpen(ctx) {
  let n = 0;
  for (const w of ctx.release.weeks) {
    if (!lockFor(ctx.release, w.from, ctx.now, ctx.admin)) n += countOpen(ctx, w.from, w.to);
  }
  return n;
}

function campaignText(ctx) {
  const lines = ['Ghost House Games (Candlelighters) needs volunteers, Oct 10 - 30. Pick your shifts here:'];
  for (const w of ctx.release.weeks) {
    if (lockFor(ctx.release, w.from, ctx.now, ctx.admin)) continue;
    const n = countOpen(ctx, w.from, w.to);
    if (n) lines.push(`${w.label} (Oct ${w.from}-${Math.min(w.to, 30)}): ${n} spots open`);
  }
  const next = ctx.release.weeks.find((w) => lockFor(ctx.release, w.from, ctx.now, false));
  if (next) lines.push(`${next.label} opens ${fmtOpen(new Date(next.opens))}.`);
  lines.push(`${location.origin}${location.pathname}`);
  return lines.join('\n');
}

function campaignBox(ctx) {
  const box = el('div', 'campaign');
  box.append(el('h3', '', 'Campaign message (admin)'));
  const area = el('textarea');
  area.rows = 6;
  area.readOnly = true;
  area.value = campaignText(ctx);
  const btn = el('button', 'btn primary', 'Copy message');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    const ok = await copyText(area.value);
    btn.textContent = ok ? 'Copied' : 'Select and copy';
    setTimeout(() => (btn.textContent = 'Copy message'), 1800);
  });
  box.append(area, btn);
  return box;
}

function weekChips(ctx) {
  const wrap = el('div', 'weeks');
  const make = (key, label) => {
    const b = el('button', 'wk', label);
    b.type = 'button';
    if (ctx.weekFilter === key) b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', () => ctx.setWeek(key));
    wrap.append(b);
  };
  make('all', 'All weeks');
  for (const w of ctx.release.weeks) {
    const locked = lockFor(ctx.release, w.from, ctx.now, ctx.admin);
    make(String(w.from), `${w.label}${locked ? ' (soon)' : ''}`);
  }
  return wrap;
}

export function buildShiftBlock(ctx, day, idx, { lock = null, showFull = false } = {}) {
  const shift = day.shifts[idx];
  const items = [];
  const full = [];
  for (const b of BOOTHS) {
    const ids = openIds(ctx, b.id, day.date, idx);
    const label = shiftLabel(ctx.layout, b.id, day.date, idx, shift.label);
    (ids.length ? items : full).push({ booth: b, ids, label });
  }
  if (!items.length && !(showFull && full.length)) return null;
  const sec = el('div', 'oshift');
  sec.append(el('h4', '', `${shift.label} PM`));
  const list = el('ul', 'olist');
  for (const it of items) {
    const li = el('li');
    const picked = !lock && it.ids.find((id) => ctx.selection.has(id));
    const btn = el('button', `orow${picked ? ' picked' : ''}${lock ? ' locked' : ''}`);
    btn.type = 'button';
    btn.append(el('span', 'oname', it.booth.name));
    if (it.label !== shift.label) btn.append(el('span', 'otime', `${it.label} PM`));
    btn.append(el('span', 'ocount', lock ? `${it.ids.length} soon` : picked ? 'Selected' : `${it.ids.length} open`));
    btn.addEventListener('click', () => (lock ? ctx.onLocked(lock) : ctx.onPickShift({ booth: it.booth, day, idx, ids: it.ids, picked })));
    li.append(btn);
    list.append(li);
  }
  sec.append(list);
  if (showFull && full.length) sec.append(el('p', 'ofull', `Full: ${full.map((f) => f.booth.name).join(', ')}`));
  return sec;
}

export function renderOpen(root, ctx) {
  root.replaceChildren();
  const page = el('section', 'open-page');
  const head = el('div', 'open-head');
  head.append(el('h2', '', 'Open spots'), el('p', '', 'Soonest first. Tap shifts to select them, then continue.'));
  page.append(head, weekChips(ctx));
  if (ctx.admin) page.append(campaignBox(ctx));

  let shown = 0;
  const lockedShown = new Set();
  for (const day of DAYS) {
    if (day.closed) continue;
    const week = weekFor(ctx.release, day.date);
    if (ctx.weekFilter !== 'all' && String(week.from) !== ctx.weekFilter) continue;
    const lock = lockFor(ctx.release, day.date, ctx.now, ctx.admin);
    if (lock) {
      if (!lockedShown.has(week.from)) {
        lockedShown.add(week.from);
        const card = el('article', 'olock');
        card.append(el('b', '', `${week.label} · Oct ${week.from}-${Math.min(week.to, 30)}`));
        card.append(el('span', '', `Opens ${fmtOpen(lock.opens)} at ${lock.opens.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. ${countOpen(ctx, week.from, week.to)} spots will open.`));
        page.append(card);
      }
      continue;
    }

    const blocks = day.shifts.map((_, idx) => buildShiftBlock(ctx, day, idx)).filter(Boolean);
    if (!blocks.length) continue;
    shown++;

    const card = el('article', 'oday');
    const h = el('h3', '');
    h.append(`${weekdayName(day.date).slice(0, 3)}, ${monthName(day.date).slice(0, 3)} ${day.date}`);
    day.between.concat(day.bottom).forEach((n) => h.append(el('small', '', n)));
    card.append(h);
    blocks.forEach((blk) => card.append(blk));
    page.append(card);
  }

  if (!shown && !lockedShown.size) page.append(el('p', 'empty', 'Nothing open in this view right now. Check back soon.'));
  root.append(page);
}
