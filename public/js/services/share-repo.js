// Compartilhamento público de lições.
//
// Ao compartilhar, uma CÓPIA da lição é gravada em shared/{shareId}, onde
// shareId é um identificador aleatório de 128 bits (impossível de adivinhar).
// Qualquer pessoa com o link lê essa cópia; ninguém consegue listar a coleção,
// e os livros, ideias e demais lições continuam privados.

import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function shareUrl(shareId) {
  return `${location.origin}/s/${shareId}`;
}

/** Só o que é necessário para leitura; nada de ids internos dos livros. */
function snapshot(lesson) {
  return {
    title: lesson.title,
    intro: lesson.intro ?? '',
    closing: lesson.closing ?? '',
    themes: lesson.themes ?? [],
    focus: lesson.focus ?? '',
    steps: (lesson.steps ?? []).map((s) => ({
      title: s.title ?? '',
      text: s.text ?? '',
      practice: s.practice ?? '',
      question: s.question ?? '',
      citations: (s.citations ?? []).map((c) => ({
        bookTitle: c.bookTitle ?? '',
        author: c.author ?? '',
        ideaTitle: c.ideaTitle ?? '',
        quote: c.quote ?? '',
        pages: c.pages ?? [],
      })),
    })),
  };
}

/** Cria ou atualiza a cópia pública. Retorna o shareId. */
export async function publishLesson(uid, lesson) {
  const shareId = lesson.shareId || randomId();
  await setDoc(doc(db, 'shared', shareId), { ...snapshot(lesson), ownerUid: uid, updatedAt: serverTimestamp() });
  return shareId;
}

export async function unpublishLesson(shareId) {
  await deleteDoc(doc(db, 'shared', shareId));
}

export async function getSharedLesson(shareId) {
  const snap = await getDoc(doc(db, 'shared', shareId));
  return snap.exists() ? snap.data() : null;
}
