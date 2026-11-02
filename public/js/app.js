import { isConfigured } from './services/firebase.js';
import { h, mount, toast, errorMessage, icon, emptyState, skeleton } from './ui/dom.js';
import { state, invalidateBooks, invalidateLessons, canEdit } from './ui/store.js';
import { currentTheme, toggleTheme } from './ui/theme.js';
import { getPublicLibraryUid } from './services/library-repo.js';

const root = document.getElementById('view');
const nav = document.getElementById('nav');
// Cria a barra de abas se o index.html em cache for de uma versão antiga.
const tabbar = document.getElementById('tabbar') ?? document.body.insertBefore(
  Object.assign(document.createElement('nav'), { id: 'tabbar', className: 'tabbar', hidden: true }),
  document.getElementById('toasts'),
);

const NAV = [
  { href: '#/', route: '#/', label: 'Biblioteca', glyph: 'library' },
  { href: '#/themes', route: '#/themes', label: 'Temas', glyph: 'layers' },
  { href: '#/lessons', route: '#/lessons', label: 'Lições', glyph: 'compass' },
  { href: '#/settings', route: '#/settings', label: 'Ajustes', glyph: 'settings', ownerOnly: true },
];

const VISITOR_KEY = 'rafabooks.visitor';
const visitorFlag = {
  get: () => { try { return localStorage.getItem(VISITOR_KEY) === '1'; } catch { return false; } },
  set: (on) => { try { if (on) localStorage.setItem(VISITOR_KEY, '1'); else localStorage.removeItem(VISITOR_KEY); } catch { /* só nesta sessão */ } },
};

if (!isConfigured) {
  mount(root, emptyState({
    glyph: 'settings',
    title: 'Configuração pendente',
    text: 'Preencha public/js/config/app-config.js com os dados do seu projeto Firebase. Veja o README.',
  }));
} else {
  mount(root, skeleton());
  const shared = /^\/s\/([\w-]{16,})\/?$/.exec(location.pathname);
  if (shared) startPublic(shared[1]);
  else start();
}

// Lição compartilhada: página pública, sem login e sem a navegação do app.
async function startPublic(shareId) {
  const { renderSharedLesson } = await import('./ui/views/shared-lesson.js');
  await renderSharedLesson(root, nav, shareId);
}

function brandMark(size = 18) {
  return h('span', { class: 'brand-mark' }, icon('library', { size }));
}

