import { WEEK_ROWS, BOOTHS, lockFor, shiftLabel } from './data.js';
import { openIds } from './openview.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export function spotView(ctx, day, idx, spot, lock) {
  const { store, selection, booth, layout, admin } = ctx;
  const person = store.get(spot.id);
  const senior = spot.k === 'cl';
  const taken = senior ? !!person : store.isTaken(spot.id);
  let state = 'open';
  if (senior) state = 'senior';
  else if (taken) state = 'taken';
  else if (lock) state = 'locked';
  else if (selection.has(spot.id)) state = 'selected';
  const shift = day.shifts[idx];
  return {
    id: spot.id,
    state,
    person,
    lock,
    admin,
    booth,
    day,
    idx,
    shift,
    label: shiftLabel(layout, booth.id, day.date, idx, shift.label),
    spot: { label: senior ? 'CL' : spot.n, senior },
  };
}

function ariaFor(v) {
  const base = `${v.booth.name}, October ${v.day.date}, ${v.label}, spot ${v.spot.label}`;
  const names = { open: 'open, tap to select', selected: 'selected', locked: 'not open yet', taken: 'taken', senior: 'Candlelighters spot' };
  return `${base}: ${names[v.state]}`;
}

function spotRow(v, onPick) {
  const row = el('li', `spot ${v.state}`);
  row.append(el('span', 'spot-n', v.spot.label));
  const interactive = v.admin || v.state === 'open' || v.state === 'selected' || v.state === 'locked';
  const btn = el(interactive ? 'button' : 'div', 'spot-bar');
  if (interactive) {
    btn.type = 'button';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(v);
    });
  }
  btn.setAttribute('aria-label', ariaFor(v));
  const who = v.admin ? v.person?.name : null;
  if (v.state === 'open') btn.append(el('span', 'spot-cta', 'Tap to sign up'));
  else if (v.state === 'selected') btn.append(el('span', 'spot-cta', 'Selected'));
  else if (v.state === 'locked') btn.append(el('span', 'spot-cta', 'Opens soon'));
  else if (v.state === 'taken') btn.append(el('span', 'spot-name', who || 'Taken'));
  else if (who) btn.append(el('span', 'spot-name', who));
  row.append(btn);
  return row;
}

function fullShift(ctx, day, idx, lock) {
  const sec = el('section', 'shift');
  const head = el('div', 'shift-head');
  if (idx === 0) head.append(el('b', 'num', day.date));
  head.append(el('span', 'time', shiftLabel(ctx.layout, ctx.booth.id, day.date, idx, day.shifts[idx].label)));
  sec.append(head);
  const list = el('ul', 'spots');
  for (const spot of ctx.layout[ctx.booth.id]?.[day.date]?.[idx]?.spots || []) {
    list.append(spotRow(spotView(ctx, day, idx, spot, lock), ctx.onPick));
  }
  sec.append(list);
  return sec;
}

function miniShift(ctx, day, idx, lock) {
  const sec = el('div', 'mini-shift');
  const label = shiftLabel(ctx.layout, ctx.booth.id, day.date, idx, day.shifts[idx].label);
  sec.append(el('span', 'mini-time', label.split(' ')[0]));
  const dots = el('div', 'dots');
  for (const spot of ctx.layout[ctx.booth.id]?.[day.date]?.[idx]?.spots || []) {
    dots.append(el('i', `dot ${spotView(ctx, day, idx, spot, lock).state}`));
  }
  sec.append(dots);
  return sec;
}

function specialDay(cell, day) {
  if (day.halloween) {
    cell.append(el('b', 'num', day.date));
    const art = el('img', 'pumpkin');
    art.src = 'assets/pumpkin.webp';
    art.alt = '';
    cell.append(art, el('div', 'banner', 'Happy Halloween'), el('div', 'closed-tag', 'Closed'));
    return true;
  }
  if (day.closed) {
    cell.append(el('b', 'num', day.date), el('div', 'closed-tag', 'Closed'));
    return true;
  }
  return false;
}

function heat(n) {
  return n === 0 ? 0 : n <= 3 ? 1 : n <= 7 ? 2 : 3;
}

function masterCell(ctx, day) {
  const cell = el('div', 'day');
  cell.dataset.date = day.date;
  if (day.closed) cell.classList.add('closed');
  if (specialDay(cell, day)) return cell;

  const lock = lockFor(ctx.release, day.date, ctx.now, ctx.admin);
  if (lock) cell.classList.add('locked');
  const box = el('div', 'mday');
  box.append(el('b', 'num', day.date));
  day.shifts.forEach((shift, idx) => {
    const perBooth = BOOTHS.map((b) => openIds(ctx, b.id, day.date, idx).length);
    const total = perBooth.reduce((a, n) => a + n, 0);
    const sh = el('div', `mshift h${heat(total)}${lock ? ' soon' : ''}`);
    const top = el('div', 'mshift-top');
    top.append(el('span', 'mtime', shift.label.split(' ')[0]), el('b', 'mcount', total));
    sh.append(top);
    const dots = el('div', 'mdots');
    BOOTHS.forEach((b, i) => {
      const d = el('i', perBooth[i] ? 'on' : '');
      d.title = `${b.name}: ${perBooth[i]} open`;
      dots.append(d);
    });
    sh.append(dots);
    box.append(sh);
  });
  if (day.between.length || day.bottom.length) box.append(el('i', 'flag'));
  if (lock) box.append(el('i', 'lockmark'));
  cell.append(box);
  cell.tabIndex = 0;
  cell.setAttribute('role', 'button');
  cell.setAttribute('aria-label', `${WEEKDAYS[day.weekday]} ${day.date} October: spots open by game`);
  cell.addEventListener('click', () => ctx.onDay(day));
  cell.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ctx.onDay(day);
    }
  });
  return cell;
}

