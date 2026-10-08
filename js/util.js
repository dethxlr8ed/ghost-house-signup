const pad = (n) => String(n).padStart(2, '0');

function parseTimes(label) {
  const [a, b] = label.split(' - ').map((t) => {
    const [h, m] = t.split(':').map(Number);
    return [h < 12 ? h + 12 : h, m];
  });
  return { s: a, e: b };
}

export function makeIcs(events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ghost House Games//Volunteer shifts//EN'];
  for (const ev of events) {
    const { s, e } = parseTimes(ev.label);
    const day = `2026${pad(10)}${pad(ev.date)}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.id}@ghosthousegames`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${day}T${pad(s[0])}${pad(s[1])}00`,
      `DTEND:${day}T${pad(e[0])}${pad(e[1])}00`,
      `SUMMARY:${ev.title}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function shareLink({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancel';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'fail';
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
