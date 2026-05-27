// Signed-in dashboard: list of studios, create-studio form with AI suggest,
// inline edit per card. Triggered by capture() once a session exists.

import { DATA_API, S, dom } from './state.js';
import { dbQuery, dbExecute, aiGenerate } from './api.js';
import { flash, clearFlash } from './flash.js';

export function showSignedIn(user) {
  dom.whoName.textContent = user.login || 'unknown';
  dom.avatar.replaceChildren();
  if (user.avatarUrl) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = user.avatarUrl;
    dom.avatar.appendChild(img);
  } else {
    dom.avatar.textContent = (user.login || '?').slice(0, 1).toUpperCase();
  }
  dom.signinView.hidden = true;
  dom['landing-section'].hidden = true;
  dom['directory-view'].hidden = true;
  dom['signed-in-view'].hidden = false;
  loadStudios().catch((err) => flash(dom['create-status'], 'err', String(err)));
}

export function showSignin() {
  dom['signed-in-view'].hidden = true;
  dom.signinView.hidden = false;
  dom['landing-section'].hidden = false;
  dom['directory-view'].hidden = true;
  S.session = null;
}

export async function loadDirectory() {
  try {
    const res = await fetch(DATA_API + '/public/studios?limit=50');
    if (!res.ok) return;
    const rows = await res.json();
    const list = dom['directory-list'];
    const empty = dom['directory-empty'];
    list.replaceChildren();
    if (!Array.isArray(rows) || rows.length === 0) {
      empty.hidden = false;
      list.hidden = true;
      dom['directory-view'].hidden = false;
      return;
    }
    empty.hidden = true;
    list.hidden = false;
    for (const r of rows) {
      const a = document.createElement('a');
      a.className = 'directory-card';
      a.href = '/' + r.slug;
      const strong = document.createElement('strong');
      strong.textContent = r.name;
      a.appendChild(strong);
      if (r.description) {
        const p = document.createElement('p');
        p.textContent = r.description;
        a.appendChild(p);
      }
      const small = document.createElement('small');
      small.textContent = [r.timezone, r.currency].filter(Boolean).join(' · ');
      a.appendChild(small);
      list.appendChild(a);
    }
    dom['directory-view'].hidden = false;
  } catch { /* ignore */ }
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function loadStudios() {
  if (!S.session) return;
  const { rows } = await dbQuery(
    'SELECT id, slug, name, description, timezone, currency, created_at FROM studios WHERE owner_user_id = ? ORDER BY created_at DESC',
    [S.session.user.id],
  );
  renderStudios(rows);
}

function renderStudios(rows) {
  dom['studios-list'].replaceChildren();
  if (!rows || rows.length === 0) {
    dom['studios-empty'].hidden = false;
    dom['studios-list'].hidden = true;
    return;
  }
  dom['studios-empty'].hidden = true;
  dom['studios-list'].hidden = false;
  for (const r of rows) {
    dom['studios-list'].appendChild(renderCard(r));
  }
}

function renderCard(r) {
  const li = document.createElement('li');
  li.className = 'studio-card';
  li.dataset.id = r.id;

  const strong = document.createElement('strong');
  strong.textContent = r.name;
  const small = document.createElement('small');
  small.textContent =
    '/' + r.slug + ' · ' + (r.timezone || 'UTC') + ' · ' + (r.currency || 'AUD');
  li.appendChild(strong);
  li.appendChild(small);
  if (r.description) {
    const p = document.createElement('p');
    p.textContent = r.description;
    li.appendChild(p);
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'card-btn btn-edit';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => beginEdit(li, r));
  actions.appendChild(editBtn);

  const manageLink = document.createElement('a');
  manageLink.href = '/' + r.slug + '/admin';
  manageLink.textContent = 'Manage →';
  actions.appendChild(manageLink);

  const publicLink = document.createElement('a');
  publicLink.href = '/' + r.slug;
  publicLink.textContent = 'View public page →';
  publicLink.target = '_blank';
  publicLink.rel = 'noopener';
  actions.appendChild(publicLink);

  li.appendChild(actions);
  return li;
}

function labeled(text, input) {
  const wrap = document.createElement('div');
  wrap.style.display = 'grid';
  wrap.style.gap = '.25rem';
  const lbl = document.createElement('label');
  lbl.textContent = text;
  lbl.style.fontSize = '.8rem';
  lbl.style.color = 'var(--muted)';
  wrap.appendChild(lbl);
  wrap.appendChild(input);
  return wrap;
}

function beginEdit(li, r) {
  li.replaceChildren();

  const form = document.createElement('form');
  form.className = 'edit-form';
  form.addEventListener('submit', (e) => e.preventDefault());

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'edit-name';
  nameInput.value = r.name;
  nameInput.required = true;
  nameInput.maxLength = 80;
  form.appendChild(labeled('Name', nameInput));

  const descInput = document.createElement('textarea');
  descInput.className = 'edit-description';
  descInput.value = r.description ?? '';
  descInput.maxLength = 280;
  descInput.placeholder = 'Short description (optional)';
  form.appendChild(labeled('Description', descInput));

  const tzInput = document.createElement('input');
  tzInput.type = 'text';
  tzInput.className = 'edit-tz';
  tzInput.value = r.timezone ?? 'UTC';
  tzInput.maxLength = 40;

  const currencyInput = document.createElement('input');
  currencyInput.type = 'text';
  currencyInput.className = 'edit-currency';
  currencyInput.value = r.currency ?? 'AUD';
  currencyInput.maxLength = 3;

  const row = document.createElement('div');
  row.className = 'row';
  row.appendChild(labeled('Timezone', tzInput));
  row.appendChild(labeled('Currency', currencyInput));
  form.appendChild(row);

  const btns = document.createElement('div');
  btns.className = 'btn-row';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn-save';
  save.textContent = 'Save';
  save.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const description = descInput.value.trim() || null;
    const timezone = tzInput.value.trim() || 'UTC';
    const currency = (currencyInput.value.trim() || 'AUD').toUpperCase();

    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      await dbExecute(
        `UPDATE studios SET name = ?, description = ?, timezone = ?, currency = ?
         WHERE id = ? AND owner_user_id = ?`,
        [name, description, timezone, currency, r.id, S.session.user.id],
      );
      await loadStudios();
    } catch (err) {
      flash(dom['create-status'], 'err', String(err));
      save.disabled = false;
      save.textContent = 'Save';
    }
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-cancel';
  cancel.style.background = 'white';
  cancel.style.color = 'var(--fg)';
  cancel.style.border = '1px solid var(--border)';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    loadStudios();
  });
  btns.appendChild(save);
  btns.appendChild(cancel);
  form.appendChild(btns);

  li.appendChild(form);
  nameInput.focus();
}

