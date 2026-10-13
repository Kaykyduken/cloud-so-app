# cloud-so-app — SO Dashboard

Dashboard de monitoramento do sistema operacional em tempo real, feito com **Node.js e Express**
usando só os módulos nativos `os`, `process` e `fs`. A mesma base de código roda localmente,
em container (Render) e como função serverless (Vercel), e mostra as diferenças entre esses ambientes.

Projeto da disciplina de **Sistemas Operacionais** — Fatec Itapetininga, ADS 3º ciclo.

| Ambiente | Link |
|---|---|
| Render (container) | https://cloud-so-app-ul2l.onrender.com |
| Vercel (serverless) | https://cloud-so-app.vercel.app |

> No plano gratuito do Render o serviço hiberna após 15 minutos sem acesso; o primeiro carregamento depois disso pode demorar.

---

## O que o dashboard mostra

- **Painel executivo:** uso de RAM, CPU média, uptime do SO, arquivos do projeto, IP principal, nº de processos e **status geral** (NORMAL / ATENÇÃO / ALTO USO).
- **Gerenciador de tarefas:** processos visíveis para a aplicação, com PID, PPID, usuário, estado, threads, %CPU, memória e a árvore "filho ← pai" da própria aplicação, além de gráficos de desempenho.
- **Sistema operacional:** hostname, tipo, kernel, arquitetura, endianness, versão do Node.js e fuso horário.
- **CPU e memória:** modelo, núcleos, carga média, uso por núcleo e, em container, os limites reais do **cgroup**.
- **Ambiente de execução:** detecta automaticamente se está rodando localmente, no Render, na Vercel, na Railway, na AWS Lambda ou em Kubernetes; mostra modelo de execução, região, porta, `NODE_ENV`, variáveis de ambiente (só as não sensíveis) e indícios de virtualização.
- **Rede, arquivos do projeto, usuário do processo e dados do processo Node** (RSS, heap, tempo de CPU).

## Rotas

| Rota | Função |
|---|---|
| `/` | Página do dashboard (atualiza a cada 3 s) |
| `/api/info` | JSON com todas as informações do sistema, do ambiente e do processo |
| `/api/processos` | JSON com a lista de processos (gerenciador de tarefas) |
| `/health` | `{"status":"ok"}` — usada pelas plataformas para verificar se o serviço está no ar |

## Como rodar localmente

Requer **Node.js 22**.

```bash
npm install
npm start
```

Acesse http://localhost:3000. Para parar, `Ctrl+C`.

> No Windows, se o PowerShell bloquear o `npm` ("execução de scripts foi desabilitada"), rode uma vez
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Como os processos são lidos

| Sistema | Fonte |
|---|---|
| Linux (local, Render, Vercel) | Sistema de arquivos virtual `/proc` (`/proc/<PID>/stat`, `status`, `cmdline`) |
| Windows | WMI `Win32_Process` via PowerShell (PPID, linha de comando, threads) + `tasklist /v` (dono do processo) |
| macOS / outros | Comando `ps` |

O %CPU de cada processo é calculado pela diferença do tempo de CPU acumulado entre duas leituras.

## Deploy

| | Render | Vercel |
|---|---|---|
| Tipo | Web Service (Node) | Projeto importado do GitHub |
| Build | `npm install` | automático (preset Express) |
| Start | `npm start` | não há: a plataforma importa o `app` exportado pelo `index.js` |
| Porta | definida pela plataforma em `PORT` | não se aplica (serverless) |
| Deploy contínuo | a cada push na `main` | a cada push na `main` |

A versão do Node é fixada no `package.json` (`"engines": { "node": "22.x" }`) e respeitada pelas duas plataformas.

## Estrutura

```
cloud-so-app/
├── index.js          # servidor Express, rotas e coleta das informações do SO
├── processos.js      # gerenciador de tarefas (Linux, Windows e macOS)
├── public/
│   └── index.html    # dashboard (HTML, CSS e JavaScript)
├── prints/           # capturas da Aula 06
├── MANUAL.md         # manual da Aula 06 (criação, deploy no Render e conceitos de SO)
├── package.json
├── .gitattributes    # mantém quebras de linha LF no repositório
└── .gitignore
```

## Documentação

- **Aula 06** — [MANUAL.md](MANUAL.md): criação do projeto, deploy no Render e comparação local × nuvem.
- **Aula 07** — [Relatório comparativo Local × Render × Vercel](https://github.com/Kaykyduken/Fatec-3-ciclo-ADS/blob/main/Sistemas-Operacionais/Aula-7/RELATORIO.md), no repositório da disciplina.

## Autor

**Kayky Gabriel Silvano Tomé** — Análise e Desenvolvimento de Sistemas, FATEC Itapetininga
Professor: Prof. Me. Deivison S. Takatu