function dayCell(ctx, day) {
  const cell = el('div', 'day');
  cell.dataset.date = day.date;
  if (day.closed) cell.classList.add('closed');

  if (specialDay(cell, day)) return cell;

  const lock = lockFor(ctx.release, day.date, ctx.now, ctx.admin);
  if (lock) cell.classList.add('locked');

  const full = el('div', 'full');
  day.shifts.forEach((_, i) => {
    full.append(fullShift(ctx, day, i, lock));
    if (i === 0 && day.between.length) {
      const note = el('div', 'note');
      day.between.forEach((line) => note.append(el('div', 'note-line', line)));
      full.append(note);
    }
  });
  if (day.bottom.length) {
    const note = el('div', 'note bottom');
    day.bottom.forEach((line) => note.append(el('div', 'note-line', line)));
    full.append(note);
  }

  const mini = el('div', 'mini');
  mini.append(el('b', 'num', day.date));
  day.shifts.forEach((_, i) => mini.append(miniShift(ctx, day, i, lock)));
  if (day.between.length || day.bottom.length) mini.append(el('i', 'flag'));
  if (lock) mini.append(el('i', 'lockmark'));

  cell.append(full, mini);
  cell.tabIndex = 0;
  cell.setAttribute('role', 'button');
  cell.setAttribute('aria-label', `${WEEKDAYS[day.weekday]} ${day.date} October`);
  const isCompact = () => !!cell.closest('.stage.compact');
  cell.addEventListener('click', () => isCompact() && ctx.onDay(day));
  cell.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && isCompact()) {
      e.preventDefault();
      ctx.onDay(day);
    }
  });
  return cell;
}

function titleCell(booth) {
  const cell = el('div', 'title');
  cell.append(el('h2', 'title-text', booth.name));
  if (booth.logo) {
    const img = el('img', 'title-logo');
    img.src = `assets/${booth.logo}`;
    img.alt = '';
    cell.append(img);
  }
  return cell;
}

export function renderCalendar(root, ctx) {
  root.replaceChildren();
  const stage = el('div', 'stage');
  stage.dataset.board = ctx.booth.board;
  let most = 2;
  for (const day of Object.values(ctx.layout[ctx.booth.id] || {}))
    for (const sh of day) most = Math.max(most, sh.spots.length);
  stage.style.setProperty('--n', most);

  const paper = el('div', 'paper');
  const grid = el('div', 'cal');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', `${ctx.booth.name} shift calendar`);

  WEEKDAYS.forEach((name) => {
    const h = el('div', 'dow');
    h.append(el('span', 'dow-full', name), el('span', 'dow-short', name.slice(0, 3)));
    grid.append(h);
  });

  const chairs = el('div', 'chairs');
  chairs.append(el('span', 'chairs-label', 'Chairpersons:'));
  if (ctx.tag) {
    const tag = el('div', 'tag');
    tag.append(el('b', '', ctx.tag.n), el('span', '', ctx.tag.text));
    chairs.append(tag);
  }
  grid.append(chairs, titleCell(ctx.booth));
  WEEK_ROWS.forEach((row) => row.forEach((day) => grid.append(dayCell(ctx, day))));

  paper.append(grid);
  stage.append(paper);
  root.append(stage);
  if (ctx.compact()) {
    stage.classList.add('compact');
  } else {
    const view = root.closest('.view');
    const over = () => view && view.scrollHeight > view.clientHeight + 2;
    if (over()) stage.classList.add('dense');
    if (over()) stage.classList.add('compact');
  }
}

export function renderMaster(root, ctx) {
  root.replaceChildren();
  const stage = el('div', 'stage master');
  stage.dataset.board = 'purple';
  if (ctx.compact()) stage.classList.add('compact');
  const paper = el('div', 'paper');
  const grid = el('div', 'cal');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'All games, open spots by day');
  WEEKDAYS.forEach((name) => {
    const h = el('div', 'dow');
    h.append(el('span', 'dow-full', name), el('span', 'dow-short', name.slice(0, 3)));
    grid.append(h);
  });
  const chairs = el('div', 'chairs');
  chairs.append(el('span', 'chairs-label', 'Chairpersons:'));
  if (ctx.tag) {
    const tag = el('div', 'tag');
    tag.append(el('b', '', ctx.tag.n), el('span', '', ctx.tag.text));
    chairs.append(tag);
  }
  const title = el('div', 'title mtitle');
  title.append(el('h2', 'title-text', 'All games'), el('p', 'msub', 'Open spots by day. Tap a day.'));
  grid.append(chairs, title);
  WEEK_ROWS.forEach((row) => row.forEach((day) => grid.append(masterCell(ctx, day))));
  paper.append(grid);
  stage.append(paper);
  root.append(stage);
}
