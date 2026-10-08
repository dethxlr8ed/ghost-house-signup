import { CONFIG, dayByDate, shiftLabel, boothById, weekdayName, monthName } from './data.js';
import { makeIcs, downloadText } from './util.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export function itemInfo(ctx, item) {
  const booth = boothById(item.boothId);
  const day = dayByDate(item.date);
  const label = shiftLabel(ctx.layout, item.boothId, item.date, item.idx, day.shifts[item.idx].label);
  return {
    booth,
    day,
    label,
    when: `${weekdayName(item.date).slice(0, 3)}, ${monthName(item.date).slice(0, 3)} ${item.date}`,
  };
}

function field(label, name, { type = 'text', required = false, auto = '', mode = '', hint = '' } = {}) {
  const wrap = el('label', 'field');
  wrap.append(el('span', '', label + (required ? '' : ' (optional)')));
  const input = el('input');
  Object.assign(input, { type, name, required });
  if (auto) input.autocomplete = auto;
  if (mode) input.inputMode = mode;
  wrap.append(input);
  if (hint) wrap.append(el('em', 'hint', hint));
  return wrap;
}

function button(text, cls, type = 'button') {
  const b = el('button', cls, text);
  b.type = type;
  return b;
}

let unsub = null;

function shiftList(ctx, items, removable) {
  const ul = el('ul', 'picked-list');
  for (const item of items) {
    const info = itemInfo(ctx, item);
    const li = el('li');
    li.append(el('span', 'pl-main', info.booth.name), el('span', 'pl-when', `${info.when} · ${info.label} PM`));
    if (removable) {
      const x = button('×', 'pl-x');
      x.setAttribute('aria-label', `Remove ${info.booth.name} ${info.when}`);
      x.addEventListener('click', () => ctx.selection.remove(item.id));
      li.append(x);
    }
    ul.append(li);
  }
  return ul;
}

export function openSignup(ctx) {
  const dlg = document.querySelector('#spot');
  const form = document.querySelector('#spot-form');
  const draw = () => {
    form.dataset.mode = 'signup';
    const items = ctx.selection.list();
    if (!items.length) {
      dlg.close();
      return;
    }
    const keep = form.isConnected ? Object.fromEntries(new FormData(form)) : {};
    form.replaceChildren();
    form.append(el('h3', '', items.length === 1 ? 'Sign up for 1 shift' : `Sign up for ${items.length} shifts`));
    form.append(shiftList(ctx, items, true));
    const nameF = field('Your name', 'name', { required: true, auto: 'name' });
    const phoneF = field('Phone', 'phone', { type: 'tel', auto: 'tel', mode: 'tel', required: true });
    const emailF = field('Email', 'email', { type: 'email', auto: 'email', required: true });
    for (const f of [nameF, phoneF, emailF]) {
      const input = f.querySelector('input');
      if (keep[input.name] != null) input.value = keep[input.name];
    }
    phoneF.querySelector('span').textContent = 'Phone';
    emailF.querySelector('span').textContent = 'Email';
    phoneF.querySelector('input').required = false;
    emailF.querySelector('input').required = false;
    form.append(nameF);
    const pair = el('div', 'pair');
    pair.append(phoneF, emailF);
    form.append(pair);
    form.append(el('p', 'micro', 'Please give a phone number and an email so we can reach you. Both is best.'));

    const age = el('fieldset', 'seg');
    age.append(el('legend', '', 'Age group'));
    for (const [val, text] of [['minor', 'Under 18'], ['adult', '18 or older']]) {
      const l = el('label', 'seg-opt');
      const r = el('input');
      Object.assign(r, { type: 'radio', name: 'age', value: val, required: true });
      if (keep.age === val) r.checked = true;
      l.append(r, el('span', '', text));
      age.append(l);
    }
    form.append(age);

    const minorBox = el('div', 'minor-box');
    minorBox.hidden = keep.age !== 'minor';
    minorBox.append(el('b', 'minor-title', 'For volunteers under 18'));
    const gradeF = field('Grade (year)', 'grade', { required: true, mode: 'text' });
    const ecNameF = field('Emergency contact name', 'ec_name', { required: true, auto: 'off' });
    const ecPhoneF = field('Emergency contact phone', 'ec_phone', { type: 'tel', required: true, auto: 'off', mode: 'tel' });
    const minorInputs = [gradeF, ecNameF, ecPhoneF].map((f) => f.querySelector('input'));
    for (const f of [gradeF, ecNameF, ecPhoneF]) {
      const input = f.querySelector('input');
      f.querySelector('span').textContent = input.name === 'grade' ? 'Grade (year)' : input.name === 'ec_name' ? 'Emergency contact name' : 'Emergency contact phone';
      if (keep[input.name] != null) input.value = keep[input.name];
      input.required = keep.age === 'minor';
    }
    minorBox.append(gradeF, ecNameF, ecPhoneF);

    const liab = el('div', 'liab');
    liab.append(el('b', '', 'Volunteers under 18 need a signed liability form.'));
    if (CONFIG.liabilityUrl) {
      const a = el('a', 'btn ghost', 'Open the liability form');
      a.href = CONFIG.liabilityUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      liab.append(a);
    } else {
      liab.append(el('span', '', 'The form link will be added here soon. We will also send it to you.'));
    }
    const ack = el('label', 'ack');
    const box = el('input');
    Object.assign(box, { type: 'checkbox', name: 'ack' });
    ack.append(box, el('span', '', 'I understand the form must be completed before the first shift.'));
    liab.append(ack);
    minorBox.append(liab);
    form.append(minorBox);
    age.addEventListener('change', () => {
      const minor = form.querySelector('input[name=age]:checked')?.value === 'minor';
      minorBox.hidden = !minor;
      box.required = minor;
      minorInputs.forEach((i) => (i.required = minor));
    });
    if (keep.age === 'minor') box.required = true;

    form.append(field('School or group', 'school', { auto: 'organization' }));
    const hp = el('label', 'hp');
    hp.append(el('span', '', 'Website'));
    const hpInput = el('input');
    Object.assign(hpInput, { type: 'text', name: 'website', tabIndex: -1, autocomplete: 'off' });
    hp.append(hpInput);
    form.append(hp);
    const msg = el('p', 'msg');
    msg.setAttribute('role', 'alert');
    form.append(msg);

    const actions = el('div', 'actions');
    const cancel = button('Back', 'btn ghost');
    cancel.addEventListener('click', () => dlg.close());
    const submit = button(items.length === 1 ? 'Confirm my shift' : `Confirm ${items.length} shifts`, 'btn primary', 'submit');
    actions.append(cancel, submit);
    form.append(actions);

    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const phone = (data.phone || '').trim();
      const email = (data.email || '').trim();
      if (!phone && !email) {
        msg.textContent = 'Please add a phone number or an email.';
        return;
      }
      submit.disabled = true;
      const person = {
        name: data.name.trim(),
        phone,
        email,
        minor: data.age === 'minor',
        school: (data.school || '').trim(),
      };
      if (person.minor) {
        person.grade = (data.grade || '').trim();
        person.emergencyName = (data.ec_name || '').trim();
        person.emergencyPhone = (data.ec_phone || '').trim();
      }
      person.website = (data.website || '').trim();
      let result;
      try {
        result = await ctx.store.claimMany(items.map((i) => i.id), person);
      } catch (err) {
        msg.textContent = err.message || 'Could not reach the server. Please try again.';
        submit.disabled = false;
        return;
      }
      const doneIds = new Set(result.done);
      const done = items.filter((i) => doneIds.has(i.id));
      const lost = items.filter((i) => !doneIds.has(i.id));
      form.dataset.mode = 'result';
      for (const item of items) ctx.selection.remove(item.id);
      showResult(ctx, dlg, form, person, done, lost);
    };
  };

  unsub?.();
  unsub = ctx.selection.subscribe(() => {
    if (dlg.open && form.dataset.mode === 'signup') draw();
  });
  draw();
  if (!dlg.open) dlg.showModal();
}

