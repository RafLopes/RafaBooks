import { h, mount, toast, confirmDialog, errorMessage, formatBytes, icon, emptyState } from '../dom.js';
import { state, loadBooks, findBook, invalidateBooks } from '../store.js';
import { storage, aiClient } from '../../services/index.js';
import * as repo from '../../services/books-repo.js';
import { openPdf, extractPages, renderCover } from '../../services/pdf/pdf-text.js';
import { unsupportedMessage } from '../../services/storage/folder-storage.js';
import { analyzeBook, findQuotes } from '../../services/ai/book-analyzer.js';
import { hasApiKey, getModel } from '../../services/ai/api-key-store.js';
import { ai as aiConfig, limits } from '../../config/app-config.js';

/** Cadastro (id ausente) ou edição de um livro. */
export async function renderBookForm(root, id) {
  const books = await loadBooks();
  const existing = id ? findBook(id) : null;
  if (id && !existing) {
    mount(root, emptyState({ glyph: 'library', title: 'Livro não encontrado', action: h('a', { class: 'btn', href: '#/' }, 'Voltar à biblioteca') }));
    return;
  }

  const themes = repo.collectThemes(books);
  const form = {
    file: null,          // File escolhido no computador (será copiado para a pasta ao salvar)
    linked: null,        // PDF que já está na pasta ({ fileId, name, size }), sem cópia
    pdf: null,           // documento pdf.js aberto (para capa e análise)
    pages: null,         // texto extraído (cache para análise e citações)
    cover: existing?.cover ?? null,
    analysis: existing?.analysis ?? { mode: 'manual' },
    busy: false,
  };

  // ---------- campos básicos ----------
  const title = h('input', { class: 'input', required: true, maxlength: 300, value: existing?.title ?? '' });
  const author = h('input', { class: 'input', maxlength: 200, value: existing?.author ?? '' });
  const year = h('input', { class: 'input', inputmode: 'numeric', maxlength: 4, value: existing?.year ?? '' });
  const fileInfo = h('p', { class: 'muted small' },
    existing?.file ? `Atual: ${existing.file.name} (${formatBytes(existing.file.size)}) — na ${storage.label}` : 'Nenhum PDF selecionado.');
  const fileInput = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'input', onchange: onFileChosen });
  const folderPicker = h('div', { class: 'row wrap' },
    h('button', { type: 'button', class: 'btn', onclick: showFolderFiles }, icon('folder', { size: 16 }), 'Escolher um PDF que já está na pasta'));

  function resetPdf() {
    form.file = null;
    form.linked = null;
    form.pdf?.destroy();
    form.pdf = null;
    form.pages = null;
  }

  async function loadPdfPreview(blob) {
    try {
      form.pdf = await openPdf(blob);
      form.cover = await renderCover(form.pdf);
      fileInfo.textContent += ` · ${form.pdf.numPages} páginas`;
    } catch {
      toast('Não foi possível ler o PDF. Ele ainda pode ser vinculado, mas sem capa e sem análise por IA.', 'error');
    }
    refreshAi();
  }

  function suggestTitle(fileName) {
    if (!title.value.trim()) title.value = fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
  }

  // PDFs que já estão na pasta e ainda não pertencem a nenhum livro.
  async function showFolderFiles() {
    try {
      const used = new Set(books.filter((b) => b.id !== existing?.id).map((b) => b.file?.fileId).filter(Boolean));
      const files = (await storage.list()).filter((f) => !used.has(f.fileId));
      if (!files.length) {
        mount(folderPicker, h('p', { class: 'muted small' }, 'Não há PDFs livres na pasta. Use o campo acima para escolher um arquivo do computador.'));
        return;
      }
      const select = h('select', { class: 'input', 'aria-label': 'PDFs da pasta', onchange: () => onLinked(files.find((f) => f.fileId === select.value)) },
        h('option', { value: '' }, `Selecione (${files.length} PDFs disponíveis)…`),
        files.map((f) => h('option', { value: f.fileId }, `${f.name} (${formatBytes(f.size)})`)),
      );
      mount(folderPicker, select);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function onLinked(entry) {
    resetPdf();
    fileInput.value = '';
    if (!entry) return;
    form.linked = entry;
    fileInfo.textContent = `Vinculado: ${entry.name} (${formatBytes(entry.size)}) — já está na pasta, não será copiado`;
    suggestTitle(entry.name);
    try {
      await loadPdfPreview(await storage.download(entry.fileId));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function onFileChosen() {
    const f = fileInput.files[0];
    resetPdf();
    if (!f) return;
    if (f.type && f.type !== 'application/pdf') {
      toast('Selecione um arquivo PDF.', 'error');
      fileInput.value = '';
      return;
    }
    if (f.size > limits.maxPdfBytes) {
      toast(`Arquivo maior que ${formatBytes(limits.maxPdfBytes)}.`, 'error');
      fileInput.value = '';
      return;
    }
    form.file = f;
    fileInfo.textContent = `Selecionado: ${f.name} (${formatBytes(f.size)}) — será copiado para a pasta ao salvar`;
    suggestTitle(f.name);
    await loadPdfPreview(f);
  }

  // ---------- conhecimento: resumo + ideias ----------
  const summary = h('textarea', { class: 'input', rows: 10, placeholder: 'Cole ou escreva aqui o resumo do livro…', value: existing?.summary ?? '' });
  const ideasBox = h('div', { class: 'ideas-editor' });
  const themeList = h('datalist', { id: 'theme-options' }, themes.map((t) => h('option', { value: t })));

  function ideaRow(idea = {}) {
    const row = h('div', { class: 'idea-row' },
      h('div', { class: 'idea-row-top' },
        h('input', { class: 'input', name: 'title', placeholder: 'Ideia (título curto)', value: idea.title ?? '' }),
        h('input', { class: 'input', name: 'theme', placeholder: 'Tema', list: 'theme-options', value: idea.theme ?? '' }),
        h('input', { class: 'input pages', name: 'pages', placeholder: 'Págs. (ex.: 12, 40)', value: (idea.pages ?? []).join(', ') }),
        h('button', { type: 'button', class: 'btn ghost icon-only small', title: 'Remover ideia', 'aria-label': 'Remover ideia', onclick: () => row.remove() }, icon('x', { size: 16 })),
      ),
      h('textarea', { class: 'input', name: 'description', rows: 2, placeholder: 'Descrição', value: idea.description ?? '' }),
      h('textarea', { class: 'input', name: 'quote', rows: 2, placeholder: 'Citação literal do livro (opcional)', value: idea.quote ?? '' }),
    );
    row.dataset.id = idea.id ?? crypto.randomUUID();
    return row;
  }

  function setIdeas(ideas) {
    mount(ideasBox, ideas.map(ideaRow));
  }

  function readIdeas() {
    return [...ideasBox.querySelectorAll('.idea-row')].map((row) => {
      const get = (n) => row.querySelector(`[name="${n}"]`).value.trim();
      return {
        id: row.dataset.id,
        title: get('title'),
        description: get('description'),
        theme: get('theme') || 'Geral',
        pages: [...new Set(get('pages').split(/[^\d]+/).filter(Boolean).map(Number))].sort((a, b) => a - b),
        quote: get('quote'),
      };
    }).filter((i) => i.title || i.description);
  }

  setIdeas(existing?.ideas ?? []);

  // ---------- modo automático ----------
  const aiStatus = h('div', { class: 'ai-status' });
  const aiProgress = h('div', { class: 'ai-progress', hidden: true },
    h('progress', { max: 1, value: 0 }),
    h('span', { class: 'small' }),
  );
  const analyzeBtn = h('button', { type: 'button', class: 'btn primary', onclick: runAnalysis }, icon('sparkles', { size: 16 }), 'Analisar PDF com IA');
  const quotesBtn = h('button', {
    type: 'button',
    class: 'btn',
    title: 'Busca no PDF trechos literais para as ideias que ainda não têm citação',
    onclick: runFindQuotes,
  }, icon('quote', { size: 16 }), 'Buscar citações');
  const cancelBtn = h('button', { type: 'button', class: 'btn ghost', hidden: true }, 'Cancelar');
  const reviewBanner = h('div', { class: 'banner', hidden: true }, icon('sparkles', { size: 18 }), h('span', {}, 'Resultado gerado por IA. Revise, ajuste o que quiser e só então clique em Salvar.'));

  function refreshAi() {
    const hasPdf = storage.isSupported && Boolean(form.pdf || existing?.file);
    if (!hasApiKey()) {
      mount(aiStatus, h('p', { class: 'muted' }, 'Chave do OpenRouter não configurada. ', h('a', { href: '#/settings' }, 'Configurar'), '. O modo manual continua disponível.'));
    } else if (!hasPdf) {
      mount(aiStatus, h('p', { class: 'muted' }, 'Selecione um PDF acima para poder analisá-lo.'));
    } else {
      mount(aiStatus, h('p', { class: 'muted' }, `Modelo: ${getModel()}. O texto do PDF é extraído no navegador e enviado ao OpenRouter em partes. Isso consome créditos da sua conta.`));
    }
    analyzeBtn.disabled = form.busy || !hasApiKey() || !hasPdf;
    quotesBtn.disabled = analyzeBtn.disabled;
  }

  /** Executa uma tarefa de IA com progresso, cancelamento e o texto do PDF já extraído. */
  async function aiTask(work) {
    const controller = new AbortController();
    cancelBtn.onclick = () => controller.abort();
    const [bar, label] = aiProgress.children;
    const progress = (msg, f) => { label.textContent = msg; bar.value = f; };

    setBusy(true);
    aiProgress.hidden = false;
    cancelBtn.hidden = false;
    try {
      if (!form.pages) {
        if (!form.pdf) {
          progress('Abrindo o PDF da pasta…', 0);
          form.pdf = await openPdf(await storage.download(existing.file.fileId));
        }
        form.pages = await extractPages(form.pdf, { signal: controller.signal, onProgress: (f) => progress('Extraindo texto do PDF…', f) });
      }
      await work({ pages: form.pages, progress, signal: controller.signal, model: getModel() });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
      aiProgress.hidden = true;
      cancelBtn.hidden = true;
    }
  }

  async function runFindQuotes() {
    const ideas = readIdeas();
    if (!ideas.some((i) => !i.quote && i.pages.length)) {
      toast('Todas as ideias com páginas já têm citação (ideias sem página não podem ser buscadas).', 'info');
      return;
    }
    await aiTask(async ({ pages, progress, signal, model }) => {
      const result = await findQuotes({ ideas, pages, client: aiClient, model, limits: aiConfig, signal, onProgress: progress });
      setIdeas(result.ideas);
      reviewBanner.hidden = false;
      toast(result.found ? `${result.found} citações encontradas. Revise e salve.` : 'Nenhuma citação literal confirmada no PDF.', result.found ? 'success' : 'info');
    });
  }

  async function runAnalysis() {
    if (readIdeas().length || summary.value.trim()) {
      const ok = await confirmDialog({
        title: 'Substituir conteúdo atual?',
        message: 'O resumo e as ideias que estão no formulário serão substituídos pelo resultado da IA (nada é salvo até você clicar em Salvar).',
        confirmLabel: 'Analisar',
      });
      if (!ok) return;
    }

    await aiTask(async ({ pages, progress, signal, model }) => {
      const result = await analyzeBook({
        pages,
        client: aiClient,
        model,
        book: { title: title.value.trim(), author: author.value.trim() },
        existingThemes: themes,
        limits: aiConfig,
        signal,
        onProgress: progress,
      });
      summary.value = result.summary;
      setIdeas(result.ideas);
      form.analysis = { mode: 'ai', model, generatedAt: new Date().toISOString() };
      reviewBanner.hidden = false;
      reviewBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const quoted = result.ideas.filter((i) => i.quote).length;
      toast(`Análise concluída: ${result.ideas.length} ideias, ${quoted} com citação literal.`, 'success');
    });
  }

  // ---------- salvar ----------
  const saveBtn = h('button', { type: 'submit', class: 'btn primary' }, icon('check', { size: 16 }), 'Salvar');
  const uploadProgress = h('progress', { max: 1, value: 0, hidden: true });

  function setBusy(v) {
    form.busy = v;
    saveBtn.disabled = v;
    fileInput.disabled = v;
    refreshAi();
  }

  async function save(e) {
    e.preventDefault();
    const t = title.value.trim();
    if (!t) {
      title.focus();
      toast('Informe o título.', 'error');
      return;
    }

    const uid = state.user.uid;
    const bookId = existing?.id ?? repo.newBookId(uid);
    const data = {
      title: t,
      author: author.value.trim(),
      year: year.value.trim(),
      summary: summary.value.trim(),
      ideas: readIdeas(),
      cover: form.cover,
      analysis: form.analysis,
    };

    setBusy(true);
    let uploaded = null;
    try {
      if (form.file) {
        uploadProgress.hidden = false;
        uploaded = await storage.upload(form.file, { onProgress: (f) => { uploadProgress.value = f; } });
        data.file = uploaded;
      } else if (form.linked) {
        data.file = { ...form.linked, mimeType: 'application/pdf', provider: 'local-folder' };
      }
      // Ao trocar o PDF, o arquivo antigo continua na pasta (nunca apagamos sem pedir).
      if (existing) {
        await repo.updateBook(uid, bookId, data);
      } else {
        await repo.createBook(uid, bookId, data);
      }
      invalidateBooks();
      toast('Livro salvo.', 'success');
      location.hash = `#/book/${bookId}`;
    } catch (err) {
      // Remove a cópia recém-feita se o Firestore falhar.
      if (uploaded) await storage.remove(uploaded.fileId).catch(() => {});
      toast(errorMessage(err), 'error');
    } finally {
      uploadProgress.hidden = true;
      setBusy(false);
    }
  }

  refreshAi();

  const sectionHead = (glyph, text, extra) => h('div', { class: 'panel-head' },
    h('h2', {}, h('span', { class: 'section-icon' }, icon(glyph, { size: 18 })), text), extra);

  mount(root,
    h('a', { class: 'back', href: existing ? `#/book/${existing.id}` : '#/' }, icon('back', { size: 16 }), 'Voltar'),
    h('div', { class: 'page-head' },
      h('div', {},
        h('span', { class: 'eyebrow' }, existing ? 'Edição' : 'Novo livro'),
        h('h1', {}, existing ? existing.title : 'Adicionar à estante'),
      ),
    ),
    h('form', { class: 'stack', onsubmit: save },
      h('section', { class: 'panel stack' },
        sectionHead('library', 'Dados do livro'),
        h('label', { class: 'field' }, h('span', {}, 'Título *'), title),
        h('div', { class: 'row wrap' },
          h('label', { class: 'field grow' }, h('span', {}, 'Autor'), author),
          h('label', { class: 'field' }, h('span', {}, 'Ano'), year),
        ),
        storage.isSupported
          ? [
            h('label', { class: 'field' }, h('span', {}, existing?.file ? 'Substituir PDF (copiar do computador)' : 'PDF do computador (será copiado para a pasta)'), fileInput),
            folderPicker,
            fileInfo,
          ]
          : h('p', { class: 'banner' }, unsupportedMessage()),
      ),
      h('section', { class: 'ai-box stack' },
        sectionHead('sparkles', 'Gerar com IA', h('span', { class: 'chip' }, 'opcional')),
        aiStatus,
        h('div', { class: 'row wrap' }, analyzeBtn, quotesBtn, cancelBtn),
        aiProgress,
      ),
      reviewBanner,
      h('section', { class: 'panel stack' },
        sectionHead('edit', 'Resumo'),
        summary,
      ),
      h('section', { class: 'panel stack' },
        sectionHead('bulb', 'Ideias'),
        h('p', { class: 'muted small' }, 'A citação literal é opcional e aparece nas lições como passagem do livro.'),
        themeList,
        ideasBox,
        h('div', {}, h('button', { type: 'button', class: 'btn', onclick: () => ideasBox.append(ideaRow()) }, icon('plus', { size: 16 }), 'Adicionar ideia')),
      ),
      h('div', { class: 'row end sticky-actions' }, uploadProgress, h('a', { class: 'btn ghost', href: existing ? `#/book/${existing.id}` : '#/' }, 'Cancelar'), saveBtn),
    ),
  );
}
