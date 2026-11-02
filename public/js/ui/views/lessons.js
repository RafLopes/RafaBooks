// Lições para a vida: ideias dos livros transformadas em leitura prática por tema.

import { h, mount, toast, confirmDialog, errorMessage, icon, themeChip, themeHue, emptyState, plural, pagesLabel } from '../dom.js';
import { state, loadBooks, loadLessons, findLesson, invalidateLessons, canEdit } from '../store.js';
import { aiClient } from '../../services/index.js';
import * as repo from '../../services/lessons-repo.js';
import * as share from '../../services/share-repo.js';
import { generateLesson, toCitation, DEPTHS } from '../../services/ai/lesson-generator.js';
import { hasApiKey, getModel } from '../../services/ai/api-key-store.js';

// Rascunho ainda não salvo (gerado por IA ou manual), aberto em #/lessons/draft/edit.
let draft = null;

/** Temas -> ideias, agrupando sem diferenciar maiúsculas. */
function themeIndex(books) {
  const map = new Map();
  for (const book of books) {
    for (const idea of book.ideas ?? []) {
      const label = idea.theme?.trim() || 'Geral';
      const key = label.toLowerCase();
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key).items.push({ idea, book });
    }
  }
  return [...map.values()].sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'pt-BR'));
}

const paragraphs = (text) => String(text ?? '').split(/\n{2,}/).filter((p) => p.trim()).map((p) => h('p', {}, p));

// =========================================================
// Lista
// =========================================================
export async function renderLessonList(root) {
  const [books, lessons] = await Promise.all([loadBooks(), loadLessons()]);
  const themes = themeIndex(books);

  const owner = canEdit();
  const suggestions = owner ? themes.slice(0, 8).map((t) => themeChip(t.label, { href: `#/lessons/new/${encodeURIComponent(t.label)}`, count: t.items.length })) : [];

  if (!lessons.length && !owner) {
    mount(root, emptyState({ glyph: 'compass', title: 'Nenhuma lição ainda', text: 'Volte em breve para ler as lições criadas a partir destes livros.' }));
    return;
  }

  if (!lessons.length) {
    mount(root, emptyState({
      glyph: 'compass',
      title: 'Transforme leitura em prática',
      text: themes.length
        ? 'Escolha um tema e o RafaBooks monta uma lição com as ideias dos seus livros, citando as passagens, com exercícios e perguntas de reflexão.'
        : 'Cadastre ideias nos seus livros primeiro; depois volte aqui para criar lições por tema.',
      action: themes.length
        ? h('div', { class: 'stack' },
          h('div', {}, h('a', { class: 'btn primary large', href: '#/lessons/new' }, icon('sparkles'), 'Criar primeira lição')),
          h('div', { class: 'chips', style: 'justify-content:center' }, suggestions))
        : h('a', { class: 'btn primary', href: '#/' }, 'Ir para a biblioteca'),
    }));
    return;
  }

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {},
        h('span', { class: 'eyebrow' }, 'Aprender'),
        h('h1', {}, 'Lições para a vida'),
        h('p', { class: 'muted' }, `${plural(lessons.length, 'lição', 'lições')} criadas a partir ${owner ? 'dos seus livros' : 'dos livros da estante'}`),
      ),
      owner && h('a', { class: 'btn primary', href: '#/lessons/new' }, icon('plus', { size: 16 }), 'Nova lição'),
    ),
    suggestions.length > 0 && h('div', { class: 'toolbar' },
      h('span', { class: 'muted small' }, 'Criar sobre:'),
      h('div', { class: 'chips' }, suggestions),
    ),
    h('div', { class: 'lesson-list' }, lessons.map((l) => h('a', {
      class: 'lesson-card',
      href: `#/lessons/${l.id}`,
      style: `--hue:${themeHue(l.themes?.[0] ?? '')}`,
    },
    h('div', { class: 'chips' }, (l.themes ?? []).slice(0, 3).map((t) => themeChip(t))),
    h('h3', {}, l.title),
    l.intro && h('p', {}, l.intro.split(/\n{2,}/)[0]),
    h('span', { class: 'muted small' },
      plural(l.steps?.length ?? 0, 'lição', 'lições'), ' · ',
      plural(new Set((l.steps ?? []).flatMap((s) => (s.citations ?? []).map((c) => c.bookId))).size, 'livro citado', 'livros citados')),
    ))),
  );
}

