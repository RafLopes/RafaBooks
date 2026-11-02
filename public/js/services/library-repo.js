// Configuração da biblioteca pública (documento site/library).
// Quando existe, visitantes sem login podem ler os livros e lições do dono.

import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';

const ref = () => doc(db, 'site', 'library');

/** uid do dono da biblioteca pública, ou null se ela não for pública. */
export async function getPublicLibraryUid() {
  try {
    const snap = await getDoc(ref());
    return snap.exists() ? snap.data().ownerUid : null;
  } catch {
    return null;
  }
}

export async function setLibraryPublic(uid, isPublic) {
  if (isPublic) await setDoc(ref(), { ownerUid: uid, updatedAt: serverTimestamp() });
  else await deleteDoc(ref());
}
