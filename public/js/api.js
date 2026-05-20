// API helpers — FAS auth + wellness data worker + PAS Workers AI.
//
// All calls that need an authenticated bearer token read it from S.session.
// Callers should ensure S.session is set first (handled by auth flow).

import { FAS_API, PAS_API, DATA_API, S } from './state.js';

export async function fetchMe(token) {
  const res = await fetch(FAS_API + '/v1/auth/me', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('auth/me: ' + res.status);
  return await res.json();
}

export async function dbQuery(sql, params) {
  if (!S.session) throw new Error('Not signed in.');
  const res = await fetch(DATA_API + '/query', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + S.session.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params: params ?? [] }),
  });
  if (!res.ok) throw new Error('db.query failed: ' + res.status + ' ' + (await res.text()));
  return await res.json();
}

export async function dbExecute(sql, params) {
  if (!S.session) throw new Error('Not signed in.');
  const res = await fetch(DATA_API + '/execute', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + S.session.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params: params ?? [] }),
  });
  if (!res.ok) throw new Error('db.execute failed: ' + res.status + ' ' + (await res.text()));
  return await res.json();
}

export async function dbBatch(statements) {
  if (!S.session) throw new Error('Not signed in.');
  const res = await fetch(DATA_API + '/batch', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + S.session.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ statements }),
  });
  if (!res.ok) throw new Error('db.batch failed: ' + res.status + ' ' + (await res.text()));
  return await res.json();
}

export async function aiGenerate(prompt, opts) {
  if (!S.session) throw new Error('Not signed in.');
  const res = await fetch(PAS_API + '/v1/ai/generate', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + S.session.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, ...(opts || {}) }),
  });
  if (!res.ok) throw new Error('ai.generate failed: ' + res.status + ' ' + (await res.text()));
  return await res.json();
}
