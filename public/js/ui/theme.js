// Tema claro/escuro. Sem escolha salva, segue o sistema operacional.

const KEY = 'rafabooks.theme';

export function currentTheme() {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch { /* preferência só vale nesta sessão */ }
  return next;
}
