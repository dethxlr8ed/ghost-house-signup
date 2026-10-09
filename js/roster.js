import { DAYS, BOOTHS, shiftLabel, weekdayName, monthName } from './data.js';
import { downloadText } from './util.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

let selDay = null;
let query = '';

function collect(ctx) {
  const rows = [];
  for (const day of DAYS) {
    if (day.closed) continue;
    day.shifts.forEach((shift, idx) => {
      for (const b of BOOTHS) {
        const label = shiftLabel(ctx.layout, b.id, day.date, idx, shift.label);
        for (const sp of ctx.layout[b.id]?.[day.date]?.[idx]?.spots || []) {
          const senior = sp.k === 'cl';
          const person = ctx.store.get(sp.id);
          const taken = senior ? !!person : ctx.store.isTaken(sp.id);
          if (senior && !person) continue;
          rows.push({ date: day.date, idx, shift: shift.label, label, booth: b, spot: senior ? 'CL' : sp.n, senior, taken, person });
        }
      }
    });
  }
  return rows;
}

function personText(r) {
  if (!r.taken) return 'OPEN';
  return r.person?.name ? r.person.name : 'taken (name not loaded)';
}

function csv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['date', 'shift', 'game', 'spot', 'name', 'phone', 'email', 'under18', 'grade', 'emergency_name', 'emergency_phone', 'school', 'source', 'note'];
  const lines = [head.join(',')];
  for (const r of rows) {
    const p = r.person || {};
    lines.push(
      [`Oct ${r.date}`, r.label, r.booth.name, r.spot, personText(r), p.phone, p.email, p.minor ? 'yes' : '', p.grade, p.emergencyName, p.emergencyPhone, p.school, r.taken ? p.source || '' : '', p.uncertain ? 'uncertain reading' : ''].map(cell).join(','),
    );
  }
  return lines.join('\n');
}

function personLine(r) {
  const li = el('span', r.taken ? 'rwho' : 'ropen');
  li.append(el('b', '', r.spot));
  if (!r.taken) {
    li.append(' OPEN');
    return li;
  }
  const p = r.person || {};
  li.append(` ${p.name || 'taken (name not loaded)'}${p.uncertain ? ' ?' : ''}`);
  if (p.minor) li.append(el('em', 'u18', 'U18'));
  const contact = [p.phone, p.email].filter(Boolean).join('  ');
  if (contact) li.append(el('i', '', contact));
  return li;
}

function dayBlock(ctx, rows, date) {
  const day = DAYS.find((d) => d.date === date);
  const card = el('article', 'rday');
  const h = el('h3', '', `${weekdayName(date)}, ${monthName(date)} ${date}`);
  day.between.concat(day.bottom).forEach((n) => h.append(el('small', '', n)));
  card.append(h);
  day.shifts.forEach((shift, idx) => {
    const sr = rows.filter((r) => r.date === date && r.idx === idx);
    const open = sr.filter((r) => !r.senior && !r.taken).length;
    const filled = sr.filter((r) => !r.senior && r.taken).length;
    const head = el('h4', '', `${shift.label} PM`);
    head.append(el('span', 'rcount', `${filled} filled · ${open} open`));
    card.append(head);
    const table = el('table', 'rtable');
    for (const b of BOOTHS) {
      const br = sr.filter((r) => r.booth === b);
      if (!br.length) continue;
      const tr = el('tr');
      const th = el('th', '', b.name);
      if (br[0].label !== shift.label) th.append(el('em', '', ` (${br[0].label} PM)`));
      const td = el('td');
      const cells = el('div', 'rcells');
      br.forEach((r) => cells.append(personLine(r)));
      td.append(cells);
      tr.append(th, td);
      table.append(tr);
    }
    card.append(table);
  });
  return card;
}

