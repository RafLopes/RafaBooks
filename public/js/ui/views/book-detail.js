import { h, mount, toast, confirmDialog, errorMessage, coverColor, formatBytes, pagesLabel, icon, themeChip, themeHue, bookCover, emptyState, plural } from '../dom.js';
import { state, loadBooks, findBook, invalidateBooks, canEdit } from '../store.js';
import { storage } from '../../services/index.js';
import * as repo from '../../services/books-repo.js';

let viewerUrl = null;

export async function renderBookDetail(root, id) {
  await loadBooks();
  const book = findBook(id);
  if (!book) {
    mount(root, emptyState({ glyph: 'library', title: 'Livro não encontrado', action: h('a', { class: 'btn', href: '#/' }, 'Voltar à biblioteca') }));
    return;
  }

  releaseViewer();
  const viewer = h('div', { class: 'viewer', hidden: true });
  const progress = h('progress', { max: 1, value: 0, hidden: true });
  // Visitantes não têm acesso à pasta de PDFs do dono.
  const owner = canEdit();
  const file = owner ? book.file : null;

  async function fetchPdf() {
    progress.hidden = false;
    try {
      return await storage.download(file.fileId, { onProgress: (f) => { progress.value = f; } });
    } finally {
      progress.hidden = true;
    }
  }

  async function view(btn) {
    if (!viewer.hidden) {
      viewer.hidden = true;
      btn.replaceChildren(icon('eye', { size: 16 }), 'Ler PDF');
      return;
    }
    btn.disabled = true;
    try {
      const blob = await fetchPdf();
      releaseViewer();
      viewerUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      mount(viewer, h('iframe', { src: viewerUrl, title: `PDF de ${book.title}` }));
      viewer.hidden = false;
      btn.replaceChildren(icon('x', { size: 16 }), 'Fechar PDF');
      viewer.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function download(btn) {
    btn.disabled = true;
    try {
      const blob = await fetchPdf();
      const url = URL.createObjectURL(blob);
      h('a', { href: url, download: file.name || `${book.title}.pdf` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function remove() {
    const answer = await confirmDialog({
      title: 'Excluir livro?',
      message: `"${book.title}" será removido da biblioteca, junto com o resumo e as ideias. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
      checkbox: file && `Também apagar "${file.name}" da pasta do computador`,
    });
    if (!answer) return;
    try {
      if (file?.fileId && answer.checked) await storage.remove(file.fileId);
      await repo.deleteBook(state.user.uid, book.id);
      invalidateBooks();
      toast('Livro excluído.', 'success');
      location.hash = '#/';
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const ideas = book.ideas ?? [];
  const ideasByTheme = groupBy(ideas, (i) => i.theme || 'Geral');
  const themes = [...ideasByTheme.keys()];

  mount(root,
    h('a', { class: 'back', href: '#/' }, icon('back', { size: 16 }), 'Biblioteca'),
    h('header', { class: 'book-hero' },
      h('div', { class: 'book-hero-bg', style: `background:${book.cover ? `url("${book.cover}") center/cover` : coverColor(book.title)}` }),
      bookCover(book, { size: 'large' }),
      h('div', { class: 'book-meta' },
        h('span', { class: 'eyebrow' }, 'Livro'),
        h('h1', {}, book.title),
        (book.author || book.year) && h('p', { class: 'author' }, [book.author, book.year].filter(Boolean).join(' · ')),
        themes.length > 0 && h('div', { class: 'chips' }, themes.slice(0, 6).map((t) => themeChip(t, { href: `#/themes/${encodeURIComponent(t)}` }))),
        h('div', { class: 'meta-line' },
          h('span', {}, icon('bulb', { size: 14 }), plural(ideas.length, 'ideia', 'ideias')),
          file && h('span', {}, icon('folder', { size: 14 }), `${file.name}${file.size ? ` · ${formatBytes(file.size)}` : ''}`),
          book.analysis?.mode === 'ai' && h('span', {}, icon('sparkles', { size: 14 }), `IA: ${book.analysis.model}`),
        ),
        owner && h('div', { class: 'book-actions' },
          file && h('button', { class: 'btn primary', onclick: (e) => view(e.currentTarget) }, icon('eye', { size: 16 }), 'Ler PDF'),
          ideas.length > 0 && h('a', { class: 'btn', href: `#/lessons/new/${encodeURIComponent(themes[0])}` }, icon('compass', { size: 16 }), 'Gerar lição'),
          h('a', { class: 'btn', href: `#/edit/${book.id}` }, icon('edit', { size: 16 }), 'Editar'),
          file && h('button', { class: 'btn ghost icon-only', title: 'Salvar cópia do PDF', 'aria-label': 'Salvar cópia do PDF', onclick: (e) => download(e.currentTarget) }, icon('download')),
          h('button', { class: 'btn ghost icon-only danger', title: 'Excluir livro', 'aria-label': 'Excluir livro', onclick: remove }, icon('trash')),
        ),
        progress,
      ),
    ),
    viewer,
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, h('span', { class: 'section-icon' }, icon('library', { size: 18 })), 'Resumo')),
      book.summary
        ? h('div', { class: 'prose' }, book.summary.split(/\n{2,}/).map((p) => h('p', {}, p)))
        : h('p', { class: 'muted' }, 'Nenhum resumo cadastrado. ', owner && h('a', { href: `#/edit/${book.id}` }, 'Adicionar resumo')),
    ),
    h('section', {},
      h('div', { class: 'section-title' },
        h('h2', {}, 'Principais ideias'),
        h('span', { class: 'muted small' }, plural(ideas.length, 'ideia', 'ideias')),
      ),
      ideas.length
        ? [...ideasByTheme].map(([theme, list]) => h('div', { class: 'theme-section' },
          h('div', { class: 'theme-section-head' }, themeChip(theme, { href: `#/themes/${encodeURIComponent(theme)}`, count: list.length })),
          h('div', { class: 'ideas-grid' }, list.map((idea) => ideaCard(idea))),
        ))
        : h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Nenhuma ideia cadastrada.')),
    ),
  );
}

/** Cartão de ideia, usado no livro, nos temas e nas lições. */
export function ideaCard(idea, { book } = {}) {
  return h('article', { class: 'idea-card', style: `--hue:${themeHue(idea.theme || 'Geral')}` },
    h('h4', {}, idea.title),
    idea.description && h('p', {}, idea.description),
    idea.quote && h('blockquote', { class: 'quote' }, icon('quote', { size: 16 }), idea.quote),
    h('div', { class: 'idea-foot' },
      book ? h('a', { href: `#/book/${book.id}` }, icon('library', { size: 13 }), ' ', book.title) : h('span', {}),
      h('span', {}, pagesLabel(idea.pages)),
    ),
  );
}

export function releaseViewer() {
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = null;
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}
