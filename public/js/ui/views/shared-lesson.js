// Página pública de uma lição compartilhada (/s/{shareId}). Não exige login.

import { h, mount, icon, emptyState } from '../dom.js';
import { currentTheme, toggleTheme } from '../theme.js';
import { getSharedLesson } from '../../services/share-repo.js';
import { lessonArticle } from './lessons.js';

export async function renderSharedLesson(root, nav, shareId) {
  const themeBtn = h('button', {
    class: 'btn ghost icon-only',
    'aria-label': 'Alternar tema claro/escuro',
    onclick: () => {
      toggleTheme();
      themeBtn.replaceChildren(icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
    },
  }, icon(currentTheme() === 'dark' ? 'sun' : 'moon'));

  nav.hidden = false;
  nav.classList.add('public-top');
  mount(nav,
    h('span', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('library', { size: 18 })), 'RafaBooks'),
    themeBtn,
  );

  let lesson = null;
  try {
    lesson = await getSharedLesson(shareId);
  } catch {
    lesson = null;
  }

  if (!lesson) {
    document.title = 'Lição não encontrada · RafaBooks';
    mount(root, emptyState({
      glyph: 'compass',
      title: 'Lição não encontrada',
      text: 'Este link não existe ou deixou de ser compartilhado pelo autor.',
    }));
    return;
  }

  document.title = `${lesson.title} · RafaBooks`;
  root.classList.add('view-enter');
  mount(root,
    lessonArticle(lesson, { isPublic: true }),
    h('footer', { class: 'public-foot' },
      h('span', { class: 'eyebrow' }, icon('compass', { size: 14 }), 'Lição compartilhada'),
      h('p', {}, 'Criada no RafaBooks a partir de ideias e passagens de livros.'),
    ),
  );
}