async function start() {
  // Imports dinâmicos: só carregam o Firebase Auth depois de confirmar a config.
  const auth = await import('./services/auth.js');
  const views = {
    library: (await import('./ui/views/library.js')).renderLibrary,
    book: (await import('./ui/views/book-detail.js')).renderBookDetail,
    form: (await import('./ui/views/book-form.js')).renderBookForm,
    themes: (await import('./ui/views/themes.js')).renderThemes,
    settings: (await import('./ui/views/settings.js')).renderSettings,
    lessons: await import('./ui/views/lessons.js'),
  };
  const { releaseViewer } = await import('./ui/views/book-detail.js');

  const routes = [
    [/^#?\/?$/, () => views.library(root)],
    [/^#\/book\/([\w-]+)$/, (id) => views.book(root, id)],
    [/^#\/new$/, () => views.form(root), 'owner'],
    [/^#\/edit\/([\w-]+)$/, (id) => views.form(root, id), 'owner'],
    [/^#\/themes(?:\/(.+))?$/, (t) => views.themes(root, t && decodeURIComponent(t))],
    [/^#\/lessons$/, () => views.lessons.renderLessonList(root)],
    [/^#\/lessons\/new(?:\/(.+))?$/, (t) => views.lessons.renderLessonComposer(root, t && decodeURIComponent(t)), 'owner'],
    [/^#\/lessons\/([\w-]+)\/edit$/, (id) => views.lessons.renderLessonEditor(root, id), 'owner'],
    [/^#\/lessons\/([\w-]+)$/, (id) => views.lessons.renderLessonReader(root, id)],
    [/^#\/settings$/, () => views.settings(root), 'owner'],
  ];

  async function route() {
    if (!state.user && !state.visitor) return;
    releaseViewer();
    const hash = location.hash || '#/';
    for (const a of document.querySelectorAll('a[data-route]')) {
      const r = a.dataset.route;
      const active = r === '#/' ? /^#\/(book|new|edit)|^#?\/?$/.test(hash) : hash.startsWith(r);
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    for (const [re, fn, access] of routes) {
      const m = re.exec(hash);
      if (!m) continue;
      if (access === 'owner' && !canEdit()) {
        location.hash = '#/';
        return;
      }
      mount(root, skeleton());
      root.classList.remove('view-enter');
      try {
        await fn(...m.slice(1));
      } catch (err) {
        console.error('Erro na tela:', err?.name, err?.code ?? '');
        mount(root, emptyState({ glyph: 'help', title: 'Algo deu errado', text: errorMessage(err), action: h('a', { class: 'btn', href: '#/' }, 'Voltar à biblioteca') }));
      }
      void root.offsetWidth; // reinicia a animação de entrada
      root.classList.add('view-enter');
      window.scrollTo(0, 0);
      return;
    }
    location.hash = '#/';
  }

  // mode: 'signin' | 'reset'
  function renderLogin(mode = 'signin') {
    nav.hidden = true;
    tabbar.hidden = true;
    const email = h('input', { class: 'input', type: 'email', required: true, autocomplete: 'email', 'aria-label': 'E-mail' });
    const password = h('input', { class: 'input', type: 'password', required: true, autocomplete: 'current-password', 'aria-label': 'Senha' });
    const submit = h('button', { type: 'submit', class: 'btn primary large' }, mode === 'signin' ? 'Entrar' : 'Enviar link de recuperação');
    const visitorBox = h('div', { class: 'visitor-box', hidden: true });

    async function onSubmit(e) {
      e.preventDefault();
      submit.disabled = true;
      try {
        if (mode === 'signin') await auth.signIn(email.value, password.value);
        if (mode === 'reset') {
          await auth.resetPassword(email.value);
          toast('Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.', 'success');
          renderLogin('signin');
        }
      } catch (err) {
        toast(errorMessage(err), 'error');
        submit.disabled = false;
      }
    }

    // A opção de visitante só aparece se o dono tornou a biblioteca pública.
    if (mode === 'signin') {
      getPublicLibraryUid().then((ownerUid) => {
        if (!ownerUid) return;
        mount(visitorBox,
          h('div', { class: 'or' }, h('span', {}, 'ou')),
          h('button', { type: 'button', class: 'btn large', style: 'width:100%', onclick: () => enterVisitor(ownerUid) },
            icon('eye', { size: 18 }), 'Entrar como visitante'),
          h('p', { class: 'muted small', style: 'margin:8px 0 0' }, 'Explore os livros, ideias, temas e lições sem precisar de conta.'),
        );
        visitorBox.hidden = false;
      });
    }

    const link = (label, target) => h('button', { type: 'button', class: 'link', onclick: () => renderLogin(target) }, label);

    root.classList.add('view-enter');
    mount(root, h('section', { class: 'login' }, h('div', { class: 'login-card' },
      brandMark(28),
      h('h1', {}, 'RafaBooks'),
      h('p', { class: 'muted' }, mode === 'signin' ? 'Uma biblioteca de livros, ideias e lições para a vida.' : 'Informe seu e-mail para receber o link de nova senha.'),
      h('form', { class: 'login-form stack', onsubmit: onSubmit },
        h('label', { class: 'field' }, h('span', {}, 'E-mail'), email),
        mode === 'signin' && h('label', { class: 'field' }, h('span', {}, 'Senha'), password),
        submit,
        h('div', { class: 'login-links' },
          mode === 'signin' ? link('Esqueci minha senha', 'reset') : link('Voltar para o login', 'signin'),
        ),
      ),
      visitorBox,
    )));
  }

  function enterVisitor(ownerUid) {
    visitorFlag.set(true);
    state.visitor = true;
    state.libraryUid = ownerUid;
    invalidateBooks();
    invalidateLessons();
    renderNav(null);
    route();
  }

  function leaveVisitor() {
    visitorFlag.set(false);
    state.visitor = false;
    state.libraryUid = null;
    renderLogin();
  }

  function themeButton() {
    const btn = h('button', {
      class: 'btn ghost icon-only',
      title: 'Alternar tema claro/escuro',
      'aria-label': 'Alternar tema claro/escuro',
      onclick: () => {
        toggleTheme();
        btn.replaceChildren(icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
      },
    }, icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
    return btn;
  }

  function renderNav(user) {
    nav.hidden = false;
    tabbar.hidden = false;
    const items = NAV.filter((n) => user || !n.ownerOnly);
    mount(nav,
      h('a', { class: 'brand', href: '#/' }, brandMark(), 'RafaBooks'),
      h('div', { class: 'nav-links' },
        items.map((n) => h('a', { href: n.href, dataset: { route: n.route } }, icon(n.glyph, { size: 17 }), n.label)),
      ),
      h('div', { class: 'nav-actions' },
        user
          ? h('a', { class: 'btn primary small', href: '#/new' }, icon('plus', { size: 16 }), h('span', { class: 'hide-mobile' }, 'Livro'))
          : h('span', { class: 'chip hide-mobile', title: 'Modo somente leitura' }, icon('eye', { size: 13 }), 'Visitante'),
        themeButton(),
        user
          ? h('button', { class: 'btn ghost icon-only', title: `Sair (${user.email})`, 'aria-label': 'Sair', onclick: () => auth.signOut() }, icon('logout'))
          : h('button', { class: 'btn small', onclick: leaveVisitor }, 'Entrar'),
      ),
    );
    mount(tabbar, items.map((n) => h('a', { href: n.href, dataset: { route: n.route } }, icon(n.glyph, { size: 20 }), n.label)));
  }

  auth.onUserChange(async (user) => {
    state.user = user;
    invalidateBooks();
    invalidateLessons();
    if (user) {
      visitorFlag.set(false);
      state.visitor = false;
      state.libraryUid = user.uid;
      renderNav(user);
      route();
      return;
    }
    state.libraryUid = null;
    // Visitante que já tinha entrado antes continua como visitante, se a biblioteca ainda for pública.
    const ownerUid = visitorFlag.get() ? await getPublicLibraryUid() : null;
    if (ownerUid) enterVisitor(ownerUid);
    else {
      visitorFlag.set(false);
      state.visitor = false;
      renderLogin();
    }
  });

  window.addEventListener('hashchange', route);
}
