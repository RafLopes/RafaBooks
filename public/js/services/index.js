// Ponto único onde os provedores concretos são ligados.
// Para trocar a pasta local ou o OpenRouter por outro serviço, basta alterar aqui:
// a interface só conhece `storage` e `aiClient`.

import { createFolderStorage } from './storage/folder-storage.js';
import { createOpenRouterClient } from './ai/openrouter-client.js';
import { getApiKey } from './ai/api-key-store.js';

export const storage = createFolderStorage();

export const aiClient = createOpenRouterClient({ getApiKey });
