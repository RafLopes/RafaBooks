// Persistência dos metadados dos livros no Firestore.
// Caminho: users/{uid}/books/{bookId}
// Os PDFs ficam numa pasta do computador; aqui guardamos apenas o fileId
// (nome do arquivo na pasta) e os dados do livro.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';

const booksCol = (uid) => collection(db, 'users', uid, 'books');

export function newBookId(uid) {
  return doc(booksCol(uid)).id;
}

export async function listBooks(uid) {
  const snap = await getDocs(query(booksCol(uid), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getBook(uid, id) {
  const snap = await getDoc(doc(booksCol(uid), id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createBook(uid, id, data) {
  await setDoc(doc(booksCol(uid), id), sanitize({ ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
}

export async function updateBook(uid, id, data) {
  await updateDoc(doc(booksCol(uid), id), sanitize({ ...data, updatedAt: serverTimestamp() }));
}

export async function deleteBook(uid, id) {
  await deleteDoc(doc(booksCol(uid), id));
}

/** Lista única de temas já usados, para manter a classificação consistente. */
export function collectThemes(books) {
  const map = new Map();
  for (const b of books) {
    for (const idea of b.ideas ?? []) {
      const t = idea.theme?.trim();
      if (t && !map.has(t.toLowerCase())) map.set(t.toLowerCase(), t);
    }
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Firestore rejeita undefined; removemos para evitar erros silenciosos.
function sanitize(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
