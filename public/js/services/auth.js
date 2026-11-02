import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase.js';

export function onUserChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function currentUser() {
  return auth.currentUser;
}

export async function signIn(email, password) {
  await withFriendlyErrors(() => signInWithEmailAndPassword(auth, email.trim(), password));
}

export async function resetPassword(email) {
  await withFriendlyErrors(() => sendPasswordResetEmail(auth, email.trim()));
}

export async function signOut() {
  await fbSignOut(auth);
}

const MESSAGES = {
  'auth/invalid-email': 'E-mail inválido.',
  'auth/missing-email': 'Informe o e-mail.',
  'auth/missing-password': 'Informe a senha.',
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/user-disabled': 'Esta conta foi desativada.',
  'auth/email-already-in-use': 'Já existe uma conta com este e-mail. Use "Entrar".',
  'auth/weak-password': 'Senha fraca: use pelo menos 6 caracteres.',
  'auth/password-does-not-meet-requirements': 'A senha não atende aos requisitos definidos no Firebase.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Sem conexão com o Firebase. Verifique sua internet.',
  'auth/operation-not-allowed': 'Login por e-mail/senha não está ativado no Firebase (Authentication → Método de login).',
  'auth/admin-restricted-operation': 'A criação de contas está desativada no Firebase.',
};

async function withFriendlyErrors(fn) {
  try {
    return await fn();
  } catch (err) {
    const friendly = new Error(MESSAGES[err?.code] ?? 'Não foi possível concluir a operação. Tente novamente.');
    friendly.code = err?.code;
    throw friendly;
  }
}
