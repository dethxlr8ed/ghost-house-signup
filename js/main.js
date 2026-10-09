import { BOOTHS, DAYS, boothById, loadLayout, loadPrivate, loadRelease, lockFor, fmtOpen, daysTag, shiftLabel, weekdayName, monthName } from './data.js';
import { createStore, adminKeyStore } from './store.js';
import { renderCalendar, renderMaster, spotView } from './calendar.js';
import { renderOpen, buildShiftBlock, openIds, countUnlockedOpen } from './openview.js';
import { selection } from './select.js';
import { openSignup, openAdminSpot, askAdminKey } from './forms.js';
import { shareLink, downloadText } from './util.js';

const params = new URLSearchParams(location.search);
const admin = params.has('admin');
const now = params.get('now') ? new Date(`${params.get('now')}T12:00:00`) : new Date();

const $ = (sel) => document.querySelector(sel);
const compactMq = window.matchMedia('(max-width: 780px)');

let store;
let layout;
let release;
let route = { view: 'master', booth: BOOTHS[0] };
let weekFilter = 'all';
let openDay = null;

function parseRoute() {
  const h = location.hash.slice(2);
  if (h === 'open') return { view: 'open', booth: route.booth };
  const booth = boothById(h);
  return booth ? { view: 'calendar', booth } : { view: 'master', booth: route.booth };
}

const dayTitle = (day) => `${weekdayName(day.date)}, ${monthName(day.date)} ${day.date}`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function boothOpenCount(b) {
  let n = 0;
  for (const day of DAYS) {
    if (lockFor(release, day.date, now, admin)) continue;
    day.shifts.forEach((_, i) => (n += openIds({ layout, store }, b.id, day.date, i).length));
  }
  return n;
}

const ctxBase = () => ({ store, layout, release, now, admin, selection });

function makeCtx() {
  return {
    ...ctxBase(),
    booth: route.booth,
    tag: daysTag(now),
    weekFilter,
    compact: () => compactMq.matches,
    onPick,
    onDay,
    onPickShift,
    onLocked: (lock) => toast(`${lock.week.label} opens ${fmtOpen(lock.opens)}`),
    setWeek: (k) => {
      weekFilter = k;
      render();
    },
  };
}

function onPick(v) {
  if (admin) return openAdminSpot(makeCtx(), v);
  if (v.state === 'locked') return toast(`${v.lock.week.label} opens ${fmtOpen(v.lock.opens)}`);
  const result = selection.toggle({ id: v.id, boothId: v.booth.id, date: v.day.date, idx: v.idx });
  if (result && result !== true) toast('Swapped your pick for that shift.');
}

function onPickShift({ booth, day, idx, ids, picked }) {
  if (picked) return selection.remove(picked);
  const result = selection.toggle({ id: ids[0], boothId: booth.id, date: day.date, idx });
  if (result && result !== true) toast('Swapped your pick for that shift.');
}