// =========================================================
// Composição (escolher temas e gerar)
// =========================================================
export async function renderLessonComposer(root, preselected) {
  const books = await loadBooks();
  const themes = themeIndex(books);
  if (!themes.length) {
    mount(root, emptyState({ glyph: 'bulb', title: 'Ainda não há ideias', text: 'Cadastre ideias nos seus livros para criar lições.', action: h('a', { class: 'btn primary', href: '#/' }, 'Ir para a biblioteca') }));
    return;
  }

  const selected = new Set(preselected ? [preselected.toLowerCase()] : []);
  const picker = h('div', { class: 'theme-picker', role: 'group', 'aria-label': 'Temas' });
  const summary = h('p', { class: 'muted small' });
  const focus = h('input', { class: 'input', maxlength: 200, placeholder: 'Opcional — ex.: como lidar melhor com a ansiedade no trabalho' });
  const depth = h('select', { class: 'input', 'aria-label': 'Profundidade', value: 'full' },
    Object.entries(DEPTHS).map(([k, d]) => h('option', { value: k }, d.label)));
  const progress = h('div', { class: 'ai-progress', hidden: true }, h('progress'), h('span', { class: 'small' }, 'Escrevendo a lição… isso leva de 20 a 60 segundos.'));
  const generateBtn = h('button', { type: 'button', class: 'btn primary large', onclick: generate }, icon('sparkles'), 'Gerar lição com IA');
  const cancelBtn = h('button', { type: 'button', class: 'btn ghost', hidden: true }, 'Cancelar');
  let controller = null;

  function selectedItems() {
    return themes.filter((t) => selected.has(t.label.toLowerCase())).flatMap((t) => t.items);
  }

  function draw() {
    mount(picker, themes.map((t) => h('button', {
      type: 'button',
      class: 'theme-toggle',
      style: `--hue:${themeHue(t.label)}`,
      'aria-pressed': String(selected.has(t.label.toLowerCase())),
      onclick: () => {
        const k = t.label.toLowerCase();
        if (selected.has(k)) selected.delete(k); else selected.add(k);
        draw();
      },
    }, h('span', { class: 'dot-hue' }), t.label, h('span', { class: 'count' }, t.items.length))));

    const items = selectedItems();
    const bookCount = new Set(items.map((i) => i.book.id)).size;
    const quoted = items.filter((i) => i.idea.quote).length;
    summary.textContent = items.length
      ? `${plural(items.length, 'ideia', 'ideias')} de ${plural(bookCount, 'livro', 'livros')} · ${plural(quoted, 'com citação literal', 'com citação literal')}`
      : 'Selecione um ou mais temas.';
    generateBtn.disabled = !items.length || !hasApiKey() || Boolean(controller);
  }

  async function generate() {
    const items = selectedItems();
    const labels = themes.filter((t) => selected.has(t.label.toLowerCase())).map((t) => t.label);
    controller = new AbortController();
    cancelBtn.onclick = () => controller.abort();
    progress.hidden = false;
    cancelBtn.hidden = false;
    draw();
    try {
      const model = getModel();
      const lesson = await generateLesson({
        items, themes: labels, focus: focus.value.trim(), depth: depth.value, client: aiClient, model, signal: controller.signal,
      });
      draft = { ...lesson, themes: labels, focus: focus.value.trim(), analysis: { mode: 'ai', model, generatedAt: new Date().toISOString() } };
      location.hash = '#/lessons/draft/edit';
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      controller = null;
      progress.hidden = true;
      cancelBtn.hidden = true;
      if (location.hash !== '#/lessons/draft/edit') draw();
    }
  }

  function manual() {
    const labels = themes.filter((t) => selected.has(t.label.toLowerCase())).map((t) => t.label);
    draft = {
      title: '', intro: '', closing: '', themes: labels, focus: focus.value.trim(),
      steps: [{ id: crypto.randomUUID(), title: '', text: '', practice: '', question: '', citations: [] }],
      analysis: { mode: 'manual' },
    };
    location.hash = '#/lessons/draft/edit';
  }

  mount(root,
    h('a', { class: 'back', href: '#/lessons' }, icon('back', { size: 16 }), 'Lições'),
    h('div', { class: 'page-head' },
      h('div', {},
        h('span', { class: 'eyebrow' }, 'Nova lição'),
        h('h1', {}, 'Sobre o que você quer aprender?'),
        h('p', { class: 'muted' }, 'A lição usa as ideias e citações já salvas nos seus livros — os PDFs não são relidos, então é rápido e barato.'),
      ),
    ),
    h('section', { class: 'panel stack' },
      h('div', { class: 'panel-head' }, h('h2', {}, h('span', { class: 'section-icon' }, icon('layers', { size: 18 })), 'Temas')),
      picker,
      summary,
    ),
    h('section', { class: 'panel stack' },
      h('div', { class: 'panel-head' }, h('h2', {}, h('span', { class: 'section-icon' }, icon('target', { size: 18 })), 'Foco')),
      h('label', { class: 'field' }, h('span', {}, 'Uma pergunta ou situação da sua vida'), focus),
      h('label', { class: 'field', style: 'max-width:280px' }, h('span', {}, 'Profundidade'), depth),
    ),
    h('section', { class: 'ai-box stack' },
      !hasApiKey() && h('p', { class: 'muted' }, 'Para gerar com IA, configure a chave do OpenRouter em ', h('a', { href: '#/settings' }, 'Ajustes'), '. Você também pode escrever a lição à mão.'),
      h('div', { class: 'row wrap' },
        generateBtn,
        h('button', { type: 'button', class: 'btn', onclick: manual }, icon('edit', { size: 16 }), 'Escrever manualmente'),
        cancelBtn,
      ),
      progress,
      hasApiKey() && h('p', { class: 'muted small' }, `Modelo: ${getModel()}. Nada é salvo até você revisar.`),
    ),
  );
  draw();
}

