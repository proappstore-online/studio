// Studio admin view at /<slug>/admin — class types, instructors, recurring
// schedules, and the week-view session calendar.
//
// renderAdmin() is the entry: verifies ownership, then loads everything
// in parallel and binds form handlers.

import { DATA_API, SESSION_KEY, CATEGORIES, CATEGORY_LABEL, DAY_LABELS, S, dom } from './state.js';
import { dbQuery, dbExecute, dbBatch, fetchMe } from './api.js';
import { flash, clearFlash } from './flash.js';

// -------------------------------------------------------------------------
// Entry: render admin view for a slug, gated on signed-in + ownership.
// -------------------------------------------------------------------------

export async function renderAdmin(slug) {
  dom['home-header'].hidden = true;
  dom['signin-view'].hidden = true;
  dom['signed-in-view'].hidden = true;

  let token = S.session?.token;
  let user = S.session?.user;
  if (!token) {
    const cached = localStorage.getItem(SESSION_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const fresh = await fetchMe(parsed.token);
        S.session = { token: parsed.token, user: fresh };
        token = parsed.token;
        user = fresh;
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
  }

  if (!token) {
    dom['home-header'].hidden = false;
    dom['signin-view'].hidden = false;
    return;
  }

  // Single query to find the studio and verify ownership in one round-trip.
  const res = await fetch(DATA_API + '/query', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: 'SELECT id, slug, name, owner_user_id FROM studios WHERE slug = ? LIMIT 1',
      params: [slug],
    }),
  });
  if (!res.ok) {
    dom['notfound-view'].hidden = false;
    return;
  }
  const data = await res.json();
  const studio = data.rows?.[0];
  if (!studio) {
    dom['notfound-view'].hidden = false;
    return;
  }
  if (studio.owner_user_id !== user.id) {
    // Don't confirm existence to a non-owner — redirect to the public page.
    window.location.replace('/' + slug);
    return;
  }

  S.currentStudio = studio;
  document.getElementById('admin-studio-name').textContent = studio.name;
  document.getElementById('admin-studio-slug').textContent = '/' + studio.slug;
  document.getElementById('admin-public-link').href = '/' + studio.slug;
  populateCategoryDropdown();
  dom['admin-view'].hidden = false;
  document.title = studio.name + ' · admin — wellness';

  await Promise.all([loadClasses(), loadInstructors(), loadSchedules(), loadSessions()]);
}

// -------------------------------------------------------------------------
// Class types
// -------------------------------------------------------------------------

function populateCategoryDropdown() {
  const sel = document.getElementById('class-category');
  if (!sel || sel.dataset.populated) return;
  for (const [slug, label] of CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = slug;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  sel.dataset.populated = '1';
}

async function loadClasses() {
  if (!S.currentStudio) return;
  const { rows } = await dbQuery(
    'SELECT id, name, category, duration_minutes, default_capacity, color FROM class_types WHERE tenant_id = ? ORDER BY name',
    [S.currentStudio.id],
  );
  S.classTypesCache = rows ?? [];
  renderClasses(S.classTypesCache);
  populateScheduleClassDropdown();
}

function renderClasses(rows) {
  dom['classes-list'].replaceChildren();
  if (!rows || rows.length === 0) {
    dom['classes-empty'].hidden = false;
    dom['classes-list'].hidden = true;
    return;
  }
  dom['classes-empty'].hidden = true;
  dom['classes-list'].hidden = false;
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'class-card';
    li.dataset.id = r.id;

    const name = document.createElement('div');
    name.className = 'class-name';
    const dot = document.createElement('span');
    dot.className = 'dot';
    if (r.color) dot.style.background = r.color;
    const label = document.createElement('span');
    label.textContent = r.name;
    name.appendChild(dot);
    name.appendChild(label);

    const catWrap = document.createElement('div');
    const cat = document.createElement('span');
    cat.className = 'class-category';
    cat.textContent = CATEGORY_LABEL[r.category] ?? r.category ?? 'Uncategorized';
    catWrap.appendChild(cat);

    const left = document.createElement('div');
    left.appendChild(name);
    left.appendChild(catWrap);

    const meta = document.createElement('div');
    meta.className = 'class-meta';
    meta.textContent = r.duration_minutes + ' min · cap ' + r.default_capacity;

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'card-btn danger btn-class-delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteClass(r));

    li.appendChild(left);
    li.appendChild(meta);
    li.appendChild(delBtn);
    dom['classes-list'].appendChild(li);
  }
}

