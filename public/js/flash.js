// Tiny status-banner helpers shared by every form.

export function flash(el, kind, msg) {
  el.hidden = false;
  el.className = 'status ' + kind;
  el.textContent = msg;
}

export function clearFlash(el) {
  el.hidden = true;
  el.textContent = '';
}
