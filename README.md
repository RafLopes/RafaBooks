# RafaBooks

Biblioteca pessoal de livros em PDF, com resumo, principais ideias (com citações literais), ideias agrupadas por tema e **lições para a vida** geradas a partir delas.

- **Frontend estático**: HTML, CSS e JavaScript puro (ES modules, sem build).
- **Firebase**: Hosting, Authentication (e-mail e senha) e Firestore (só metadados, resumos e ideias).
- **Pasta local** (File System Access API): os PDFs ficam numa pasta do seu computador escolhida por você — nada vai para a nuvem.
- **OpenRouter** (opcional): gera resumo e ideias direto do navegador, com a sua chave guardada só no `localStorage`.

## Estrutura

```
public/
  index.html
  css/styles.css
  js/
    app.js                      roteador (hash) e login
    config/app-config.js        limites de IA e do app
    config/firebase-config.js   config do Firebase (local, fora do Git; modelo: firebase-config.example.js)
    services/
      index.js                  liga os provedores concretos (troque aqui armazenamento/IA)
      firebase.js, auth.js
      books-repo.js             Firestore: users/{uid}/books/{bookId}
      storage/folder-storage.js pasta local: copiar, abrir, listar, apagar PDFs
      pdf/pdf-text.js           extração de texto e capa com pdf.js
      ai/openrouter-client.js   chamadas ao OpenRouter (com retry)
      ai/book-analyzer.js       resumo + ideias por partes (map-reduce) e citações verificadas
      ai/lesson-generator.js    lições por tema a partir das ideias salvas
      lessons-repo.js           Firestore: users/{uid}/lessons/{lessonId}
      ai/api-key-store.js       chave no localStorage
    ui/
      dom.js, icons.js, theme.js, store.js
      views/                    library, book-detail, book-form, themes, lessons, settings
firestore.rules                 cada usuário só acessa os próprios dados
firebase.json
```

## Configuração (uma vez)

### 1. Projeto Firebase

1. Acesse <https://console.firebase.google.com> → **Adicionar projeto** (ex.: `rafabooks`). O Google Analytics é opcional.
2. **Authentication** → *Começar* → *Método de login* → **E-mail/senha** → ative a primeira opção (não precisa do "Link de e-mail") → *Salvar*.
   Crie a sua conta em *Authentication → Usuários → Adicionar usuário* (o app não tem tela de cadastro) e, em
   *Authentication → Configurações → Ações do usuário*, desmarque **Ativar criação (inscrição)** para ninguém mais se cadastrar.
3. **Firestore Database** → *Criar banco de dados* → modo de produção → escolha a região (ex.: `southamerica-east1`).
4. **Configurações do projeto** (engrenagem) → *Seus apps* → ícone **Web `</>`** → registre o app (não precisa marcar Hosting aqui).
   Copie `public/js/config/firebase-config.example.js` para `public/js/config/firebase-config.js` e preencha
   `apiKey`, `authDomain`, `projectId` e `appId`. Esse arquivo fica fora do Git (`.gitignore`).

> A config web do Firebase não é segredo. A segurança vem das `firestore.rules`.

### 2. Hosting e domínios

O projeto é `rafabook-13e98`, mas o site do Hosting usado é `rafabook` (ver `"site"` em `firebase.json`),
publicado em <https://rafabook.web.app> e <https://rafabook.firebaseapp.com>.

No Firebase → **Authentication → Configurações → Domínios autorizados**, confira que `rafabook.web.app` e
`rafabook.firebaseapp.com` estão na lista (domínios de sites extras podem precisar ser adicionados à mão).

### 3. Pasta dos PDFs

Na primeira vez que você adicionar um PDF (ou em **Configurações → Pasta dos PDFs**), o navegador pede para escolher uma pasta.

- Funciona no **Chrome e no Edge para desktop**. No **Brave**, ative antes em `brave://flags/#file-system-access-api` → *Enabled* → *Relaunch*. Em outros navegadores e no celular, resumos e ideias funcionam, mas os PDFs não abrem.
- O navegador lembra a pasta, mas costuma pedir confirmação de acesso uma vez por sessão.
- Recomendado: use uma pasta sincronizada (OneDrive, Google Drive para computador, Dropbox) para ter backup.
- Ao adicionar um livro você pode **copiar** um PDF de qualquer lugar para a pasta, ou **vincular** um PDF que já está nela.
- Os livros guardam só o **nome do arquivo**. Se renomear ou mover um PDF para fora da pasta, o vínculo se perde (basta editar o livro e vincular de novo).
- Excluir um livro **não** apaga o PDF, a menos que você marque essa opção na confirmação.

### 4. Firebase CLI

```bash
firebase login
```

```bash
firebase deploy --only firestore:rules
```

## Rodando localmente

Os módulos ES precisam ser servidos por HTTP (abrir o `index.html` direto não funciona):

```bash
firebase serve --only hosting
```

Abra <http://localhost:5000>.

## Publicando

