// Public studio page at /<slug>: hero, upcoming sessions with Book buttons,
// client sign-in for booking, and "my bookings" section.

import { FAS_API, DATA_API, APP_ID, SESSION_KEY, S, dom } from './state.js';
import { fetchMe } from './api.js';

let currentSlug = '';
let myBookings = [];
let myBookedSessionIds = new Set();

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function returnTo() {
  const here = new URL(window.location.href);
  here.hash = '';
  return here.toString();
}

export async function renderPublicStudio(slug) {
  currentSlug = slug;
  dom['home-header'].hidden = true;
  dom['landing-section'].hidden = true;
  dom['signin-view'].hidden = true;
  dom['signed-in-view'].hidden = true;

  // Check for session (cached or from OAuth redirect)
  await capturePublicSession();

  try {
    const res = await fetch(DATA_API + '/public/studios/' + encodeURIComponent(slug));
    if (res.status === 404) {
      dom['notfound-view'].hidden = false;
      document.title = 'Not found — Wellness';
      return;
    }
    if (!res.ok) throw new Error('public fetch failed: ' + res.status);
    const r = await res.json();

    const hero = dom['public-hero'];
    hero.replaceChildren();
    const h1 = document.createElement('h1');
    h1.textContent = r.name;
    if (r.brand_color && HEX_COLOR_RE.test(r.brand_color)) {
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
    document.title = r.name + ' — Wellness';

    renderPublicAuth();

    if (S.session) await loadMyBookings();
    renderMyBookings();
    await renderPublicSessions(slug);
  } catch (err) {
    dom['notfound-view'].hidden = false;
    document.title = 'Error — Wellness';
    console.error(err);
  }
}

async function capturePublicSession() {
  const hash = window.location.hash;
  if (hash.startsWith('#fas_session=')) {
    const token = decodeURIComponent(hash.slice('#fas_session='.length));
    history.replaceState(null, '', window.location.pathname + window.location.search);
    try {
      const user = await fetchMe(token);
      S.session = { token, user };
      localStorage.setItem(SESSION_KEY, JSON.stringify(S.session));
    } catch { /* ignore */ }
    return;
  }
  if (S.session) return;
  const cached = localStorage.getItem(SESSION_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      const fresh = await fetchMe(parsed.token);
      S.session = { token: parsed.token, user: fresh };
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }
}

function renderPublicAuth() {
  const container = dom['public-auth'];
  if (!container) return;
  container.replaceChildren();
  container.hidden = false;

  if (S.session) {
    const bar = document.createElement('div');
    bar.className = 'public-auth-bar';
    bar.innerHTML = '';
    const who = document.createElement('span');
    who.textContent = 'Signed in as ' + (S.session.user.login || 'you');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-btn';
    btn.textContent = 'Sign out';
    btn.addEventListener('click', () => {
      localStorage.removeItem(SESSION_KEY);
      S.session = null;
      myBookedSessionIds.clear();
      myBookings = [];
      renderMyBookings();
      renderPublicAuth();
      renderPublicSessions(currentSlug);
    });
    bar.appendChild(who);
    bar.appendChild(btn);
    container.appendChild(bar);
  } else {
    const bar = document.createElement('div');
    bar.className = 'public-auth-bar public-auth-bar--signin';

    const label = document.createElement('span');
    label.className = 'pa-label';
    label.textContent = 'Sign in to book classes';

    const googleBtn = document.createElement('button');
    googleBtn.type = 'button';
    googleBtn.className = 'card-btn pa-google';
    googleBtn.textContent = 'Continue with Google';
    googleBtn.addEventListener('click', () => {
      const url = new URL('/v1/auth/google/start', FAS_API);
      url.searchParams.set('app_id', APP_ID);
      url.searchParams.set('return_to', returnTo());
      window.location.assign(url.toString());
    });

    const divider = document.createElement('div');
    divider.className = 'pa-divider';
    divider.textContent = 'or use email';

    const form = document.createElement('form');
    form.className = 'pa-email-form';
    const input = document.createElement('input');
    input.type = 'email';
    input.required = true;
    input.placeholder = 'you@example.com';
    input.autocomplete = 'email';
    input.className = 'pa-email-input';
    const sendBtn = document.createElement('button');
    sendBtn.type = 'submit';
    sendBtn.className = 'pa-email-send';
    sendBtn.textContent = 'Send sign-in link';

    const status = document.createElement('div');
    status.className = 'pa-email-status';
    status.hidden = true;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = input.value.trim();
      if (!email) return;
      sendBtn.disabled = true;
      const originalText = sendBtn.textContent;
      sendBtn.textContent = 'Sending…';
      status.hidden = true;
      try {
        const res = await fetch(FAS_API + '/v1/auth/email/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, appId: APP_ID, returnTo: returnTo() }),
        });
        if (res.ok) {
          status.textContent = 'Check your inbox at ' + email + ' for a sign-in link.';
          status.className = 'pa-email-status ok';
          status.hidden = false;
          form.hidden = true;
        } else {
          status.textContent = 'Could not send sign-in link. Try again.';
          status.className = 'pa-email-status err';
          status.hidden = false;
          sendBtn.disabled = false;
          sendBtn.textContent = originalText;
        }
      } catch {
        status.textContent = 'Network error. Try again.';
        status.className = 'pa-email-status err';
        status.hidden = false;
        sendBtn.disabled = false;
        sendBtn.textContent = originalText;
      }
    });

    form.appendChild(input);
    form.appendChild(sendBtn);

    bar.appendChild(label);
    bar.appendChild(googleBtn);
    bar.appendChild(divider);
    bar.appendChild(form);
    bar.appendChild(status);
    container.appendChild(bar);
  }
}

