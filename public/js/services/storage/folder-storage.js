// Provedor de armazenamento numa pasta do computador (File System Access API).
//
// Interface (a mesma que qualquer provedor futuro deve implementar):
//   label                                  -> nome exibido na interface
//   isSupported                            -> o navegador suporta este provedor?
//   upload(file, { onProgress, signal })   -> { fileId, name, size, mimeType, provider }
//   download(fileId)                       -> Blob
//   remove(fileId)                         -> void
//   list()                                 -> [{ fileId, name, size }]
//
// O "fileId" é o nome do arquivo dentro da pasta escolhida. O handle da pasta
// fica salvo no IndexedDB deste navegador; nenhuma credencial de nuvem é usada.
// Suportado no Chrome e no Edge para desktop.

const DB_NAME = 'rafabooks';
const STORE = 'handles';
const HANDLE_KEY = 'pdf-folder';
const WRITE_CHUNK = 8 * 1024 * 1024;

export class StorageError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

export function createFolderStorage() {
  const isSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  let dir = null;

  /** Pasta configurada (sem pedir permissão). null se nenhuma foi escolhida. */
  async function getFolder() {
    dir ??= await idbGet(HANDLE_KEY);
    return dir;
  }

  /** Abre o seletor de pasta. Precisa ser chamado a partir de um clique. */
  async function chooseFolder() {
    if (!isSupported) throw unsupported();
    const handle = await window.showDirectoryPicker({ id: 'rafabooks', mode: 'readwrite', startIn: 'documents' });
    await idbSet(HANDLE_KEY, handle);
    dir = handle;
    return handle.name;
  }

  /** 'granted' | 'prompt' | 'denied' | 'none' (nenhuma pasta escolhida) */
  async function permission() {
    const handle = await getFolder();
    if (!handle) return 'none';
    return handle.queryPermission({ mode: 'readwrite' });
  }

  /**
   * Garante acesso de leitura/escrita. O navegador costuma pedir confirmação
   * uma vez por sessão; isso só funciona a partir de um clique do usuário.
   */
  async function ensureAccess() {
    if (!isSupported) throw unsupported();
    const handle = await getFolder();
    if (!handle) {
      // Primeira vez: pede a pasta na hora (o seletor já concede leitura/escrita).
      await chooseFolder();
      return dir;
    }
    if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return handle;
    if (await handle.requestPermission({ mode: 'readwrite' }) === 'granted') return handle;
    throw new StorageError('Acesso à pasta dos PDFs não foi permitido.', 'denied');
  }

  async function upload(file, { onProgress, signal } = {}) {
    const folder = await ensureAccess();
    const name = await freeName(folder, sanitizeName(file.name || 'livro.pdf'));
    const handle = await folder.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      for (let offset = 0; offset < file.size; offset += WRITE_CHUNK) {
        if (signal?.aborted) throw new DOMException('Cancelado.', 'AbortError');
        await writable.write(file.slice(offset, offset + WRITE_CHUNK));
        onProgress?.(Math.min(1, (offset + WRITE_CHUNK) / file.size));
      }
      await writable.close();
    } catch (err) {
      await writable.abort().catch(() => {});
      await folder.removeEntry(name).catch(() => {});
      throw err;
    }
    onProgress?.(1);
    return { fileId: name, name, size: file.size, mimeType: file.type || 'application/pdf', provider: 'local-folder' };
  }

  async function download(fileId) {
    const folder = await ensureAccess();
    try {
      return await (await folder.getFileHandle(fileId)).getFile();
    } catch (err) {
      if (err.name === 'NotFoundError') {
        throw new StorageError(`O arquivo "${fileId}" não está mais na pasta "${folder.name}". Ele pode ter sido movido ou renomeado.`, 'not-found');
      }
      throw err;
    }
  }

  async function remove(fileId) {
    const folder = await ensureAccess();
    try {
      await folder.removeEntry(fileId);
    } catch (err) {
      if (err.name !== 'NotFoundError') throw err; // já não existe
    }
  }

  async function list() {
    const folder = await ensureAccess();
    const files = [];
    for await (const entry of folder.values()) {
      if (entry.kind !== 'file' || !/\.pdf$/i.test(entry.name)) continue;
      const f = await entry.getFile();
      files.push({ fileId: entry.name, name: entry.name, size: f.size });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  return {
    label: 'pasta local',
    isSupported,
    getFolder,
    chooseFolder,
    permission,
    ensureAccess,
    upload,
    download,
    remove,
    list,
  };
}

function unsupported() {
  return new StorageError(unsupportedMessage(), 'unsupported');
}

/** Mensagem explicando por que o acesso a pastas não está disponível. */
export function unsupportedMessage() {
  if (navigator.brave) {
    return 'O Brave vem com o acesso a pastas desativado. Para ativar: abra brave://flags/#file-system-access-api, '
      + 'mude para "Enabled" e clique em "Relaunch". Resumo e ideias funcionam normalmente enquanto isso.';
  }
  return 'Este navegador não acessa pastas do computador. Para vincular PDFs, use o Chrome, o Edge ou o Brave no desktop. '
    + 'Resumo e ideias funcionam normalmente.';
}

function sanitizeName(name) {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return /\.pdf$/i.test(clean) ? clean : `${clean}.pdf`;
}

/** Evita sobrescrever: "livro.pdf" -> "livro (2).pdf" se já existir. */
async function freeName(folder, name) {
  const base = name.replace(/\.pdf$/i, '');
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? name : `${base} (${n}).pdf`;
    try {
      await folder.getFileHandle(candidate);
    } catch (err) {
      if (err.name === 'NotFoundError') return candidate;
      throw err;
    }
  }
  throw new StorageError('Não foi possível encontrar um nome livre para o arquivo.');
}

// ---------- IndexedDB mínimo para guardar o handle da pasta ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(key, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