// =========================================================
// Editor (rascunho ou lição salva)
// =========================================================
export async function renderLessonEditor(root, id) {
  const books = await loadBooks();
  let source;
  if (id === 'draft') {
    source = draft;
    if (!source) {
      location.hash = '#/lessons/new';
      return;
    }
  } else {
    await loadLessons();
    source = findLesson(id);
    if (!source) {
      mount(root, emptyState({ glyph: 'compass', title: 'Lição não encontrada', action: h('a', { class: 'btn', href: '#/lessons' }, 'Voltar') }));
      return;
    }
  }

  const themeItems = themeIndex(books);
  const relevant = themeItems.filter((t) => !source.themes?.length || source.themes.some((x) => x.toLowerCase() === t.label.toLowerCase()));
  const citable = (relevant.length ? relevant : themeItems).flatMap((t) => t.items);

  const title = h('input', { class: 'input', placeholder: 'Título da lição', value: source.title ?? '', maxlength: 120 });
  const intro = h('textarea', { class: 'input', rows: 5, placeholder: 'Introdução', value: source.intro ?? '' });
  const closing = h('input', { class: 'input', placeholder: 'Frase final para levar consigo', value: source.closing ?? '', maxlength: 400 });
  const stepsBox = h('div', { class: 'stack' });

  function stepEditor(step) {
    const citations = [...(step.citations ?? [])];
    const citeList = h('div', { class: 'cite-list' });
    const drawCites = () => mount(citeList, citations.map((c, i) => h('span', { class: 'chip' },
      icon('quote', { size: 12 }), `${c.bookTitle} — ${c.ideaTitle}`,
      h('button', { type: 'button', class: 'link', 'aria-label': 'Remover citação', onclick: () => { citations.splice(i, 1); drawCites(); } }, icon('x', { size: 12 })),
    )));
    const add = h('select', {
      class: 'input',
      'aria-label': 'Adicionar citação',
      onchange: () => {
        const it = citable[Number(add.value)];
        if (it) citations.push(toCitation(it));
        add.value = '';
        drawCites();
      },
    },
    h('option', { value: '' }, 'Adicionar citação de uma ideia…'),
    citable.map((it, i) => h('option', { value: String(i) }, `${it.idea.quote ? '❝ ' : ''}${it.book.title} — ${it.idea.title}`)),
    );
    drawCites();

    const el = h('div', { class: 'lesson-edit' },
      h('div', { class: 'row' },
        h('input', { class: 'input', name: 'title', placeholder: 'A lição em uma frase', value: step.title ?? '' }),
        h('button', { type: 'button', class: 'btn ghost icon-only small', title: 'Remover lição', 'aria-label': 'Remover lição', onclick: () => el.remove() }, icon('trash', { size: 16 })),
      ),
      h('textarea', { class: 'input', name: 'text', rows: 5, placeholder: 'Explicação', value: step.text ?? '' }),
      h('textarea', { class: 'input', name: 'practice', rows: 2, placeholder: 'Na prática: exercício ou ação para esta semana', value: step.practice ?? '' }),
      h('input', { class: 'input', name: 'question', placeholder: 'Pergunta para refletir', value: step.question ?? '' }),
      citeList,
      add,
    );
    el.readStep = () => {
      const get = (n) => el.querySelector(`[name="${n}"]`).value.trim();
      return { id: step.id ?? crypto.randomUUID(), title: get('title'), text: get('text'), practice: get('practice'), question: get('question'), citations };
    };
    return el;
  }

  mount(stepsBox, (source.steps ?? []).map(stepEditor));
  const saveBtn = h('button', { type: 'submit', class: 'btn primary' }, icon('check', { size: 16 }), 'Salvar lição');

  async function save(e) {
    e.preventDefault();
    const steps = [...stepsBox.children].map((el) => el.readStep()).filter((s) => s.title || s.text);
    if (!title.value.trim()) {
      title.focus();
      toast('Dê um título à lição.', 'error');
      return;
    }
    const data = {
      title: title.value.trim(),
      intro: intro.value.trim(),
      closing: closing.value.trim(),
      themes: source.themes ?? [],
      focus: source.focus ?? '',
      steps,
      analysis: source.analysis ?? { mode: 'manual' },
    };
    saveBtn.disabled = true;
    try {
      const uid = state.user.uid;
      let lessonId = id;
      if (id === 'draft') {
        lessonId = repo.newLessonId(uid);
        await repo.createLesson(uid, lessonId, data);
        draft = null;
      } else {
        await repo.updateLesson(uid, id, data);
        // Mantém o link compartilhado com a versão nova.
        if (source.shareId) {
          await share.publishLesson(uid, { ...data, shareId: source.shareId })
            .catch(() => toast('Lição salva, mas o link compartilhado não foi atualizado.', 'error'));
        }
      }
      invalidateLessons();
      toast('Lição salva.', 'success');
      location.hash = `#/lessons/${lessonId}`;
    } catch (err) {
      toast(errorMessage(err), 'error');
      saveBtn.disabled = false;
    }
  }

  const isDraft = id === 'draft';
  mount(root,
    h('a', { class: 'back', href: isDraft ? '#/lessons/new' : `#/lessons/${id}` }, icon('back', { size: 16 }), isDraft ? 'Voltar aos temas' : 'Voltar à lição'),
    h('div', { class: 'page-head' },
      h('div', {},
        h('span', { class: 'eyebrow' }, isDraft ? 'Revisar antes de salvar' : 'Editar lição'),
        h('h1', {}, isDraft && source.analysis?.mode === 'ai' ? 'Sua lição está pronta' : 'Lição'),
        h('div', { class: 'chips' }, (source.themes ?? []).map((t) => themeChip(t))),
      ),
    ),
    isDraft && source.analysis?.mode === 'ai' && h('div', { class: 'banner', style: 'margin-bottom:18px' }, icon('sparkles', { size: 18 }),
      h('span', {}, 'Gerada por IA a partir das suas ideias. As citações vêm exatamente do que está salvo nos livros. Ajuste o que quiser e salve.')),
    h('form', { class: 'stack', onsubmit: save },
      h('section', { class: 'panel stack' },
        h('label', { class: 'field' }, h('span', {}, 'Título'), title),
        h('label', { class: 'field' }, h('span', {}, 'Introdução'), intro),
      ),
      h('section', { class: 'panel stack' },
        h('div', { class: 'panel-head' }, h('h2', {}, h('span', { class: 'section-icon' }, icon('compass', { size: 18 })), 'Lições')),
        stepsBox,
        h('div', {}, h('button', {
          type: 'button',
          class: 'btn',
          onclick: () => stepsBox.append(stepEditor({ id: crypto.randomUUID(), citations: [] })),
        }, icon('plus', { size: 16 }), 'Adicionar lição')),
      ),
      h('section', { class: 'panel stack' }, h('label', { class: 'field' }, h('span', {}, 'Fechamento'), closing)),
      h('div', { class: 'row end sticky-actions' },
        h('a', { class: 'btn ghost', href: isDraft ? '#/lessons' : `#/lessons/${id}` }, isDraft ? 'Descartar' : 'Cancelar'),
        saveBtn,
      ),
    ),
  );
}

