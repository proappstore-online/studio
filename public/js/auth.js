// Sign-in flow: OAuth (Google + GitHub), email magic-link, and the
// post-redirect #fas_session= capture. Also sign-out.

import { FAS_API, APP_ID, SESSION_KEY, S, dom } from './state.js';
import { fetchMe } from './api.js';
import { flash, clearFlash } from './flash.js';
import { showSignedIn, showSignin } from './home.js';

export function returnTo() {
  const here = new URL(window.location.href);
  here.hash = '';
  return here.toString();
}

export function startOAuth(provider) {
  const url = new URL('/v1/auth/' + provider + '/start', FAS_API);
  url.searchParams.set('app_id', APP_ID);
  url.searchParams.set('return_to', returnTo());
  window.location.assign(url.toString());
}

/**
 * Look for `#fas_session=…` in the URL (OAuth post-redirect) or a cached
 * session in localStorage. On success: set S.session and render the
 * signed-in view. On failure or absence: stay signed out.
 */
export async function capture() {
  const hash = window.location.hash;
  if (hash.startsWith('#fas_session=')) {
    const token = decodeURIComponent(hash.slice('#fas_session='.length));
    history.replaceState(null, '', window.location.pathname + window.location.search);
    try {
      const user = await fetchMe(token);
      S.session = { token, user };
      localStorage.setItem(SESSION_KEY, JSON.stringify(S.session));
      showSignedIn(user);
      return;
    } catch (err) {
      flash(dom.status, 'err', 'Sign-in failed: ' + err.message);
      return;
    }
  }
  const cached = localStorage.getItem(SESSION_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      const fresh = await fetchMe(parsed.token);
      S.session = { token: parsed.token, user: fresh };
      showSignedIn(fresh);
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }
}

export function bindAuthHandlers() {
  document.getElementById('email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFlash(dom.status);
    const email = document.getElementById('email').value.trim();
    if (!email) return;
    try {
      flash(dom.status, 'ok', 'Sending magic link to ' + email + '…');
      const res = await fetch(FAS_API + '/v1/auth/email/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, appId: APP_ID, returnTo: returnTo() }),
      });
      if (!res.ok) {
        const body = await res.text();
        flash(dom.status, 'err', 'Magic link not available: ' + res.status + ' ' + body);
        return;
      }
      flash(dom.status, 'ok', 'Check your inbox — click the link to sign in.');
    } catch (err) {
      flash(dom.status, 'err', String(err));
    }
  });

  document.getElementById('btn-google').addEventListener('click', () => startOAuth('google'));
  document.getElementById('btn-github').addEventListener('click', () => startOAuth('github'));

  document.getElementById('btn-signout').addEventListener('click', () => {
    localStorage.removeItem(SESSION_KEY);
    showSignin();
  });
}
