// Public studio page at /<slug>: hero (name, description, address) +
// upcoming classes list. No auth required. Brand color, if set on the
// studio, overrides --accent on this view.

import { DATA_API, dom } from './state.js';

export async function renderPublicStudio(slug) {
  dom['home-header'].hidden = true;
  dom['signin-view'].hidden = true;
  dom['signed-in-view'].hidden = true;
  try {
    const res = await fetch(DATA_API + '/public/studios/' + encodeURIComponent(slug));
    if (res.status === 404) {
      dom['notfound-view'].hidden = false;
      document.title = 'Not found — wellness';
      return;
    }
    if (!res.ok) throw new Error('public fetch failed: ' + res.status);
    const r = await res.json();

    const hero = dom['public-hero'];
    hero.replaceChildren();
    const h1 = document.createElement('h1');
    h1.textContent = r.name;
    if (r.brand_color) {
      h1.style.color = r.brand_color;
      dom['public-view'].style.setProperty('--accent', r.brand_color);
    }
    hero.appendChild(h1);

    const meta = document.createElement('p');
    meta.className = 'meta';
    const parts = [];
    if (r.timezone) parts.push(r.timezone);
    if (r.address) parts.push(r.address);
    if (parts.length) meta.textContent = parts.join(' · ');
    if (parts.length) hero.appendChild(meta);

    if (r.description) {
      const desc = document.createElement('p');
      desc.className = 'desc';
      desc.textContent = r.description;
      hero.appendChild(desc);
    }

    dom['public-view'].hidden = false;
    document.title = r.name + ' — wellness';

    await renderPublicSessions(slug);
  } catch (err) {
    dom['notfound-view'].hidden = false;
    document.title = 'Error — wellness';
    console.error(err);
  }
}

async function renderPublicSessions(slug) {
  const empty = dom['public-sessions-empty'];
  const list = dom['public-sessions'];
  try {
    const res = await fetch(
      DATA_API + '/public/studios/' + encodeURIComponent(slug) + '/sessions?days=14',
    );
    if (!res.ok) return;
    const rows = await res.json();
    list.replaceChildren();
    if (!Array.isArray(rows) || rows.length === 0) {
      empty.hidden = false;
      list.hidden = true;
      return;
    }
    empty.hidden = true;
    list.hidden = false;

    const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    const groups = new Map();
    for (const r of rows) {
      const d = new Date(r.starts_at);
      const key = d.toDateString();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const [key, items] of groups) {
      const wrap = document.createElement('div');
      wrap.className = 'day-group';
      const h3 = document.createElement('h3');
      h3.textContent = dayFmt.format(new Date(key));
      wrap.appendChild(h3);
      const inner = document.createElement('div');
      inner.style.display = 'grid';
      inner.style.gap = '.5rem';
      for (const r of items) {
        const card = document.createElement('div');
        card.className = 'session-public';
        card.style.borderLeftColor = r.class_color || 'var(--accent)';
        const time = document.createElement('div');
        time.className = 'time';
        time.textContent = timeFmt.format(new Date(r.starts_at));
        const info = document.createElement('div');
        info.className = 'info';
        const cls = document.createElement('strong');
        cls.textContent = r.class_name ?? 'Class';
        const sub = document.createElement('small');
        const subParts = [];
        if (r.instructor_name) subParts.push(r.instructor_name);
        if (r.location) subParts.push(r.location);
        sub.textContent = subParts.join(' · ');
        info.appendChild(cls);
        if (subParts.length) info.appendChild(sub);
        const spots = document.createElement('div');
        spots.className = 'spots';
        spots.textContent = r.capacity + ' spots';
        card.appendChild(time);
        card.appendChild(info);
        card.appendChild(spots);
        inner.appendChild(card);
      }
      wrap.appendChild(inner);
      list.appendChild(wrap);
    }
  } catch (err) {
    console.error('public sessions:', err);
  }
}
