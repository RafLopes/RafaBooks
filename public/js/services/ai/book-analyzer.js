// Geração de resumo e extração de ideias de um livro.
//
// Estratégia "map-reduce" para livros extensos:
//   1. O texto (com marcadores de página) é dividido em blocos.
//   2. MAP: cada bloco gera um resumo parcial + ideias com páginas.
//   3. REDUCE: os resultados parciais são consolidados em um resumo geral e
//      uma lista final de ideias, sem duplicatas e com temas padronizados.
// Livros curtos (um único bloco) usam uma única chamada.

const SYSTEM = `Você é um assistente que analisa livros para uma biblioteca pessoal de estudos.
Responda SEMPRE em português do Brasil e SOMENTE com JSON válido, sem texto fora do JSON.
Temas devem ser categorias amplas e reutilizáveis (ex.: "Filosofia antiga", "Estoicismo", "Psicologia comportamental", "Economia", "Liderança"), nunca o título do livro.
As páginas vêm marcadas como [p. N] no texto; use esses números nas referências. Não invente páginas.
Em "quote", copie um trecho LITERAL e curto (1 a 2 frases, até 220 caracteres) do texto que sustente a ideia, exatamente como está escrito, sem traduzir nem parafrasear. Se não houver um trecho adequado, deixe "quote" vazio.`;

/**
 * Divide as páginas em blocos de até `chunkChars` caracteres, sem quebrar páginas
 * (exceto páginas gigantes, que são fatiadas).
 * @param {{ page: number, text: string }[]} pages
 */
export function buildChunks(pages, chunkChars) {
  const chunks = [];
  let current = { text: '', from: null, to: null };

  const flush = () => {
    if (current.text.trim()) chunks.push(current);
    current = { text: '', from: null, to: null };
  };

  for (const { page, text } of pages) {
    if (!text) continue;
    for (let i = 0; i < text.length; i += chunkChars) {
      const piece = `[p. ${page}]\n${text.slice(i, i + chunkChars)}\n\n`;
      if (current.text.length + piece.length > chunkChars && current.text) flush();
      current.from ??= page;
      current.to = page;
      current.text += piece;
    }
  }
  flush();
  return chunks;
}

/** Extrai JSON de uma resposta, tolerando cercas ```json e texto ao redor. */
export function parseJsonLoose(raw) {
  const text = String(raw).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('Resposta do modelo não está em JSON.');
  }
}

