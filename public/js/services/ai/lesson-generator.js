// Geração de "lições para a vida" a partir das ideias já salvas na biblioteca.
//
// Não relê os PDFs: usa as ideias (título, descrição, citação, páginas) dos temas
// escolhidos. Isso deixa a geração rápida e barata, e as citações exibidas vêm
// sempre dos dados salvos — o modelo só aponta referências (I1, I2…), nunca
// escreve a citação ele mesmo.

import { parseJsonLoose } from './book-analyzer.js';

const SYSTEM = `Você é um mentor que transforma ideias de livros em lições práticas para a vida.
Responda SEMPRE em português do Brasil e SOMENTE com JSON válido.
Use apenas as ideias fornecidas; não invente fatos, livros nem citações.
Conecte ideias de livros diferentes quando fizer sentido. Seja concreto, caloroso e direto, sem clichês de autoajuda.`;

export const DEPTHS = {
  short: { label: 'Rápida (3 lições)', steps: 3 },
  full: { label: 'Completa (5 lições)', steps: 5 },
};

/**
 * Seleciona até `max` ideias, alternando entre livros e preferindo as que têm citação.
 * @param {{ idea: object, book: object }[]} items
 */
export function pickIdeas(items, max = 90) {
  const byBook = new Map();
  for (const it of items) {
    if (!byBook.has(it.book.id)) byBook.set(it.book.id, []);
    byBook.get(it.book.id).push(it);
  }
  for (const list of byBook.values()) list.sort((a, b) => Number(Boolean(b.idea.quote)) - Number(Boolean(a.idea.quote)));
  const queues = [...byBook.values()];
  const out = [];
  while (out.length < max && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && out.length < max) out.push(q.shift());
  }
  return out;
}

/**
 * @param {object} p
 * @param {{ idea: object, book: object }[]} p.items  ideias escolhidas
 * @param {string[]} p.themes
 * @param {string} [p.focus]  pergunta/foco opcional do usuário
 * @param {'short'|'full'} [p.depth]
 * @returns {Promise<{ title, intro, closing, steps: { id, title, text, practice, question, citations }[] }>}
 */
export async function generateLesson({ items, themes, focus = '', depth = 'full', client, model, signal }) {
  if (!items.length) throw new Error('Nenhuma ideia nos temas escolhidos.');
  const chosen = pickIdeas(items);
  const refs = new Map(chosen.map((it, i) => [`I${i + 1}`, it]));
  const material = chosen.map((it, i) => ({
    ref: `I${i + 1}`,
    livro: it.book.title,
    autor: it.book.author || undefined,
    ideia: it.idea.title,
    descricao: it.idea.description,
    citacao: it.idea.quote || undefined,
  }));
  const steps = DEPTHS[depth]?.steps ?? 5;

  const raw = await client.chat({
    model,
    json: true,
    signal,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Tema(s): ${themes.join(', ')}.
${focus ? `Foco pedido pelo leitor: "${focus}".\n` : ''}
Escreva uma lição para eu ler em 5 a 10 minutos e aplicar na vida, com:
- "title": título inspirador e específico (máx. 70 caracteres).
- "intro": 1 a 2 parágrafos situando o tema e por que importa (separe com \\n\\n).
- "steps": exatamente ${steps} lições, cada uma com:
  - "title": a lição em uma frase curta e afirmativa;
  - "text": 1 a 3 parágrafos explicando, ligando as ideias dos livros (separe com \\n\\n);
  - "practice": um exercício ou ação concreta para esta semana;
  - "question": uma pergunta de reflexão pessoal;
  - "refs": 1 a 3 referências (ex.: ["I3", "I7"]) das ideias que sustentam a lição. Prefira ideias que têm "citacao".
- "closing": uma frase final para levar consigo.

Formato: {"title": "", "intro": "", "steps": [{"title": "", "text": "", "practice": "", "question": "", "refs": ["I1"]}], "closing": ""}

IDEIAS DISPONÍVEIS:
${JSON.stringify(material)}` },
    ],
  });

  const out = parseJsonLoose(raw);
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  return {
    title: str(out.title, 120) || `Lições sobre ${themes.join(', ')}`,
    intro: str(out.intro, 3000),
    closing: str(out.closing, 400),
    steps: (Array.isArray(out.steps) ? out.steps : []).filter((s) => s?.title || s?.text).map((s) => ({
      id: crypto.randomUUID(),
      title: str(s.title, 200),
      text: str(s.text, 4000),
      practice: str(s.practice, 800),
      question: str(s.question, 400),
      citations: [...new Set(Array.isArray(s.refs) ? s.refs.map(String) : [])]
        .map((r) => refs.get(r))
        .filter(Boolean)
        .slice(0, 3)
        .map(toCitation),
    })),
  };
}

/** Cópia "congelada" da ideia citada, para a lição continuar legível mesmo se o livro mudar. */
export function toCitation({ idea, book }) {
  return {
    bookId: book.id,
    bookTitle: book.title,
    author: book.author || '',
    ideaId: idea.id || '',
    ideaTitle: idea.title || '',
    quote: idea.quote || '',
    pages: idea.pages ?? [],
  };
}