function renderBar() {
  const bar = $('#booths');
  bar.replaceChildren();
  const make = (href, name, count, board, active) => {
    const a = document.createElement('a');
    a.href = href;
    a.className = 'chip';
    if (board) a.dataset.board = board;
    if (active) a.setAttribute('aria-current', 'page');
    const label = document.createElement('span');
    label.textContent = name;
    a.append(label);
    if (count != null) {
      const small = document.createElement('small');
      small.textContent = count;
      a.append(small);
    }
    bar.append(a);
  };
  make('#/all', 'All games', countUnlockedOpen({ layout, store, release, now, admin }), 'open', route.view === 'master');
  for (const b of BOOTHS) make(`#/${b.id}`, b.name, boothOpenCount(b), b.board, route.view === 'calendar' && b.id === route.booth.id);
  make('#/open', 'List view', null, 'open', route.view === 'open');
  const active = bar.querySelector('[aria-current]');
  if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function renderStrip() {
  const strip = $('#strip');
  strip.replaceChildren();
  const weeks = document.createElement('div');
  weeks.className = 'strip-weeks';
  for (const w of release.weeks) {
    const lock = lockFor(release, w.from, now, admin);
    const pill = document.createElement('span');
    pill.className = `pill${lock ? ' lock' : ''}`;
    pill.textContent = lock ? `${w.short} · ${lock.opens.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : `${w.short} open`;
    weeks.append(pill);
  }
  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML =
    route.view === 'master'
      ? '<span><i class="sw h0"></i>0</span><span><i class="sw h1"></i>1-3</span><span><i class="sw h2"></i>4-7</span><span><i class="sw h3"></i>8+</span><span>open</span>'
      : '<span><i class="sw open"></i>Open</span><span><i class="sw taken"></i>Taken</span>';
  strip.append(weeks, legend);
}

function render() {
  if (!store) return;
  const view = $('#view');
  const scroll = view.scrollTop;
  renderBar();
  renderStrip();
  const ctx = makeCtx();
  view.replaceChildren();
  const host = document.createElement('div');
  host.className = 'wrap';
  view.append(host);
  if (route.view === 'open') renderOpen(host, ctx);
  else if (route.view === 'master') renderMaster(host, ctx);
  else renderCalendar(host, ctx);
  document.body.dataset.view = route.view;
  document.title = route.view === 'calendar' ? `${route.booth.name} · Ghost House Games` : 'All games · Ghost House Games';
  view.scrollTop = scroll;
  renderTray();
  renderAdminBadge();
  if (openDay) renderDaySheet();
}

function renderTray() {
  const n = selection.size();
  const tray = $('#tray');
  tray.hidden = n === 0 || admin;
  $('#tray-text').textContent = n === 1 ? '1 shift selected' : `${n} shifts selected`;
}

function renderDaySheet() {
  const day = openDay;
  const ctx = makeCtx();
  const body = $('#day-body');
  body.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = dayTitle(day);
  body.append(h);
  day.between.concat(day.bottom).forEach((line) => {
    const n = document.createElement('p');
    n.className = 'sheet-note';
    n.textContent = line;
    body.append(n);
  });
  const lock = lockFor(release, day.date, now, admin);
  if (lock) {
    const n = document.createElement('p');
    n.className = 'sheet-lock';
    n.textContent = `${lock.week.label} opens ${fmtOpen(lock.opens)}. You can see what is taken but cannot sign up yet.`;
    body.append(n);
  }
  if (route.view !== 'calendar') {
    const note = document.createElement('p');
    note.className = 'sheet-help';
    note.textContent = 'Tap a game to select it. You can pick several shifts.';
    body.append(note);
    day.shifts.forEach((_, idx) => {
      const blk = buildShiftBlock(ctx, day, idx, { lock, showFull: true });
      if (blk) body.append(blk);
    });
  }
  if (route.view === 'calendar') day.shifts.forEach((shift, idx) => {
    const sec = document.createElement('section');
    sec.className = 'sheet-shift';
    const t = document.createElement('h4');
    t.textContent = `${shiftLabel(layout, route.booth.id, day.date, idx, shift.label)} PM`;
    sec.append(t);
    for (const spot of layout[route.booth.id]?.[day.date]?.[idx]?.spots || []) {
      const v = spotView(ctx, day, idx, spot, lock);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sheet-spot ${v.state}`;
      const n = document.createElement('span');
      n.className = 'spot-n';
      n.textContent = v.spot.label;
      const label = document.createElement('span');
      label.className = 'sheet-label';
      const who = admin && v.person?.name ? v.person.name : null;
      label.textContent = { open: 'Open · tap to select', selected: 'Selected', locked: 'Opens soon', taken: who || 'Taken', senior: who || 'Candlelighters' }[v.state];
      b.append(n, label);
      if (v.state === 'selected') b.append(Object.assign(document.createElement('span'), { className: 'check', textContent: '✓' }));
      if (v.state === 'open' || v.state === 'selected' || v.state === 'locked' || admin) b.addEventListener('click', () => onPick(v));
      else b.disabled = true;
      sec.append(b);
    }
    body.append(sec);
  });
  const foot = document.createElement('div');
  foot.className = 'sheet-foot';
  const n = selection.size();
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn primary wide';
  go.textContent = n && !admin ? `Continue with ${n} shift${n > 1 ? 's' : ''}` : 'Done';
  go.addEventListener('click', () => {
    $('#day').close();
    if (n && !admin) openSignup(makeCtx());
  });
  foot.append(go);
  body.append(foot);
}