async function loadMyBookings() {
  myBookings = [];
  myBookedSessionIds.clear();
  if (!S.session) return;
  try {
    const res = await fetch(
      DATA_API + '/public/studios/' + encodeURIComponent(currentSlug) + '/my-bookings',
      { headers: { Authorization: 'Bearer ' + S.session.token } },
    );
    if (res.status === 401) {
      // Token died between page load and this fetch — drop it locally; the
      // signed-in bar will switch to the guest sign-in form on the next render.
      localStorage.removeItem(SESSION_KEY);
      S.session = null;
      return;
    }
    if (!res.ok) return;
    const rows = await res.json();
    myBookings = Array.isArray(rows) ? rows : [];
    for (const b of myBookings) myBookedSessionIds.add(b.session_id);
  } catch { /* ignore */ }
}

function renderMyBookings() {
  const section = dom['my-bookings-section'];
  const list = dom['my-bookings-list'];
  if (!section || !list) return;
  if (!S.session || myBookings.length === 0) {
    section.hidden = true;
    list.replaceChildren();
    return;
  }
  section.hidden = false;
  list.replaceChildren();
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  for (const b of myBookings) {
    const card = document.createElement('div');
    card.className = 'my-booking';
    card.style.borderLeftColor = b.class_color || 'var(--accent)';

    const when = document.createElement('div');
    when.className = 'mb-when';
    const d = new Date(b.starts_at);
    const day = document.createElement('div');
    day.className = 'mb-day';
    day.textContent = dayFmt.format(d);
    const time = document.createElement('div');
    time.className = 'mb-time';
    time.textContent = timeFmt.format(d);
    when.appendChild(day);
    when.appendChild(time);

    const info = document.createElement('div');
    info.className = 'mb-info';
    const cls = document.createElement('strong');
    cls.textContent = b.class_name || 'Class';
    info.appendChild(cls);
    if (b.location) {
      const loc = document.createElement('small');
      loc.textContent = b.location;
      info.appendChild(loc);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-cancel-booking';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => cancelFromList(b.session_id, cancelBtn));

    card.appendChild(when);
    card.appendChild(info);
    card.appendChild(cancelBtn);
    list.appendChild(card);
  }
}

async function cancelFromList(sessionId, btn) {
  if (!S.session) return;
  btn.disabled = true;
  btn.textContent = 'Cancelling...';
  try {
    const res = await fetch(
      DATA_API + '/public/studios/' + encodeURIComponent(currentSlug) + '/sessions/' + sessionId + '/cancel',
      { method: 'POST', headers: { Authorization: 'Bearer ' + S.session.token } },
    );
    if (res.status === 401) {
      handleAuthExpired();
      return;
    }
    if (res.ok) {
      await loadMyBookings();
      renderMyBookings();
      await renderPublicSessions(currentSlug);
    } else {
      btn.textContent = 'Failed';
      setTimeout(() => { btn.textContent = 'Cancel'; btn.disabled = false; }, 2000);
    }
  } catch {
    btn.textContent = 'Error';
    setTimeout(() => { btn.textContent = 'Cancel'; btn.disabled = false; }, 2000);
  }
}

// On 401, the cached session token is no longer valid (expired or revoked).
// Clear it, re-render the sign-in bar, and re-render the calendar without
// Book buttons so the user has a clear next step.
function handleAuthExpired() {
  localStorage.removeItem(SESSION_KEY);
  S.session = null;
  myBookings = [];
  myBookedSessionIds.clear();
  renderMyBookings();
  renderPublicAuth();
  renderPublicSessions(currentSlug);
}

// A booking button is stateful (Book ↔ Booked) and each state needs a
// different click handler. To keep the visual state and the handler in sync
// we throw the old node away and append a fresh one on every transition.
function makeBookingButton(sessionId, isBooked) {
  const btn = document.createElement('button');
  btn.type = 'button';
  if (isBooked) {
    btn.className = 'btn-booked';
    btn.textContent = 'Booked';
    btn.addEventListener('click', () => cancelBooking(sessionId, btn));
  } else {
    btn.className = 'btn-book';
    btn.textContent = 'Book';
    btn.addEventListener('click', () => bookSession(sessionId, btn));
  }
  return btn;
}

function flashThenRestore(btn, errorText, isBooked) {
  btn.textContent = errorText;
  setTimeout(() => {
    const replacement = makeBookingButton(btn.dataset.sessionId, isBooked);
    replacement.dataset.sessionId = btn.dataset.sessionId;
    btn.replaceWith(replacement);
  }, 2000);
}

async function bookSession(sessionId, btn) {
  if (!S.session) return;
  btn.dataset.sessionId = sessionId;
  btn.disabled = true;
  btn.textContent = 'Booking...';
  try {
    const res = await fetch(
      DATA_API + '/public/studios/' + encodeURIComponent(currentSlug) + '/sessions/' + sessionId + '/book',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + S.session.token },
      },
    );
    if (res.status === 401) {
      handleAuthExpired();
      return;
    }
    if (res.ok || res.status === 201) {
      myBookedSessionIds.add(sessionId);
      const next = makeBookingButton(sessionId, true);
      btn.replaceWith(next);
      loadMyBookings().then(renderMyBookings);
    } else {
      const body = await res.json().catch(() => ({}));
      flashThenRestore(btn, body.error || 'Failed', false);
    }
  } catch {
    flashThenRestore(btn, 'Error', false);
  }
}

