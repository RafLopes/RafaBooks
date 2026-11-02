// A chave do OpenRouter vive SOMENTE no localStorage deste navegador.
// Não vai para o Firestore, para exportações, nem para logs.

import { ai } from '../../config/app-config.js';

const KEY_STORAGE = 'rafabooks.openrouter.key';
const MODEL_STORAGE = 'rafabooks.openrouter.model';

function read(name) {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

function write(name, value) {
  try {
    if (value == null) localStorage.removeItem(name);
    else localStorage.setItem(name, value);
    return true;
  } catch {
    return false;
  }
}

export function getApiKey() {
  return read(KEY_STORAGE) || '';
}

export function hasApiKey() {
  return getApiKey().length > 0;
}

export function saveApiKey(key) {
  const clean = String(key).trim();
  if (!clean) throw new Error('Informe uma chave.');
  if (!write(KEY_STORAGE, clean)) throw new Error('Não foi possível salvar no localStorage deste navegador.');
}

export function deleteApiKey() {
  write(KEY_STORAGE, null);
}

/** Exibição segura: só os últimos 4 caracteres. */
export function maskedApiKey() {
  const k = getApiKey();
  return k ? `••••••••${k.slice(-4)}` : '';
}

export function getModel() {
  return read(MODEL_STORAGE) || ai.defaultModel;
}

export function saveModel(model) {
  write(MODEL_STORAGE, String(model).trim() || null);
}
