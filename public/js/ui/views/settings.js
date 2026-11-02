import { h, mount, toast, confirmDialog, errorMessage, icon } from '../dom.js';
import { state, loadBooks, loadLessons } from '../store.js';
import { getPublicLibraryUid, setLibraryPublic } from '../../services/library-repo.js';
import { aiClient, storage } from '../../services/index.js';
import { unsupportedMessage } from '../../services/storage/folder-storage.js';
import * as keyStore from '../../services/ai/api-key-store.js';
import { ai as aiConfig } from '../../config/app-config.js';

const head = (glyph, text) => h('h2', {}, h('span', { class: 'section-icon' }, icon(glyph, { size: 18 })), text);

export async function renderSettings(root) {
  // ---------- OpenRouter ----------
  const status = h('div', { class: 'key-status' });
  const keyInput = h('input', {
    type: 'password',
    class: 'input',
    autocomplete: 'off',
    spellcheck: false,
    placeholder: 'sk-or-v1-…',
    'aria-label': 'Chave do OpenRouter',
  });
  const modelInput = h('input', { class: 'input', value: keyStore.getModel(), placeholder: aiConfig.defaultModel, 'aria-label': 'Modelo' });
  const actions = h('div', { class: 'row wrap' });

  function draw(test) {
    const has = keyStore.hasApiKey();
    const [cls, text] = !has
      ? ['off', 'Não configurada — o app funciona normalmente no modo manual.']
      : test?.ok === true
        ? ['ok', `Conectada${test.info.label ? ` (${test.info.label})` : ''}. Uso: US$ ${Number(test.info.usage).toFixed(2)}${test.info.limit != null ? ` de US$ ${Number(test.info.limit).toFixed(2)}` : ''}.`]
        : test?.ok === false
          ? ['error', `Falha no teste: ${test.message}`]
          : ['saved', `Chave salva neste navegador: ${keyStore.maskedApiKey()}`];
    mount(status, h('span', { class: `dot ${cls}` }), text);

    keyInput.placeholder = has ? 'Digite uma nova chave para substituir' : 'sk-or-v1-…';
    mount(actions,
      h('button', { type: 'submit', class: 'btn primary' }, has ? 'Substituir chave' : 'Salvar chave'),
      has && h('button', { type: 'button', class: 'btn', onclick: test_ }, 'Testar conexão'),
      has && h('button', { type: 'button', class: 'btn danger ghost', onclick: remove }, 'Excluir chave'),
    );
  }

  function saveKey(e) {
    e.preventDefault();
    try {
      keyStore.saveApiKey(keyInput.value);
      keyInput.value = '';
      toast('Chave salva no localStorage deste navegador.', 'success');
      draw();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function test_(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      draw({ ok: true, info: await aiClient.testConnection() });
    } catch (err) {
      draw({ ok: false, message: errorMessage(err) });
    } finally {
      btn.disabled = false;
    }
  }

  async function remove() {
    const ok = await confirmDialog({ title: 'Excluir chave?', message: 'A chave será apagada deste navegador. Você pode cadastrá-la de novo depois.', confirmLabel: 'Excluir', danger: true });
    if (!ok) return;
    keyStore.deleteApiKey();
    toast('Chave excluída.', 'success');
    draw();
  }

  function saveModel(e) {
    e.preventDefault();
    keyStore.saveModel(modelInput.value);
    modelInput.value = keyStore.getModel();
    toast('Modelo salvo.', 'success');
  }

  // ---------- Pasta dos PDFs ----------
  const folderStatus = h('div', { class: 'stack' });

  async function drawFolder() {
    if (!storage.isSupported) {
      mount(folderStatus, h('p', { class: 'banner' }, unsupportedMessage()));
      return;
    }
    const folder = await storage.getFolder();
    const perm = await storage.permission();
    const [cls, text] = !folder
      ? ['off', 'Nenhuma pasta escolhida.']
      : perm === 'granted'
        ? ['ok', `Pasta: ${folder.name} — acesso liberado nesta sessão.`]
        : ['saved', `Pasta: ${folder.name} — o navegador vai pedir confirmação no primeiro uso da sessão.`];
    mount(folderStatus,
      h('div', { class: 'key-status' }, h('span', { class: `dot ${cls}` }), text),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => folderAction(storage.chooseFolder, 'Pasta definida.') }, folder ? 'Trocar pasta' : 'Escolher pasta'),
        folder && perm !== 'granted' && h('button', { class: 'btn', onclick: () => folderAction(storage.ensureAccess, 'Acesso liberado.') }, 'Liberar acesso agora'),
      ),
    );
  }

  async function folderAction(fn, message) {
    try {
      await fn();
      toast(message, 'success');
    } catch (err) {
      if (err.name !== 'AbortError') toast(errorMessage(err), 'error');
    }
    drawFolder();
  }

  // ---------- Exportação (sem a chave, por construção) ----------
  async function exportJson() {
    const books = await loadBooks({ force: true });
    const lessons = await loadLessons({ force: true }).catch(() => []);
    const payload = {
      app: 'RafaBooks',
      exportedAt: new Date().toISOString(),
      books: books.map(({ id, title, author, year, summary, ideas, file, analysis }) => ({ id, title, author, year, summary, ideas, file, analysis })),
      lessons: lessons.map(({ id, title, intro, closing, themes, focus, steps, analysis }) => ({ id, title, intro, closing, themes, focus, steps, analysis })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    h('a', { href: url, download: `rafabooks-${new Date().toISOString().slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // ---------- Biblioteca pública ----------
  const publicStatus = h('div', { class: 'stack' });

  async function drawPublic() {
    const ownerUid = await getPublicLibraryUid();
    const isPublic = ownerUid === state.user.uid;
    mount(publicStatus,
      h('div', { class: 'key-status' },
        h('span', { class: `dot ${isPublic ? 'ok' : 'off'}` }),
        isPublic ? 'Pública — visitantes podem ler a biblioteca.' : 'Privada — só você acessa, com login.'),
      h('div', {}, h('button', {
        class: `btn ${isPublic ? '' : 'primary'}`,
        onclick: async (e) => {
          const btn = e.currentTarget;
          if (isPublic) {
            const ok = await confirmDialog({
              title: 'Tornar a biblioteca privada?',
              message: 'Visitantes deixam de ver livros, ideias e lições. Links de lições compartilhadas continuam funcionando até você parar de compartilhá-las.',
              confirmLabel: 'Tornar privada',
            });
            if (!ok) return;
          }
          btn.disabled = true;
          try {
            await setLibraryPublic(state.user.uid, !isPublic);
            toast(isPublic ? 'Biblioteca privada.' : 'Biblioteca pública para visitantes.', 'success');
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
          drawPublic();
        },
      }, icon(isPublic ? 'x' : 'eye', { size: 16 }), isPublic ? 'Tornar privada' : 'Tornar pública')),
    );
  }

  mount(root,
    h('div', { class: 'page-head' }, h('div', {}, h('span', { class: 'eyebrow' }, 'Ajustes'), h('h1', {}, 'Configurações'))),
    h('div', { class: 'settings-grid' },
    h('section', { class: 'panel stack' },
      head('eye', 'Acesso de visitantes'),
      h('p', { class: 'muted small' },
        'Com a biblioteca pública, qualquer pessoa pode clicar em "Entrar como visitante" na tela de login e ler livros, ',
        'resumos, ideias, temas e lições — sem conta. Visitantes não cadastram, não editam, não geram nada com IA ',
        '(sua chave nunca é usada por eles) e não acessam seus PDFs.'),
      publicStatus,
    ),
    h('section', { class: 'panel stack' },
      head('key', 'Chave do OpenRouter'),
      h('p', { class: 'muted small' },
        'A chave fica guardada somente no localStorage deste navegador e é usada apenas nas chamadas ao OpenRouter. ',
        'Ela não vai para o Firestore, para o código nem para exportações. Dica: crie uma chave exclusiva para o RafaBooks com limite de crédito em ',
        h('a', { href: 'https://openrouter.ai/settings/keys', target: '_blank', rel: 'noopener' }, 'openrouter.ai/settings/keys'), '.'),
      status,
      h('form', { class: 'stack', onsubmit: saveKey, autocomplete: 'off' }, keyInput, actions),
    ),
    h('section', { class: 'panel stack' },
      head('cpu', 'Modelo de IA'),
      h('p', { class: 'muted small' },
        'Identificador do modelo no OpenRouter. Prefira modelos com contexto grande e preço baixo para livros extensos. Veja a lista em ',
        h('a', { href: 'https://openrouter.ai/models', target: '_blank', rel: 'noopener' }, 'openrouter.ai/models'), '.'),
      h('form', { class: 'row wrap', onsubmit: saveModel }, modelInput, h('button', { type: 'submit', class: 'btn' }, 'Salvar modelo')),
    ),
    h('section', { class: 'panel stack' },
      head('folder', 'Pasta dos PDFs'),
      h('p', { class: 'muted small' },
        'Os PDFs ficam numa pasta do seu computador; nada é enviado para a nuvem. ',
        'Dica: escolha uma pasta sincronizada (OneDrive, Google Drive para computador, Dropbox) para ter backup automático. ',
        'Se você trocar de pasta, mova os PDFs junto — os livros guardam apenas o nome do arquivo.'),
      folderStatus,
    ),
    h('section', { class: 'panel stack' },
      head('archive', 'Backup'),
      h('p', { class: 'muted small' }, 'Exporta metadados, resumos, ideias e lições em JSON. Os PDFs continuam na sua pasta. A chave do OpenRouter nunca é incluída.'),
      h('div', {}, h('button', { class: 'btn', onclick: exportJson }, icon('download', { size: 16 }), 'Exportar biblioteca (JSON)')),
    ),
    ),
  );
  draw();
  drawFolder();
  drawPublic();
}