export function bindHomeHandlers() {
  document.getElementById('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFlash(dom['create-status']);
    if (!S.session) return;
    const name = document.getElementById('studio-name').value.trim();
    if (!name) return;
    const description = document.getElementById('studio-description').value.trim() || null;
    const timezone = document.getElementById('studio-tz').value.trim() || 'UTC';
    const currency =
      (document.getElementById('studio-currency').value.trim() || 'AUD').toUpperCase();
    const brandColor = document.getElementById('studio-brand-color').value || null;

    const id = crypto.randomUUID();
    const slug = slugify(name) || id.slice(0, 8);

    try {
      flash(dom['create-status'], 'ok', 'Creating ' + name + '…');
      await dbExecute(
        `INSERT INTO studios (id, slug, name, description, owner_user_id, timezone, currency, brand_color, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, slug, name, description, S.session.user.id, timezone, currency, brandColor, Date.now()],
      );
      flash(dom['create-status'], 'ok', 'Created ' + name + '. It now appears in your studios.');
      document.getElementById('create-form').reset();
      await loadStudios();
    } catch (err) {
      const msg = String(err);
      if (msg.includes('UNIQUE constraint failed: studios.slug')) {
        flash(
          dom['create-status'],
          'err',
          'A studio with the slug "' + slug + '" already exists — pick a different name.',
        );
      } else {
        flash(dom['create-status'], 'err', msg);
      }
    }
  });

  document.getElementById('btn-ai-describe').addEventListener('click', async () => {
    clearFlash(dom['create-status']);
    if (!S.session) return;
    const name = document.getElementById('studio-name').value.trim();
    if (!name) {
      flash(
        dom['create-status'],
        'err',
        'Type a studio name first, then I can suggest a description.',
      );
      return;
    }
    const btn = document.getElementById('btn-ai-describe');
    const ta = document.getElementById('studio-description');
    btn.disabled = true;
    btn.textContent = '✨ Thinking…';
    try {
      const { text } = await aiGenerate(
        `Write one short marketing tagline (max 200 characters, no quotes, no preamble) for a wellness studio called "${name}". It should sound warm and inviting, not corporate.`,
        { maxTokens: 80, temperature: 0.8 },
      );
      const cleaned = text.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 280);
      ta.value = cleaned;
      ta.focus();
    } catch (err) {
      flash(dom['create-status'], 'err', String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ AI suggest';
    }
  });
}