// =========================================================
// Leitura
// =========================================================
export async function renderLessonReader(root, id) {
  await loadLessons();
  const lesson = findLesson(id);
  if (!lesson) {
    mount(root, emptyState({ glyph: 'compass', title: 'Lição não encontrada', action: h('a', { class: 'btn', href: '#/lessons' }, 'Voltar') }));
    return;
  }

  async function remove() {
    const ok = await confirmDialog({
      title: 'Excluir lição?',
      message: `"${lesson.title}" será excluída${lesson.shareId ? ' e o link compartilhado deixará de funcionar' : ''}. Os livros e ideias não são afetados.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      if (lesson.shareId) await share.unpublishLesson(lesson.shareId);
      await repo.deleteLesson(state.user.uid, lesson.id);
      invalidateLessons();
      toast('Lição excluída.', 'success');
      location.hash = '#/lessons';
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const shareBtn = h('button', { class: 'btn small', onclick: () => openShareDialog(lesson, () => drawShareBtn()) });
  const drawShareBtn = () => shareBtn.replaceChildren(icon('share', { size: 15 }), lesson.shareId ? 'Compartilhada' : 'Compartilhar');
  drawShareBtn();

  mount(root,
    h('div', { class: 'row between' },
      h('a', { class: 'back', href: '#/lessons' }, icon('back', { size: 16 }), 'Lições'),
      canEdit() && h('div', { class: 'row' },
        shareBtn,
        h('a', { class: 'btn ghost small', href: `#/lessons/${lesson.id}/edit` }, icon('edit', { size: 15 }), 'Editar'),
        h('button', { class: 'btn ghost icon-only small danger', title: 'Excluir lição', 'aria-label': 'Excluir lição', onclick: remove }, icon('trash', { size: 15 })),
      ),
    ),
    lessonArticle(lesson),
  );
}