function onDay(day) {
  openDay = day;
  renderDaySheet();
  const dlg = $('#day');
  if (!dlg.open) dlg.showModal();
}

$('#day').addEventListener('close', () => (openDay = null));
$('#day-close').addEventListener('click', () => $('#day').close());
for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
}
$('#tray-go').addEventListener('click', () => openSignup(makeCtx()));
$('#tray-clear').addEventListener('click', () => selection.clear());

$('#share').addEventListener('click', async () => {
  const n = countUnlockedOpen({ layout, store, release, now, admin });
  const url = `${location.origin}${location.pathname}`;
  const res = await shareLink({ title: 'Ghost House Games volunteer shifts', text: `${n} volunteer spots are open for Ghost House Games. Pick your shifts:`, url });
  if (res === 'copied') toast('Link copied');
  else if (res === 'fail') toast(url);
});

$('#view').addEventListener('scroll', () => $('#app').classList.toggle('scrolled', $('#view').scrollTop > 30), { passive: true });

window.addEventListener('hashchange', () => {
  route = parseRoute();
  render();
});
compactMq.addEventListener('change', render);

function renderAdminBadge() {
  const badge = $('#admin-badge');
  badge.hidden = !admin;
  if (!admin) return;
  badge.classList.toggle('out', store.remote && !store.adminSignedIn);
  if (!store.remote) badge.textContent = 'ADMIN · test mode on this device';
  else if (!store.adminSignedIn) badge.textContent = 'ADMIN · tap to sign in';
  else badge.textContent = `ADMIN · ${store.adminClaims} online sign-up${store.adminClaims === 1 ? '' : 's'} · tap for spreadsheet`;
}

async function downloadSignups() {
  const res = await fetch('api/admin/export.csv', { headers: { 'x-admin-key': adminKeyStore.get() }, cache: 'no-store' });
  if (!res.ok) return toast('Could not download. Try signing in again.');
  downloadText('ghost-house-signups.csv', await res.text(), 'text/csv');
}

$('#admin-badge').addEventListener('click', async () => {
  if (!store.remote) return;
  if (!store.adminSignedIn) {
    adminKeyStore.set('');
    await adminLogin();
    render();
  } else {
    await downloadSignups();
  }
});

async function adminLogin() {
  for (let i = 0; i < 3; i++) {
    if (!adminKeyStore.get()) {
      const key = await askAdminKey();
      if (!key) return;
      adminKeyStore.set(String(key).trim());
    }
    if (await store.loadAdmin()) return;
    adminKeyStore.set('');
    toast('That key did not work');
  }
}

async function start() {
  if (admin) document.body.classList.add('admin');
  const [booths, rel, people] = await Promise.all([loadLayout(), loadRelease(), admin ? loadPrivate() : {}]);
  layout = booths;
  release = rel;
  const taken = new Set();
  for (const days of Object.values(booths))
    for (const day of Object.values(days))
      for (const shift of day) for (const sp of shift.spots) if (sp.k === 'kid' && sp.t) taken.add(sp.id);
  store = await createStore({ taken, people });
  store.subscribe(render);
  selection.subscribe(render);
  const poll = () => document.visibilityState === 'visible' && store.refresh();
  setInterval(poll, 20000);
  document.addEventListener('visibilitychange', poll);
  window.addEventListener('focus', poll);
  route = parseRoute();
  render();
  if (admin && store.remote) adminLogin().then(render, render);
}

start();