async function cancelBooking(sessionId, btn) {
  if (!S.session) return;
  btn.dataset.sessionId = sessionId;
  btn.disabled = true;
  btn.textContent = 'Cancelling...';
  try {
    const res = await fetch(
      DATA_API + '/public/studios/' + encodeURIComponent(currentSlug) + '/sessions/' + sessionId + '/cancel',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + S.session.token },
      },
    );
    if (res.status === 401) {
      handleAuthExpired();
      return;
    }
    if (res.ok) {
      myBookedSessionIds.delete(sessionId);
      const next = makeBookingButton(sessionId, false);
      btn.replaceWith(next);
      loadMyBookings().then(renderMyBookings);
    } else {
      flashThenRestore(btn, 'Failed', true);
    }
  } catch {
    flashThenRestore(btn, 'Error', true);
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

        const action = document.createElement('div');
        action.className = 'session-action';
        const spots = document.createElement('div');
        spots.className = 'spots';
        spots.textContent = r.capacity + ' spots';

        action.appendChild(spots);
        if (S.session) {
          action.appendChild(makeBookingButton(r.id, myBookedSessionIds.has(r.id)));
        }

        card.appendChild(time);
        card.appendChild(info);
        card.appendChild(action);
        inner.appendChild(card);
      }
      wrap.appendChild(inner);
      list.appendChild(wrap);
    }
  } catch (err) {
    console.error('public sessions:', err);
  }
}