function populateScheduleClassDropdown() {
  const sel = document.getElementById('schedule-class');
  sel.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = S.classTypesCache.length
    ? 'Pick a class type…'
    : 'Add a class type first';
  sel.appendChild(placeholder);
  for (const c of S.classTypesCache) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  sel.disabled = S.classTypesCache.length === 0;
}

async function deleteClass(r) {
  if (!S.currentStudio) return;
  if (!confirm('Delete class type "' + r.name + '"? Existing sessions of this type will stay scheduled.')) return;
  try {
    await dbExecute('DELETE FROM class_types WHERE id = ? AND tenant_id = ?', [r.id, S.currentStudio.id]);
    await loadClasses();
  } catch (err) {
    flash(dom['admin-status'], 'err', String(err));
  }
}

// -------------------------------------------------------------------------
// Instructors (staff)
// -------------------------------------------------------------------------

async function loadInstructors() {
  if (!S.currentStudio) return;
  const { rows } = await dbQuery(
    `SELECT id, name, email, avatar_url, bio
     FROM staff WHERE tenant_id = ? AND role = 'instructor' ORDER BY name`,
    [S.currentStudio.id],
  );
  S.instructorsCache = rows ?? [];
  renderInstructors(S.instructorsCache);
  populateInstructorDropdown();
}

function renderInstructors(rows) {
  dom['instructors-list'].replaceChildren();
  if (rows.length === 0) {
    dom['instructors-empty'].hidden = false;
    dom['instructors-list'].hidden = true;
    return;
  }
  dom['instructors-empty'].hidden = true;
  dom['instructors-list'].hidden = false;
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'instructor-card';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    if (r.avatar_url) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = r.avatar_url;
      avatar.appendChild(img);
    } else {
      avatar.textContent = (r.name || '?').slice(0, 1).toUpperCase();
    }

    const info = document.createElement('div');
    info.className = 'info';
    const strong = document.createElement('strong');
    strong.textContent = r.name;
    info.appendChild(strong);
    if (r.email || r.bio) {
      const small = document.createElement('small');
      small.textContent = [r.email, r.bio ? r.bio.slice(0, 80) + (r.bio.length > 80 ? '…' : '') : '']
        .filter(Boolean)
        .join(' · ');
      info.appendChild(small);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'card-btn danger btn-instructor-delete';
    del.textContent = 'Delete';
    del.addEventListener('click', () => deleteInstructor(r));

    li.appendChild(avatar);
    li.appendChild(info);
    li.appendChild(del);
    dom['instructors-list'].appendChild(li);
  }
}

function populateInstructorDropdown() {
  const sel = document.getElementById('schedule-instructor');
  const previousValue = sel.value;
  sel.replaceChildren();
  const none = document.createElement('option');
  none.value = '';
  none.textContent = S.instructorsCache.length ? 'Anyone / TBD' : 'Add an instructor first (optional)';
  sel.appendChild(none);
  for (const i of S.instructorsCache) {
    const opt = document.createElement('option');
    opt.value = i.id;
    opt.textContent = i.name;
    sel.appendChild(opt);
  }
  if (previousValue && S.instructorsCache.some((i) => i.id === previousValue)) {
    sel.value = previousValue;
  }
}

async function deleteInstructor(r) {
  if (!S.currentStudio) return;
  if (!confirm('Delete instructor "' + r.name + '"? Existing sessions and schedules referencing them stay but lose the assignment.')) return;
  try {
    await dbBatch([
      { sql: 'UPDATE schedules SET instructor_id = NULL WHERE tenant_id = ? AND instructor_id = ?', params: [S.currentStudio.id, r.id] },
      { sql: 'UPDATE sessions SET instructor_id = NULL WHERE tenant_id = ? AND instructor_id = ?', params: [S.currentStudio.id, r.id] },
      { sql: 'DELETE FROM staff WHERE id = ? AND tenant_id = ?', params: [r.id, S.currentStudio.id] },
    ]);
    await Promise.all([loadInstructors(), loadSchedules(), loadSessions()]);
  } catch (err) {
    flash(dom['instructor-status'], 'err', String(err));
  }
}