/**
 * Corpo de leitura da lição. `isPublic` remove links para páginas privadas
 * (livros e temas), usado na página compartilhada.
 */
export function lessonArticle(lesson, { isPublic = false } = {}) {
  const books = new Set((lesson.steps ?? []).flatMap((s) => (s.citations ?? []).map((c) => c.bookTitle)));
  return h('article', { class: 'reader' },
    h('header', { class: 'reader-head' },
      h('div', { class: 'chips' }, (lesson.themes ?? []).map((t) => themeChip(t, isPublic ? {} : { href: `#/themes/${encodeURIComponent(t)}` }))),
      h('h1', {}, lesson.title),
      h('p', { class: 'muted small' },
        plural(lesson.steps?.length ?? 0, 'lição', 'lições'),
        books.size ? ` · com passagens de ${[...books].join(', ')}` : ''),
      lesson.focus && h('p', { class: 'muted' }, h('em', {}, `“${lesson.focus}”`)),
    ),
    lesson.intro && h('div', { class: 'reader-intro' }, paragraphs(lesson.intro)),
    (lesson.steps ?? []).map((step, i) => h('section', { class: 'lesson-step' },
      h('span', { class: 'lesson-num' }, i + 1),
      h('h2', {}, step.title),
      h('div', { class: 'text' }, paragraphs(step.text)),
      step.citations?.length > 0 && h('div', { class: 'citations' }, step.citations.map((c) => citationBlock(c, isPublic))),
      step.practice && h('div', { class: 'callout practice' }, icon('target', { size: 18 }), h('div', {}, h('strong', {}, 'Na prática'), step.practice)),
      step.question && h('div', { class: 'callout question' }, icon('help', { size: 18 }), h('div', {}, h('strong', {}, 'Para refletir'), step.question)),
    )),
    lesson.closing && h('p', { class: 'reader-close' }, lesson.closing),
  );
}

