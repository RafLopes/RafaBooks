import { h, mount, icon, themeChip, themeHue, bookCover, emptyState, plural, pagesLabel } from '../dom.js';
import { loadBooks, loadLessons, canEdit } from '../store.js';
import { collectThemes } from '../../services/books-repo.js';

export async function renderLibrary(root) {
  const books = await loadBooks();
  const lessons = await loadLessons().catch(() => []);

  if (!books.length) {
    mount(root, canEdit()
      ? emptyState({
        glyph: 'library',
        title: 'Sua estante está vazia',
        text: 'Adicione o primeiro livro: vincule o PDF e cadastre o resumo e as ideias — à mão ou com IA.',
        action: h('a', { class: 'btn primary large', href: '#/new' }, icon('plus'), 'Adicionar livro'),
      })
      : emptyState({ glyph: 'library', title: 'A estante ainda está vazia', text: 'Volte em breve para ver os livros cadastrados.' }));
    return;
  }

  const allIdeas = books.flatMap((book) => (book.ideas ?? []).map((idea) => ({ idea, book })));
  const themes = collectThemes(books);

  // ---------- hero ----------
  const daily = h('article', { class: 'daily' });
  let pick = dailyIndex(allIdeas.length);
  function drawDaily() {
    if (!allIdeas.length) {
      mount(daily,
        h('span', { class: 'eyebrow' }, 'Ideia do dia'),
        h('p', {}, 'Cadastre ideias nos seus livros e uma delas aparecerá aqui todos os dias.'));
      return;
    }
    const { idea, book } = allIdeas[pick];
    daily.style.setProperty('--hue', themeHue(idea.theme || 'Geral'));
    mount(daily,
      h('div', { class: 'row between' },
        h('span', { class: 'eyebrow' }, icon('sparkles', { size: 14 }), ' Ideia do dia'),
        allIdeas.length > 1 && h('button', {
          class: 'btn ghost icon-only small',
          title: 'Outra ideia',
          'aria-label': 'Mostrar outra ideia',
          onclick: () => { pick = (pick + 1 + Math.floor(Math.random() * (allIdeas.length - 1))) % allIdeas.length; drawDaily(); },
        }, icon('shuffle', { size: 16 })),
      ),
      h('h2', {}, idea.title),
      idea.description && h('p', {}, idea.description),
      idea.quote && h('blockquote', { class: 'quote' }, icon('quote', { size: 16 }), idea.quote),
      h('div', { class: 'daily-foot' },
        themeChip(idea.theme || 'Geral', { href: `#/themes/${encodeURIComponent(idea.theme || 'Geral')}` }),
        h('a', { href: `#/book/${book.id}`, class: 'small' }, book.title, idea.pages?.length ? ` · ${pagesLabel(idea.pages)}` : '', ' →'),
      ),
    );
  }
  drawDaily();

  const stat = (n, label, href) => h(href ? 'a' : 'div', { class: 'stat', href }, h('strong', {}, n), h('span', {}, label));

  // ---------- estante ----------
  const grid = h('div', { class: 'grid' });
  const search = h('input', {
    type: 'search',
    class: 'input',
    placeholder: 'Buscar por título, autor ou tema…',
    'aria-label': 'Buscar livros',
    oninput: draw,
  });
  let activeTheme = null;
  const topThemes = topBy(allIdeas.map((x) => x.idea.theme || 'Geral'), 8);
  const filters = h('div', { class: 'filter-chips', role: 'toolbar', 'aria-label': 'Filtrar por tema' });

  function drawFilters() {
    mount(filters,
      [null, ...topThemes].map((t) => h('button', {
        type: 'button',
        class: `filter-chip ${activeTheme === t ? 'active' : ''}`,
        'aria-pressed': String(activeTheme === t),
        onclick: () => { activeTheme = t; drawFilters(); draw(); },
      }, t ?? 'Todos')),
    );
  }

  function draw() {
    const t = search.value.trim().toLowerCase();
    const list = books.filter((b) => {
      const bookThemes = (b.ideas ?? []).map((i) => (i.theme || 'Geral').toLowerCase());
      if (activeTheme && !bookThemes.includes(activeTheme.toLowerCase())) return false;
      return !t || [b.title, b.author, ...bookThemes].some((v) => v?.toLowerCase().includes(t));
    });
    mount(grid, list.length ? list.map(bookCard) : h('p', { class: 'muted' }, 'Nenhum livro encontrado.'));
  }

  mount(root,
    h('section', { class: 'hero' },
      h('div', { class: 'hero-text' },
        h('span', { class: 'eyebrow' }, greeting()),
        h('h1', {}, 'O que vamos aprender hoje?'),
        h('p', {}, canEdit()
          ? 'Revisite as ideias dos seus livros, explore por tema e transforme leitura em prática com as lições.'
          : 'Explore as ideias destes livros por tema e aprenda com as lições práticas tiradas deles.'),
        h('div', { class: 'stats' },
          stat(books.length, books.length === 1 ? 'livro' : 'livros'),
          stat(allIdeas.length, allIdeas.length === 1 ? 'ideia' : 'ideias', '#/themes'),
          stat(themes.length, themes.length === 1 ? 'tema' : 'temas', '#/themes'),
          stat(lessons.length, lessons.length === 1 ? 'lição' : 'lições', '#/lessons'),
        ),
      ),
      daily,
    ),
    h('div', { class: 'section-title' },
      h('h2', {}, canEdit() ? 'Sua estante' : 'Estante'),
      h('span', { class: 'muted small' }, plural(books.length, 'livro', 'livros')),
    ),
    h('div', { class: 'toolbar' }, h('div', { class: 'search-box' }, icon('search'), search)),
    topThemes.length > 1 && h('div', { class: 'toolbar' }, filters),
    grid,
  );
  drawFilters();
  draw();
}

function bookCard(book) {
  const ideas = book.ideas ?? [];
  const themes = topBy(ideas.map((i) => i.theme || 'Geral'), 2);
  return h('a', { class: 'book-card', href: `#/book/${book.id}` },
    h('div', { class: 'cover-wrap' }, bookCover(book)),
    h('div', { class: 'book-card-body' },
      h('h3', {}, book.title),
      book.author && h('p', { class: 'muted small' }, book.author),
      h('div', { class: 'chips' },
        themes.map((t) => themeChip(t)),
        !ideas.length && h('span', { class: 'chip' }, book.summary ? 'Só resumo' : 'Sem resumo'),
      ),
    ),
  );
}

/** Os N valores mais frequentes (sem diferenciar maiúsculas). */
function topBy(values, n) {
  const counts = new Map();
  for (const v of values) {
    const k = v.toLowerCase();
    const cur = counts.get(k) ?? { label: v, n: 0 };
    cur.n++;
    counts.set(k, cur);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, n).map((c) => c.label);
}

function dailyIndex(len) {
  if (!len) return 0;
  const d = new Date();
  const seed = d.getFullYear() * 1000 + Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86_400_000);
  return (seed * 2654435761 >>> 0) % len;
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'Boa madrugada' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
}