// -------------------------------------------------------------------------
// Schedules (recurring rules) + session generation
// -------------------------------------------------------------------------

async function loadSchedules() {
  if (!S.currentStudio) return;
  const { rows } = await dbQuery(
    `SELECT s.id, s.class_type_id, s.days_of_week, s.start_time, s.duration_minutes,
            s.capacity, s.location, s.starts_on, s.ends_on, s.status,
            c.name AS class_name, c.color AS class_color
     FROM schedules s
     LEFT JOIN class_types c ON c.id = s.class_type_id AND c.tenant_id = s.tenant_id
     WHERE s.tenant_id = ?
     ORDER BY s.created_at DESC`,
    [S.currentStudio.id],
  );
  renderSchedules(rows ?? []);
}

function renderSchedules(rows) {
  dom['schedules-list'].replaceChildren();
  if (rows.length === 0) {
    dom['schedules-empty'].hidden = false;
    dom['schedules-list'].hidden = true;
    return;
  }
  dom['schedules-empty'].hidden = true;
  dom['schedules-list'].hidden = false;
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'schedule-card';

    const left = document.createElement('div');
    const strong = document.createElement('strong');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.display = 'inline-block';
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.background = r.class_color || 'var(--accent)';
    dot.style.marginRight = '.5rem';
    strong.appendChild(dot);
    strong.appendChild(document.createTextNode(r.class_name ?? 'Unknown class'));
    const small = document.createElement('small');
    small.textContent = formatScheduleSummary(r);
    left.appendChild(strong);
    left.appendChild(small);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'card-btn danger btn-schedule-delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteSchedule(r));

    li.appendChild(left);
    li.appendChild(delBtn);
    dom['schedules-list'].appendChild(li);
  }
}

function formatScheduleSummary(s) {
  const days = s.days_of_week
    .split(',')
    .map((d) => DAY_LABELS[Number(d)])
    .filter(Boolean)
    .join(', ');
  const parts = [days + ' at ' + s.start_time, s.duration_minutes + ' min', 'cap ' + s.capacity];
  if (s.location) parts.push(s.location);
  return parts.join(' · ');
}

async function deleteSchedule(s) {
  if (!S.currentStudio) return;
  if (!confirm('Delete this schedule? Upcoming sessions generated from it will also be removed.')) return;
  try {
    await dbExecute(
      'DELETE FROM sessions WHERE tenant_id = ? AND schedule_id = ? AND starts_at >= ?',
      [S.currentStudio.id, s.id, Date.now()],
    );
    await dbExecute('DELETE FROM schedules WHERE id = ? AND tenant_id = ?', [s.id, S.currentStudio.id]);
    await Promise.all([loadSchedules(), loadSessions()]);
  } catch (err) {
    flash(dom['schedule-status'], 'err', String(err));
  }
}

/**
 * Generate session timestamps from a schedule's first occurrence forward,
 * for `weeks` weeks. Uses browser-local timezone (owner-in-same-tz assumption;
 * proper tz-aware generation is a TODO).
 */
function generateSessionTimestamps(s, weeks) {
  const days = s.days_of_week.split(',').map(Number).filter((d) => d >= 0 && d <= 6);
  const [hh, mm] = s.start_time.split(':').map(Number);
  const out = [];
  const now = Date.now();
  const horizon = now + weeks * 7 * 24 * 60 * 60 * 1000;
  const anchor = new Date(Math.max(now, s.starts_on ?? now));
  anchor.setHours(0, 0, 0, 0);
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(anchor);
    d.setDate(d.getDate() + i);
    if (!days.includes(d.getDay())) continue;
    d.setHours(hh, mm, 0, 0);
    const starts_at = d.getTime();
    if (starts_at < now) continue;
    if (s.ends_on && starts_at > s.ends_on) break;
    if (starts_at > horizon) break;
    out.push(starts_at);
  }
  return out;
}

// -------------------------------------------------------------------------
// Sessions / week-view calendar
// -------------------------------------------------------------------------

