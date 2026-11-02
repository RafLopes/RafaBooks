// Persistência das lições no Firestore.
// Caminho: users/{uid}/lessons/{lessonId}

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';

const lessonsCol = (uid) => collection(db, 'users', uid, 'lessons');

export function newLessonId(uid) {
  return doc(lessonsCol(uid)).id;
}

export async function listLessons(uid) {
  const snap = await getDocs(query(lessonsCol(uid), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createLesson(uid, id, data) {
  await setDoc(doc(lessonsCol(uid), id), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export async function updateLesson(uid, id, data) {
  await updateDoc(doc(lessonsCol(uid), id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteLesson(uid, id) {
  await deleteDoc(doc(lessonsCol(uid), id));
}
