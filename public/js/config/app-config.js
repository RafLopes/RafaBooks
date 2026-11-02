// Configuração da aplicação.
//
// A config do Firebase fica em firebase-config.js (fora do Git; modelo em
// firebase-config.example.js). A proteção dos dados vem das regras do Firestore.
//
// NUNCA coloque a chave do OpenRouter aqui. Ela é informada na tela de
// Configurações e fica apenas no localStorage do navegador.

export { firebaseConfig } from './firebase-config.js';

export const ai = {
  defaultModel: 'deepseek/deepseek-v4-flash',
  // Usados automaticamente pelo OpenRouter se o modelo escolhido falhar.
  fallbackModels: ['deepseek/deepseek-v4.1-flash'],
  // Tamanho de cada bloco de texto enviado ao modelo (~4 caracteres por token).
  chunkChars: 60_000,
  // Limite de texto extraído por livro. Acima disso a análise é recusada.
  maxBookChars: 2_500_000,
  maxIdeasPerChunk: 8,
  maxFinalIdeas: 30,
};

export const limits = {
  maxPdfBytes: 500 * 1024 * 1024,
};