async function loadSessions() {
  if (!S.currentStudio) return;
  const now = Date.now();
  const horizon = now + 7 * 24 * 60 * 60 * 1000;
  const { rows } = await dbQuery(
    `SELECT s.id, s.starts_at, s.ends_at, s.capacity, s.location, s.status,
            c.name AS class_name, c.color AS class_color, c.category AS class_category,
            st.name AS instructor_name
     FROM sessions s
     LEFT JOIN class_types c ON c.id = s.class_type_id AND c.tenant_id = s.tenant_id
     LEFT JOIN staff st     ON st.id = s.instructor_id AND st.tenant_id = s.tenant_id
     WHERE s.tenant_id = ? AND s.starts_at >= ? AND s.starts_at < ? AND s.status = 'scheduled'
     ORDER BY s.starts_at`,
    [S.currentStudio.id, now, horizon],
  );
  renderWeekView(rows ?? []);
}

function renderWeekView(rows) {
  dom['week-view'].replaceChildren();
  if (rows.length === 0) {
    dom['sessions-empty'].hidden = false;
    dom['week-view'].hidden = true;
    return;
  }
  dom['sessions-empty'].hidden = true;
  dom['week-view'].hidden = false;

  const dayHeaderFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets = new Map();
  for (const r of rows) {
    const d = new Date(r.starts_at);
    d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }

  for (let i = 0; i < 7; i++) {
    const day = new Date(today);
    day.setDate(day.getDate() + i);
    const col = document.createElement('div');
    col.className = 'week-col';

    const header = document.createElement('div');
    header.className = 'day-header' + (i === 0 ? ' today' : '');
    header.textContent = dayHeaderFmt.format(day);
    col.appendChild(header);

    const items = buckets.get(day.getTime()) ?? [];
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'day-empty';
      empty.textContent = '—';
      col.appendChild(empty);
    } else {
      for (const r of items) {
        const cell = document.createElement('div');
        cell.className = 'week-cell';
        cell.style.borderLeftColor = r.class_color || 'var(--accent)';
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = timeFmt.format(new Date(r.starts_at));
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = r.class_name || 'Class';
        n.title = (r.class_name || 'Class') + (r.instructor_name ? ' · ' + r.instructor_name : '') + ' · ' + r.capacity + ' spots';
        cell.appendChild(t);
        cell.appendChild(n);
        col.appendChild(cell);
      }
    }
    dom['week-view'].appendChild(col);
  }
}

// -------------------------------------------------------------------------
// Form handlers
// -------------------------------------------------------------------------

