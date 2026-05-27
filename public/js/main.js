// Entry point. Dispatches by URL path to one of:
//   /              → capture() — sign-in or signed-in dashboard
//   /<slug>        → renderPublicStudio(slug) — public studio page
//   /<slug>/admin  → renderAdmin(slug) — owner admin
//   otherwise      → notfound view
//
// Page is delivered as a single index.html; CF Pages _redirects sends every
// non-asset path back to it. JS reads window.location.pathname to decide.

import { dom } from './state.js';
import { bindAuthHandlers, capture } from './auth.js';
import { bindHomeHandlers, loadDirectory } from './home.js';
import { bindAdminHandlers, renderAdmin } from './admin.js';
import { renderPublicStudio } from './public-page.js';

bindAuthHandlers();
bindHomeHandlers();
bindAdminHandlers();

function route() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (path === '') return { kind: 'home' };
  const parts = path.split('/');
  const slugRe = /^[a-z0-9][a-z0-9-]{0,60}$/;
  if (parts.length === 1 && slugRe.test(parts[0])) {
    return { kind: 'public', slug: parts[0] };
  }
  if (parts.length === 2 && slugRe.test(parts[0]) && parts[1] === 'admin') {
    return { kind: 'admin', slug: parts[0] };
  }
  return { kind: 'notfound' };
}

const r = route();
if (r.kind === 'home') {
  capture();
  loadDirectory();
} else if (r.kind === 'public') {
  renderPublicStudio(r.slug);
} else if (r.kind === 'admin') {
  renderAdmin(r.slug);
} else {
  dom['home-header'].hidden = true;
  dom['landing-section'].hidden = true;
  dom['signin-view'].hidden = true;
  dom['notfound-view'].hidden = false;
}
