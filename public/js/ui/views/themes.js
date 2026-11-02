import { h, mount, icon, themeHue, emptyState, plural } from '../dom.js';
import { loadBooks, canEdit } from '../store.js';
import { ideaCard } from './book-detail.js';

// Tela de ideias agrupadas por tema, atravessando todos os livros.
export async function renderThemes(root, selected) {
  const books = await loadBooks();

  // Agrupa sem diferenciar maiúsculas/minúsculas, mantendo o primeiro rótulo visto.
  const themes = new Map();
  for (const book of books) {
    for (const idea of book.ideas ?? []) {
      const label = idea.theme?.trim() || 'Geral';
      const key = label.toLowerCase();
      if (!themes.has(key)) themes.set(key, { label, items: [], books: new Set() });
      const g = themes.get(key);
      g.items.push({ idea, book });
      g.books.add(book.id);
    }
  }

  if (!themes.size) {
    mount(root, emptyState({
      glyph: 'layers',
      title: 'Nenhuma ideia ainda',
      text: 'Cadastre ideias nos seus livros para vê-las organizadas por tema aqui.',
      action: h('a', { class: 'btn primary', href: '#/' }, 'Ir para a biblioteca'),
    }));
    return;
  }

  const sorted = [...themes.values()].sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'pt-BR'));
  const current = selected ? themes.get(selected.toLowerCase()) : null;
  const total = sorted.reduce((n, g) => n + g.items.length, 0);
  const list = h('div', {});
  const search = h('input', {
    type: 'search',
    class: 'input',
    placeholder: 'Buscar nas ideias…',
    'aria-label': 'Buscar ideias',
    oninput: () => draw(search.value),
  });

  function draw(term = '') {
    const t = term.trim().toLowerCase();
    const groups = (current ? [current] : sorted).map((g) => ({
      ...g,
      items: t ? g.items.filter(({ idea, book }) => [idea.title, idea.description, idea.quote, book.title].some((v) => v?.toLowerCase().includes(t))) : g.items,
    })).filter((g) => g.items.length);

    mount(list, groups.length
      ? groups.map((g) => h('section', { class: 'theme-section' },
        h('div', { class: 'theme-section-head' },
          h('h2', { style: `--hue:${themeHue(g.label)}` }, h('span', { class: 'dot-hue' }), g.label, h('span', { class: 'count' }, g.items.length)),
          canEdit() && h('a', { class: 'btn small', href: `#/lessons/new/${encodeURIComponent(g.label)}` }, icon('compass', { size: 15 }), 'Gerar lição'),
        ),
        h('div', { class: 'ideas-grid' }, g.items.map(({ idea, book }) => ideaCard(idea, { book }))),
      ))
      : h('p', { class: 'muted' }, 'Nenhuma ideia encontrada.'));
  }

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('span', { class: 'eyebrow' }, 'Explorar'),
        h('h1', {}, current ? current.label : 'Ideias por tema'),
        h('p', { class: 'muted' }, current
          ? `${plural(current.items.length, 'ideia', 'ideias')} de ${plural(current.books.size, 'livro', 'livros')}`
          : `${plural(total, 'ideia', 'ideias')} em ${plural(sorted.length, 'tema', 'temas')}`),
      ),
    ),
    h('div', { class: 'theme-layout' },
      h('nav', { class: 'theme-nav', 'aria-label': 'Temas' },
        h('a', { href: '#/themes', class: current ? '' : 'active' }, h('span', { class: 'name' }, 'Todos os temas'), h('span', { class: 'count' }, total)),
        sorted.map((g) => h('a', {
          href: `#/themes/${encodeURIComponent(g.label)}`,
          class: current === g ? 'active' : '',
          style: `--hue:${themeHue(g.label)}`,
        }, h('span', { class: 'dot-hue' }), h('span', { class: 'name' }, g.label), h('span', { class: 'count' }, g.items.length))),
      ),
      h('div', {},
        h('div', { class: 'toolbar' }, h('div', { class: 'search-box' }, icon('search'), search)),
        list,
      ),
    ),
  );
  draw();
}