export function bindAdminHandlers() {
  document.getElementById('class-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFlash(dom['admin-status']);
    if (!S.currentStudio) return;
    const name = document.getElementById('class-name').value.trim();
    if (!name) return;
    const category = document.getElementById('class-category').value;
    if (!category) {
      flash(dom['admin-status'], 'err', 'Pick a category.');
      return;
    }
    const duration = parseInt(document.getElementById('class-duration').value, 10);
    const capacity = parseInt(document.getElementById('class-capacity').value, 10);
    const color = document.getElementById('class-color').value;
    if (!Number.isFinite(duration) || duration < 1 || duration > 480) {
      flash(dom['admin-status'], 'err', 'Duration must be between 1 and 480 minutes.');
      return;
    }
    if (!Number.isFinite(capacity) || capacity < 1 || capacity > 200) {
      flash(dom['admin-status'], 'err', 'Capacity must be between 1 and 200.');
      return;
    }
    const id = crypto.randomUUID();
    try {
      await dbExecute(
        `INSERT INTO class_types (id, tenant_id, name, category, duration_minutes, default_capacity, color, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, S.currentStudio.id, name, category, duration, capacity, color, Date.now()],
      );
      flash(dom['admin-status'], 'ok', 'Added ' + name + '.');
      document.getElementById('class-form').reset();
      document.getElementById('class-duration').value = 60;
      document.getElementById('class-capacity').value = 20;
      document.getElementById('class-color').value = '#6366f1';
      await loadClasses();
    } catch (err) {
      flash(dom['admin-status'], 'err', String(err));
    }
  });

  document.getElementById('instructor-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFlash(dom['instructor-status']);
    if (!S.currentStudio) return;
    const name = document.getElementById('instructor-name').value.trim();
    if (!name) return;
    const email = document.getElementById('instructor-email').value.trim() || null;
    const avatarUrl = document.getElementById('instructor-avatar').value.trim() || null;
    const bio = document.getElementById('instructor-bio').value.trim() || null;

    const id = crypto.randomUUID();
    try {
      await dbExecute(
        `INSERT INTO staff (id, tenant_id, user_id, role, name, email, avatar_url, bio, created_at)
         VALUES (?, ?, ?, 'instructor', ?, ?, ?, ?, ?)`,
        // user_id is a placeholder (own UUID) until the instructor links a FAS
        // account. Keeps the UNIQUE(tenant_id, user_id) constraint happy.
        [id, S.currentStudio.id, id, name, email, avatarUrl, bio, Date.now()],
      );
      flash(dom['instructor-status'], 'ok', 'Added ' + name + '.');
      document.getElementById('instructor-form').reset();
      await loadInstructors();
    } catch (err) {
      flash(dom['instructor-status'], 'err', String(err));
    }
  });

  document.getElementById('schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFlash(dom['schedule-status']);
    if (!S.currentStudio) return;
    const classTypeId = document.getElementById('schedule-class').value;
    if (!classTypeId) {
      flash(dom['schedule-status'], 'err', 'Pick a class type.');
      return;
    }
    const classType = S.classTypesCache.find((c) => c.id === classTypeId);
    if (!classType) {
      flash(dom['schedule-status'], 'err', 'Class type not found — reload the page.');
      return;
    }

    const dowEls = document.querySelectorAll('#schedule-dow input[type=checkbox]:checked');
    const days = [...dowEls].map((el) => el.value).join(',');
    if (!days) {
      flash(dom['schedule-status'], 'err', 'Pick at least one day of the week.');
      return;
    }

    const startTime = document.getElementById('schedule-time').value;
    if (!/^\d{1,2}:\d{2}$/.test(startTime)) {
      flash(dom['schedule-status'], 'err', 'Start time must be HH:MM.');
      return;
    }
    const capacityRaw = document.getElementById('schedule-capacity').value.trim();
    const capacity = capacityRaw ? parseInt(capacityRaw, 10) : classType.default_capacity;
    if (!Number.isFinite(capacity) || capacity < 1 || capacity > 200) {
      flash(dom['schedule-status'], 'err', 'Capacity must be between 1 and 200.');
      return;
    }
    const location = document.getElementById('schedule-location').value.trim() || null;
    const instructorIdRaw = document.getElementById('schedule-instructor').value;
    const instructorId = instructorIdRaw || null;

    const scheduleId = crypto.randomUUID();
    const now = Date.now();
    const schedule = {
      id: scheduleId,
      class_type_id: classTypeId,
      days_of_week: days,
      start_time: startTime,
      duration_minutes: classType.duration_minutes,
      capacity,
      starts_on: now,
      ends_on: null,
    };

    const timestamps = generateSessionTimestamps(schedule, 4);
    try {
      const statements = [
        {
          sql: `INSERT INTO schedules
                  (id, tenant_id, class_type_id, instructor_id, days_of_week, start_time,
                   duration_minutes, capacity, location, is_virtual, meeting_url,
                   starts_on, ends_on, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, 'active', ?)`,
          params: [
            scheduleId,
            S.currentStudio.id,
            classTypeId,
            instructorId,
            days,
            startTime,
            classType.duration_minutes,
            capacity,
            location,
            now,
            now,
          ],
        },
        ...timestamps.map((ts) => ({
          sql: `INSERT INTO sessions
                  (id, tenant_id, class_type_id, instructor_id, starts_at, ends_at,
                   capacity, location, is_virtual, meeting_url, status, created_at, schedule_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'scheduled', ?, ?)`,
          params: [
            crypto.randomUUID(),
            S.currentStudio.id,
            classTypeId,
            instructorId,
            ts,
            ts + classType.duration_minutes * 60_000,
            capacity,
            location,
            now,
            scheduleId,
          ],
        })),
      ];
      await dbBatch(statements);
      flash(
        dom['schedule-status'],
        'ok',
        'Added schedule — generated ' + timestamps.length + ' sessions for the next 4 weeks.',
      );
      document.getElementById('schedule-form').reset();
      document.getElementById('schedule-time').value = '18:00';
      await Promise.all([loadSchedules(), loadSessions()]);
    } catch (err) {
      flash(dom['schedule-status'], 'err', String(err));
    }
  });
}