function results(ctx, rows, box) {
  box.replaceChildren();
  const q = query.trim().toLowerCase();
  if (q) {
    const hits = rows.filter((r) => r.taken && `${r.person?.name || ''} ${r.person?.phone || ''} ${r.person?.email || ''}`.toLowerCase().includes(q));
    box.append(el('p', 'rsum', `${hits.length} match${hits.length === 1 ? '' : 'es'} for "${query.trim()}"`));
    const table = el('table', 'rtable');
    hits.forEach((r) => {
      const tr = el('tr');
      tr.append(el('th', '', `Oct ${r.date} · ${r.label}`), (() => {
        const td = el('td');
        td.append(el('b', '', r.booth.name), '  ', personLine(r));
        return td;
      })());
      table.append(tr);
    });
    const card = el('article', 'rday');
    card.append(table);
    box.append(card);
    return;
  }
  const dates = selDay === 'all' ? DAYS.filter((d) => !d.closed).map((d) => d.date) : [selDay];
  dates.forEach((d) => box.append(dayBlock(ctx, rows, d)));
}

export function renderRoster(root, ctx) {
  root.replaceChildren();
  const store = ctx.store;
  const page = el('section', 'roster');
  const head = el('div', 'open-head');
  head.append(el('h2', '', 'Roster'), el('p', '', 'Who is working when, by day. Names and phone numbers are only shown here in admin.'));
  page.append(head);

  if (store.remote && !store.adminSignedIn) {
    page.append(el('p', 'empty', 'Sign in as admin to see the roster (tap the pink ADMIN badge at the top).'));
    root.append(page);
    return;
  }

  const rows = collect(ctx);
  const filled = rows.filter((r) => !r.senior && r.taken).length;
  const open = rows.filter((r) => !r.senior && !r.taken).length;
  const named = rows.filter((r) => !r.senior && r.taken && r.person?.name).length;
  page.append(el('p', 'rstatus', `${filled} student spots filled (${named} with names loaded) · ${open} open${store.remote ? ` · ${store.adminClaims} online sign-ups · ${store.adminPaper} paper names loaded` : ''}`));

  const today = ctx.now.getMonth() === 9 ? ctx.now.getDate() : 0;
  if (selDay == null) selDay = DAYS.some((d) => d.date === today && !d.closed) ? today : 10;

  const controls = el('div', 'rcontrols');
  const search = el('input', 'rsearch');
  Object.assign(search, { type: 'search', placeholder: 'Search a name or phone', value: query, autocomplete: 'off' });
  const print = el('button', 'btn ghost', 'Print');
  print.type = 'button';
  print.addEventListener('click', () => window.print());
  const dl = el('button', 'btn ghost', 'Download spreadsheet');
  dl.type = 'button';
  dl.addEventListener('click', () => downloadText('ghost-house-roster.csv', csv(rows.filter((r) => r.taken || r.senior)), 'text/csv'));
  controls.append(search, print, dl);

  if (store.remote) {
    const file = el('input');
    Object.assign(file, { type: 'file', accept: '.json,application/json', hidden: true });
    const imp = el('button', 'btn ghost', 'Import paper roster');
    imp.type = 'button';
    imp.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const body = JSON.parse(await f.text());
        const res = await store.importPaper(body.rows || []);
        ctx.toast(`Imported ${res.imported} names${res.skipped ? `, skipped ${res.skipped}` : ''}`);
        await store.loadAdmin();
      } catch (err) {
        ctx.toast(err.message || 'Import failed');
      }
    });
    controls.append(imp, file);
  }
  page.append(controls);

  const chips = el('div', 'weeks rdays');
  const make = (key, label) => {
    const b = el('button', 'wk', label);
    b.type = 'button';
    if (String(selDay) === String(key)) b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', () => {
      selDay = key;
      query = '';
      ctx.rerender();
    });
    chips.append(b);
  };
  make('all', 'All days');
  DAYS.filter((d) => !d.closed).forEach((d) => make(d.date, `${weekdayName(d.date).slice(0, 3)} ${d.date}`));
  page.append(chips);

  const box = el('div', 'rresults');
  page.append(box);
  results(ctx, rows, box);
  search.addEventListener('input', () => {
    query = search.value;
    results(ctx, rows, box);
  });
  root.append(page);
  const active = chips.querySelector('[aria-pressed]');
  if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
}