/** Normaliza ideias vindas do modelo para o formato salvo no Firestore. */
export function normalizeIdeas(list, validPages) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((i) => i && (i.title || i.description))
    .map((i) => ({
      id: crypto.randomUUID(),
      title: String(i.title ?? '').trim().slice(0, 200),
      description: String(i.description ?? '').trim().slice(0, 2000),
      theme: String(i.theme ?? 'Geral').trim().slice(0, 80) || 'Geral',
      pages: normalizePages(i.pages, validPages),
      quote: String(i.quote ?? '').trim().replace(/^["“”«»']+|["“”«»']+$/g, '').slice(0, 400),
    }));
}

// Normaliza para comparação: sem acentos, pontuação, caixa ou quebras de linha.
function normalizeForMatch(text) {
  return String(text)
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2') // palavra hifenizada na quebra de linha
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Mantém apenas citações que existem de fato no texto do PDF.
 * Modelos às vezes "inventam" trechos; estes são descartados.
 */
export function verifyQuotes(ideas, pages) {
  const haystack = normalizeForMatch(pages.map((p) => p.text).join('\n'));
  return ideas.map((idea) => {
    if (!idea.quote) return idea;
    const needle = normalizeForMatch(idea.quote);
    return needle.length >= 20 && haystack.includes(needle) ? idea : { ...idea, quote: '' };
  });
}

function normalizePages(pages, validPages) {
  const arr = Array.isArray(pages) ? pages : pages != null ? [pages] : [];
  const nums = arr.map(Number).filter((n) => Number.isInteger(n) && n > 0 && (!validPages || validPages.has(n)));
  return [...new Set(nums)].sort((a, b) => a - b).slice(0, 10);
}

/**
 * @param {object} p
 * @param {{ page: number, text: string }[]} p.pages
 * @param {{ chat: Function }} p.client
 * @param {string} p.model
 * @param {{ title?: string, author?: string }} p.book
 * @param {string[]} p.existingThemes
 * @param {{ chunkChars: number, maxBookChars: number, maxIdeasPerChunk: number, maxFinalIdeas: number }} p.limits
 * @param {(msg: string, fraction: number) => void} [p.onProgress]
 * @param {AbortSignal} [p.signal]
 * @returns {Promise<{ summary: string, ideas: object[] }>}
 */
export async function analyzeBook({ pages, client, model, book, existingThemes = [], limits, onProgress, signal }) {
  const totalChars = pages.reduce((n, p) => n + p.text.length, 0);
  if (totalChars < 500) {
    throw new Error('Quase não há texto extraível neste PDF (pode ser um PDF escaneado). Use o modo manual.');
  }
  if (totalChars > limits.maxBookChars) {
    throw new Error(`O texto do livro (${fmt(totalChars)} caracteres) excede o limite de ${fmt(limits.maxBookChars)}. Use o modo manual.`);
  }

  const validPages = new Set(pages.filter((p) => p.text).map((p) => p.page));
  const chunks = buildChunks(pages, limits.chunkChars);
  const header = bookHeader(book, existingThemes);
  const ask = async (prompt) => parseJsonLoose(await client.chat({
    model,
    json: true,
    signal,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
  }));

  if (chunks.length === 1) {
    onProgress?.('Analisando o livro…', 0.1);
    const out = await ask(`${header}
Leia o livro abaixo e produza:
- "summary": resumo geral em 3 a 6 parágrafos (texto corrido, separados por \\n\\n).
- "ideas": até ${limits.maxFinalIdeas} principais ideias, cada uma com "title" (curto), "description" (2 a 4 frases), "theme" e "pages" (lista de números).

Formato: {"summary": "...", "ideas": [{"title": "", "description": "", "theme": "", "pages": [1], "quote": ""}]}

TEXTO:
${chunks[0].text}`);
    onProgress?.('Concluído', 1);
    return { summary: String(out.summary ?? '').trim(), ideas: verifyQuotes(normalizeIdeas(out.ideas, validPages), pages) };
  }

  // MAP
  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    onProgress?.(`Lendo parte ${i + 1} de ${chunks.length} (págs. ${c.from}–${c.to})…`, i / (chunks.length + 1));
    const out = await ask(`${header}
Este é o trecho ${i + 1} de ${chunks.length} do livro (páginas ${c.from} a ${c.to}).
Produza:
- "summary": resumo deste trecho em 1 parágrafo.
- "ideas": até ${limits.maxIdeasPerChunk} ideias relevantes do trecho, cada uma com "title", "description" (2 a 3 frases), "theme" e "pages".

Formato: {"summary": "...", "ideas": [{"title": "", "description": "", "theme": "", "pages": [1], "quote": ""}]}

TRECHO:
${c.text}`);
    partials.push({ from: c.from, to: c.to, summary: String(out.summary ?? ''), ideas: verifyQuotes(normalizeIdeas(out.ideas, validPages), pages) });
  }

  // REDUCE
  onProgress?.('Consolidando resumo e ideias…', chunks.length / (chunks.length + 1));
  const digest = partials.map((p) => ({
    paginas: `${p.from}-${p.to}`,
    resumo: p.summary,
    ideias: p.ideas.map(({ title, description, theme, pages: pg, quote }) => ({ title, description, theme, pages: pg, quote })),
  }));
  const out = await ask(`${header}
Abaixo estão resumos e ideias extraídos de cada parte do livro, em ordem.
Consolide em:
- "summary": resumo geral do livro em 3 a 6 parágrafos (separados por \\n\\n).
- "ideas": as ${limits.maxFinalIdeas} ideias mais importantes no máximo. Una ideias repetidas (juntando as páginas), padronize os temas e mantenha as descrições claras. Preserve o campo "quote" exatamente como recebido (não altere citações).

Formato: {"summary": "...", "ideas": [{"title": "", "description": "", "theme": "", "pages": [1], "quote": ""}]}

PARTES:
${JSON.stringify(digest)}`);
  onProgress?.('Concluído', 1);
  return { summary: String(out.summary ?? '').trim(), ideas: verifyQuotes(normalizeIdeas(out.ideas, validPages), pages) };
}

function bookHeader(book, themes) {
  const lines = [];
  if (book?.title) lines.push(`Livro: "${book.title}"${book.author ? ` — ${book.author}` : ''}.`);
  if (themes.length) lines.push(`Temas já existentes na biblioteca (reutilize quando fizer sentido): ${themes.slice(0, 80).join('; ')}.`);
  return lines.join('\n');
}

const fmt = (n) => n.toLocaleString('pt-BR');

/**
 * Procura citações literais para ideias que já existem (ex.: livros analisados
 * antes desta função existir). Usa só as páginas citadas em cada ideia.
 * Ideias sem páginas ou que já têm citação ficam como estão.
 */
export async function findQuotes({ ideas, pages, client, model, limits, onProgress, signal }) {
  const byPage = new Map(pages.map((p) => [p.page, p.text]));
  const pending = ideas.filter((i) => !i.quote && i.pages?.some((n) => byPage.get(n)));
  if (!pending.length) return { ideas, found: 0 };

  // Agrupa ideias em lotes cujo texto das páginas caiba num bloco.
  const batches = [];
  let current = { ideas: [], pages: new Set(), size: 0 };
  for (const idea of pending) {
    const extra = idea.pages.filter((n) => !current.pages.has(n)).reduce((s, n) => s + (byPage.get(n)?.length ?? 0), 0);
    if (current.ideas.length && current.size + extra > limits.chunkChars) {
      batches.push(current);
      current = { ideas: [], pages: new Set(), size: 0 };
    }
    current.ideas.push(idea);
    for (const n of idea.pages) {
      if (!current.pages.has(n) && byPage.get(n)) {
        current.pages.add(n);
        current.size += byPage.get(n).length;
      }
    }
  }
  if (current.ideas.length) batches.push(current);

  const quotes = new Map();
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    onProgress?.(`Procurando citações (${b + 1} de ${batches.length})…`, b / batches.length);
    const text = [...batch.pages].sort((x, y) => x - y).map((n) => `[p. ${n}]\n${byPage.get(n)}`).join('\n\n');
    const list = batch.ideas.map((i) => ({ id: i.id, title: i.title, description: i.description, pages: i.pages }));
    const raw = await client.chat({
      model,
      json: true,
      signal,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Para cada ideia abaixo, encontre no TEXTO um trecho LITERAL e curto (1 a 2 frases, até 220 caracteres) que melhor a sustente, copiado exatamente como está escrito. Se não houver, use "".

Formato: {"quotes": [{"id": "", "quote": ""}]}

IDEIAS:
${JSON.stringify(list)}

TEXTO:
${text}` },
      ],
    });
    for (const q of parseJsonLoose(raw).quotes ?? []) {
      if (q?.id && q.quote) quotes.set(String(q.id), String(q.quote).trim().slice(0, 400));
    }
  }
  onProgress?.('Concluído', 1);

  const updated = verifyQuotes(ideas.map((i) => (quotes.has(i.id) && !i.quote ? { ...i, quote: quotes.get(i.id) } : i)), pages);
  const found = updated.filter((i, idx) => i.quote && !ideas[idx].quote).length;
  return { ideas: updated, found };
}
