// Cliente mínimo da API do OpenRouter (chamado direto do navegador).
//
// Interface de provedor de IA (a mesma que outro provedor futuro deve implementar):
//   chat({ messages, model, json, signal }) -> string
//   testConnection() -> { label, usage, limit }

const BASE = 'https://openrouter.ai/api/v1';

export class AIError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.name = 'AIError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** @param {{ getApiKey: () => string, fallbackModels?: string[] }} deps */
export function createOpenRouterClient({ getApiKey, fallbackModels: defaultFallbacks = [] }) {
  function headers() {
    const key = getApiKey();
    if (!key) throw new AIError('Chave do OpenRouter não configurada.');
    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin,
      'X-Title': 'RafaBooks',
    };
  }

  async function call(path, init) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, { ...init, headers: headers() });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new AIError('Falha de rede ao contatar o OpenRouter.', { retryable: true });
    }
    if (!res.ok) throw await toError(res);
    return res.json();
  }

  async function testConnection() {
    const { data } = await call('/key', { method: 'GET' });
    return { label: data?.label ?? '', usage: data?.usage ?? 0, limit: data?.limit ?? null };
  }

  /**
   * @param {string[]} [fallbackModels] modelos alternativos que o OpenRouter usa
   *   automaticamente se o principal falhar (erro do provedor, indisponibilidade).
   */
  async function chat({ messages, model, fallbackModels = defaultFallbacks, json = false, signal, maxRetries = 4 }) {
    const body = { model, messages, temperature: 0.3 };
    const alternatives = fallbackModels.filter((m) => m && m !== model);
    if (alternatives.length) body.models = [model, ...alternatives];
    if (json) body.response_format = { type: 'json_object' };

    for (let attempt = 0; ; attempt++) {
      try {
        const data = await call('/chat/completions', { method: 'POST', body: JSON.stringify(body), signal });
        if (data.error) throw new AIError(cleanMessage(describe(data.error)), { status: data.error.code, retryable: true });
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new AIError('O modelo retornou uma resposta vazia.', { retryable: true });
        return content;
      } catch (err) {
        if (err.name === 'AbortError' || !err.retryable || attempt >= maxRetries) throw err;
        console.warn(`[RafaBooks] OpenRouter falhou (tentativa ${attempt + 1}/${maxRetries + 1}):`, err.message);
        await wait(2000 * 2 ** attempt, signal);
      }
    }
  }

  return { chat, testConnection };
}

// Mensagem do erro + qual provedor falhou, quando o OpenRouter informa.
function describe(error) {
  const provider = error?.metadata?.provider_name;
  return [error?.message, provider && `(provedor: ${provider})`].filter(Boolean).join(' ');
}

async function toError(res) {
  let detail = '';
  try {
    detail = describe((await res.json())?.error);
  } catch { /* corpo não-JSON */ }
  const known = {
    400: 'Requisição inválida (verifique o modelo escolhido).',
    401: 'Chave do OpenRouter inválida ou revogada.',
    402: 'Créditos insuficientes no OpenRouter.',
    403: 'Requisição bloqueada pela moderação do modelo.',
    408: 'Tempo de resposta esgotado.',
    413: 'Texto grande demais para o modelo.',
    429: 'Limite de requisições atingido. Aguardando para tentar de novo.',
  };
  const base = known[res.status] ?? `Erro do OpenRouter (HTTP ${res.status}).`;
  return new AIError(detail ? `${base} ${cleanMessage(detail)}` : base, {
    status: res.status,
    retryable: res.status === 408 || res.status === 429 || res.status >= 500,
  });
}

// Garantia extra: nunca deixar algo com cara de chave em mensagens de erro.
function cleanMessage(msg) {
  return String(msg ?? '').replace(/sk-or-[\w-]+/gi, '[chave oculta]').slice(0, 300);
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Cancelado.', 'AbortError'));
    }, { once: true });
  });
}