function showResult(ctx, dlg, form, person, done, lost) {
  form.replaceChildren();
  form.onsubmit = null;
  if (done.length) {
    form.append(el('h3', '', "You're signed up!"));
    form.append(el('p', 'meta', `Thank you, ${person.name.split(' ')[0]}. Here is your schedule:`));
    form.append(shiftList(ctx, done, false));
  } else {
    form.append(el('h3', '', 'Those spots were just taken'));
  }
  if (lost.length) {
    form.append(el('p', 'msg', 'Sorry, these could not be booked (they may have just been taken). Please pick another:'));
    form.append(shiftList(ctx, lost, false));
  }
  if (person.minor) {
    const liab = el('div', 'liab');
    liab.append(el('b', '', 'Reminder: volunteers under 18 need a signed liability form.'));
    if (CONFIG.liabilityUrl) {
      const a = el('a', 'btn ghost', 'Open the liability form');
      a.href = CONFIG.liabilityUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      liab.append(a);
    }
    form.append(liab);
  }
  const actions = el('div', 'actions');
  if (done.length) {
    const ics = button('Add to my calendar', 'btn ghost');
    ics.addEventListener('click', () => {
      const events = done.map((item) => {
        const info = itemInfo(ctx, item);
        return { id: item.id, date: item.date, label: info.label, title: `Ghost House Games - ${info.booth.name}` };
      });
      downloadText('ghost-house-shifts.ics', makeIcs(events), 'text/calendar');
    });
    actions.append(ics);
  }
  const close = button('Done', 'btn primary');
  close.addEventListener('click', () => dlg.close());
  actions.append(close);
  form.append(actions);
}

export function openAdminSpot(ctx, v) {
  const dlg = document.querySelector('#spot');
  const form = document.querySelector('#spot-form');
  const taken = ctx.store.get(v.id);
  form.dataset.mode = 'admin';
  form.replaceChildren();
  form.append(el('h3', '', taken ? 'Edit spot' : v.spot.senior ? 'Candlelighters spot' : 'Mark filled'));
  form.append(el('p', 'meta', `${v.booth.name} · ${weekdayName(v.day.date).slice(0, 3)} Oct ${v.day.date} · ${v.label} PM · Spot ${v.spot.label}`));
  const nameF = field('Name', 'name', { auto: 'off' });
  nameF.querySelector('input').value = taken?.name || '';
  const phoneF = field('Phone', 'phone', { type: 'tel', mode: 'tel' });
  phoneF.querySelector('input').value = taken?.phone || '';
  form.append(nameF, phoneF);
  const actions = el('div', 'actions');
  const cancel = button('Cancel', 'btn ghost');
  cancel.addEventListener('click', () => dlg.close());
  actions.append(cancel);
  if (taken) {
    const free = button('Free spot', 'btn danger');
    free.addEventListener('click', async () => {
      try {
        await ctx.store.set(v.id, null);
        dlg.close();
      } catch {
        free.textContent = 'Failed, try again';
      }
    });
    actions.append(free);
  }
  actions.append(button('Save', 'btn primary', 'submit'));
  form.append(actions);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const name = data.name.trim();
    try {
      await ctx.store.set(v.id, name || data.phone.trim() ? { name: name || 'Filled', phone: data.phone.trim() } : { name: 'Filled' });
      dlg.close();
    } catch {
      form.querySelector('.actions button[type=submit]').textContent = 'Failed, try again';
    }
  };
  dlg.showModal();
}