```bash
firebase deploy
```

## Como funciona a IA

1. O PDF é lido **no navegador** com pdf.js; o texto de cada página recebe um marcador `[p. N]`.
2. Livros curtos (até ~60 mil caracteres) são analisados em uma chamada.
   Livros longos são divididos em blocos: cada bloco gera um resumo parcial e ideias (com páginas), e uma chamada final
   consolida tudo em um resumo geral e uma lista de ideias sem duplicatas.
3. Os temas já existentes na sua biblioteca são enviados ao modelo para manter a classificação consistente (ex.: "Filosofia antiga").
4. O resultado preenche o formulário; **nada é salvo até você revisar e clicar em Salvar**.

Limites e tamanhos de bloco ficam em `public/js/config/app-config.js` (`ai`). O modelo padrão é `deepseek/deepseek-v4-flash`
(barato e com contexto grande) e pode ser trocado em **Configurações**.

PDFs escaneados (só imagem) não têm texto extraível; nesse caso use o modo manual.

### Citações literais

Cada ideia pode ter uma `quote`: um trecho **literal** do livro. Na análise, o modelo propõe o trecho e o app
confere se ele existe de verdade no texto do PDF (ignorando acentos, pontuação e quebras de linha); trechos
inventados são descartados. Para livros analisados antes disso, use **Editar → Buscar citações**, que procura
trechos só nas páginas de cada ideia (custo baixo).

### Lições para a vida

Em **Lições**, escolha um ou mais temas (e, se quiser, um foco como "lidar com ansiedade no trabalho").
A lição é escrita a partir das **ideias já salvas** — os PDFs não são relidos — com explicação, exercício
prático e pergunta de reflexão em cada passo. O modelo só aponta quais ideias sustentam cada passo; as
citações exibidas vêm sempre dos dados salvos, nunca do texto gerado. Também é possível escrever lições à mão.

### Compartilhar lições

Na leitura de uma lição, **Compartilhar → Criar link público** gera um endereço `https://rafabook.web.app/s/<código>`
para enviar por WhatsApp ou qualquer outro meio. Quem recebe vê só aquela lição, sem login.

- Uma cópia da lição é gravada em `shared/{código}`; o código é aleatório (128 bits) e a coleção não pode ser listada.
- Os livros, ideias, PDFs e demais lições continuam privados; a página pública não tem links para eles.
- Ao editar a lição, o link passa a mostrar a versão nova. **Parar de compartilhar** apaga a cópia e o link deixa de funcionar.
- A prévia do link no WhatsApp mostra um título genérico ("Uma lição para a vida"), porque o site é estático;
  a mensagem enviada já leva o título da lição.

### Visitantes (biblioteca pública)

Em **Ajustes → Acesso de visitantes → Tornar pública**, a tela de login passa a mostrar **Entrar como visitante**.
Visitantes leem livros, resumos, ideias, temas e lições, mas não cadastram, não editam, não geram nada com IA
(a chave do OpenRouter fica só no navegador do dono) e não acessam os PDFs, que estão na pasta do seu computador.

- O documento `site/library` guarda qual usuário tem a biblioteca pública; as regras do Firestore liberam
  **somente leitura** de `users/{esse uid}/books` e `/lessons` enquanto ele existir.
- **Tornar privada** apaga esse documento e os visitantes perdem o acesso na hora.
- Não há mais "Criar conta" na tela de login. Para bloquear cadastros também pela API, desmarque
  **Authentication → Configurações → Ações do usuário → Ativar criação (inscrição)** no console do Firebase.

### Sobre a chave do OpenRouter

- Fica **apenas** no `localStorage` do navegador, nunca no código, no Git, no Firestore ou na exportação JSON.
- É enviada só no cabeçalho `Authorization` das chamadas a `openrouter.ai`.
- Recomendação: crie uma chave exclusiva para o RafaBooks com **limite de crédito** em <https://openrouter.ai/settings/keys>.
  Qualquer script rodando na mesma origem pode ler o `localStorage`, então o limite reduz o prejuízo em caso de vazamento.

## Modelo de dados (Firestore)

`users/{uid}/books/{bookId}`

```js
{
  title, author, year,
  summary: "texto",
  ideas: [{ id, title, description, theme, pages: [12, 40], quote }],
  file: { fileId, name, size, mimeType, provider }, // fileId = nome do PDF na pasta local
  cover: "data:image/jpeg;base64,...",      // miniatura da 1ª página (~30 KB)
  analysis: { mode: "manual" | "ai", model?, generatedAt? },
  createdAt, updatedAt
}
```

`users/{uid}/lessons/{lessonId}`

```js
{
  title, intro, closing, themes: ["Estoicismo"], focus,
  steps: [{ id, title, text, practice, question,
            citations: [{ bookId, bookTitle, author, ideaId, ideaTitle, quote, pages }] }],
  analysis: { mode: "manual" | "ai", model?, generatedAt? },
  createdAt, updatedAt
}
```
