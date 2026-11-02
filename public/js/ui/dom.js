// Helpers mínimos de DOM. Todo texto entra via textContent (sem innerHTML com dados).

import { icon } from './icons.js';

export { icon };

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') continue; // aplicado depois dos filhos (necessário para <select>)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  if (attrs?.value != null) el.value = attrs.value;
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(target, ...children) {
  target.replaceChildren();
  append(target, children);
}

export function toast(message, type = 'info') {
  const host = document.getElementById('toasts');
  const glyph = { error: 'x', success: 'check' }[type] ?? 'sparkles';
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, icon(glyph, { size: 16 }), h('span', {}, message));
  host.append(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4600);
}

/**
 * Diálogo de confirmação. Sem `checkbox`, resolve true/false.
 * Com `checkbox` (rótulo), resolve false ou { checked }.
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false, checkbox }) {
  return new Promise((resolve) => {
    const box = checkbox && h('input', { type: 'checkbox' });
    const dlg = h('dialog', { class: 'dialog' },
      h('h2', {}, title),
      h('p', {}, message),
      box && h('label', { class: 'check' }, box, checkbox),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', value: 'cancel', onclick: () => dlg.close('cancel') }, 'Cancelar'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => dlg.close('ok') }, confirmLabel),
      ),
    );
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      resolve(box ? ok && { checked: box.checked } : ok);
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function errorMessage(err) {
  if (err?.name === 'AbortError') return 'Operação cancelada.';
  return err?.message || 'Erro inesperado.';
}

function hue(text = '') {
  let hash = 0;
  for (const ch of text.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

/** Capa gerada a partir do título, para livros sem miniatura. */
export function coverColor(title = '') {
  const h1 = hue(title);
  return `linear-gradient(150deg, hsl(${h1} 42% 34%), hsl(${(h1 + 40) % 360} 48% 20%))`;
}

/** Cada tema ganha sempre a mesma cor (via variável CSS --hue). */
export function themeChip(label, { href, count } = {}) {
  const attrs = { class: 'chip theme-chip', style: `--hue:${hue(label)}` };
  const children = [h('span', { class: 'chip-dot' }), label, count != null && h('span', { class: 'chip-count' }, count)];
  return href ? h('a', { ...attrs, href }, children) : h('span', attrs, children);
}

export function themeHue(label) {
  return hue(label);
}

export function bookCover(book, { size = '' } = {}) {
  return book.cover
    ? h('img', { class: `cover ${size}`, src: book.cover, alt: '', loading: 'lazy' })
    : h('div', { class: `cover cover-generated ${size}`, style: `background:${coverColor(book.title)}` },
      h('span', { class: 'cover-title' }, book.title),
      book.author && h('span', { class: 'cover-author' }, book.author));
}

export function emptyState({ glyph = 'library', title, text, action }) {
  return h('section', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(glyph, { size: 32 })),
    h('h1', {}, title),
    text && h('p', {}, text),
    action,
  );
}

export function skeleton() {
  return h('div', { class: 'skeleton-page', 'aria-busy': 'true', 'aria-label': 'Carregando' },
    h('div', { class: 'skeleton sk-title' }),
    h('div', { class: 'skeleton sk-line' }),
    h('div', { class: 'grid' }, Array.from({ length: 6 }, () => h('div', { class: 'skeleton sk-card' }))),
  );
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatBytes(n) {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function pagesLabel(pages) {
  if (!pages?.length) return '';
  return pages.length === 1 ? `p. ${pages[0]}` : `pp. ${pages.join(', ')}`;
}
