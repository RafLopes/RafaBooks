// Estado compartilhado entre as telas (usuário atual + cache de livros e lições).

import * as repo from '../services/books-repo.js';
import * as lessonsRepo from '../services/lessons-repo.js';

export const state = {
  user: null,
  // Visitante: lê a biblioteca pública do dono, sem login e sem poder alterar nada.
  visitor: false,
  libraryUid: null, // de quem é a biblioteca exibida
  books: null, // null = ainda não carregado
  lessons: null,
};

/** Só o dono logado pode cadastrar, editar, gerar com IA ou compartilhar. */
export function canEdit() {
  return Boolean(state.user) && !state.visitor;
}

export async function loadBooks({ force = false } = {}) {
  if (!state.books || force) state.books = await repo.listBooks(state.libraryUid);
  return state.books;
}

export function findBook(id) {
  return state.books?.find((b) => b.id === id) ?? null;
}

export function invalidateBooks() {
  state.books = null;
}

export async function loadLessons({ force = false } = {}) {
  if (!state.lessons || force) state.lessons = await lessonsRepo.listLessons(state.libraryUid);
  return state.lessons;
}

export function findLesson(id) {
  return state.lessons?.find((l) => l.id === id) ?? null;
}

export function invalidateLessons() {
  state.lessons = null;
}