function citationBlock(c, isPublic) {
  const source = h('cite', {},
    '— ', isPublic || !c.bookId ? c.bookTitle : h('a', { href: `#/book/${c.bookId}` }, c.bookTitle),
    c.author ? `, ${c.author}` : '',
    c.pages?.length ? ` (${pagesLabel(c.pages)})` : '');
  return c.quote
    ? h('blockquote', { class: 'quote' }, icon('quote', { size: 16 }), c.quote, source)
    : h('blockquote', { class: 'quote' }, icon('bulb', { size: 16 }), h('span', { style: 'font-style:normal' }, c.ideaTitle), source);
}

// =========================================================
// Compartilhamento
// =========================================================
function openShareDialog(lesson, onChange) {
  const body = h('div', { class: 'stack' });
  const dlg = h('dialog', { class: 'dialog share-dialog' },
    h('div', { class: 'row between' },
      h('h2', { style: 'margin:0' }, 'Compartilhar lição'),
      h('button', { class: 'btn ghost icon-only small', 'aria-label': 'Fechar', onclick: () => dlg.close() }, icon('x', { size: 16 })),
    ),
    body,
  );
  dlg.addEventListener('close', () => dlg.remove());

  async function setShared(on, btn) {
    btn.disabled = true;
    try {
      if (on) {
        const shareId = await share.publishLesson(state.user.uid, lesson);
        if (shareId !== lesson.shareId) await repo.updateLesson(state.user.uid, lesson.id, { shareId });
        lesson.shareId = shareId;
      } else {
        await share.unpublishLesson(lesson.shareId);
        await repo.updateLesson(state.user.uid, lesson.id, { shareId: null });
        lesson.shareId = null;
        toast('Link desativado. Quem tinha o link não verá mais a lição.', 'success');
      }
      onChange();
      draw();
    } catch (err) {
      toast(errorMessage(err), 'error');
      btn.disabled = false;
    }
  }

  function draw() {
    if (!lesson.shareId) {
      mount(body,
        h('p', { class: 'muted' }, 'Crie um link público para enviar a quem quiser. A pessoa vê só esta lição — sem login e sem acesso aos seus livros, ideias ou outras lições.'),
        h('div', {}, h('button', { class: 'btn primary', onclick: (e) => setShared(true, e.currentTarget) }, icon('share', { size: 16 }), 'Criar link público')),
      );
      return;
    }
    const url = share.shareUrl(lesson.shareId);
    const message = `${lesson.title}\n${url}`;
    const input = h('input', { class: 'input', readonly: true, value: url, 'aria-label': 'Link da lição', onfocus: (e) => e.target.select() });
    mount(body,
      h('p', { class: 'muted small' }, 'Qualquer pessoa com este link pode ler a lição. Quando você editar a lição, o link mostra a versão nova.'),
      h('div', { class: 'row' }, input,
        h('button', {
          class: 'btn',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast('Link copiado.', 'success');
            } catch {
              input.select();
              toast('Selecione e copie o link (Ctrl+C).', 'info');
            }
          },
        }, icon('copy', { size: 16 }), 'Copiar')),
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn whatsapp', href: `https://wa.me/?text=${encodeURIComponent(message)}`, target: '_blank', rel: 'noopener' }, icon('message', { size: 16 }), 'Enviar no WhatsApp'),
        navigator.share && h('button', {
          class: 'btn',
          onclick: () => navigator.share({ title: lesson.title, text: lesson.title, url }).catch(() => {}),
        }, icon('share', { size: 16 }), 'Mais opções'),
        h('a', { class: 'btn ghost', href: url, target: '_blank', rel: 'noopener' }, icon('eye', { size: 16 }), 'Ver como visitante'),
      ),
      h('hr', { class: 'divider' }),
      h('div', {}, h('button', { class: 'btn ghost danger small', onclick: (e) => setShared(false, e.currentTarget) }, icon('x', { size: 15 }), 'Parar de compartilhar')),
    );
  }

  draw();
  document.body.append(dlg);
  dlg.showModal();
}
