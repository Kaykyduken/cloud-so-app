# Manual — cloud-so-app

**Disciplina:** Sistemas Operacionais — Aula 06: Nuvem e Sistemas Operacionais
**Aluno:** (seu nome)
**Repositório:** (link do GitHub)
**Aplicação online:** (link .onrender.com)

> Substitua tudo que estiver entre parênteses pelos seus dados e prints.

---

## 1. Objetivo

(Em 2–3 linhas: o que a aplicação faz e o que a atividade quer demonstrar.)

## 2. Instalação das ferramentas

| Ferramenta | Versão usada | Como verificar |
|---|---|---|
| Node.js (LTS) | ( ) | `node -v` |
| npm | ( ) | `npm -v` |
| Git | ( ) | `git --version` |
| VS Code | ( ) | Ajuda → Sobre |

Contas criadas: GitHub e Render (login com GitHub).

## 3. Criação do projeto

```bash
mkdir cloud-so-app
cd cloud-so-app
npm init -y
npm install express cors
```

Estrutura final:

```
cloud-so-app/
├── index.js          # servidor Express + rota /api/info
├── public/index.html # página que exibe os dados
├── package.json
├── .gitignore
└── MANUAL.md
```

## 4. Desenvolvimento da aplicação

(Explique com suas palavras:)
- O que é cada rota (`/`, `/api/info`, `/health`).
- Quais funções do módulo `os` foram usadas e o que cada uma retorna.
- Por que usar `process.env.PORT || 3000`.
- Como a página atualiza os dados a cada 2 segundos.

## 5. Execução e testes locais

```bash
npm start
```

Acessar `http://localhost:3000`.

(Print da página rodando localmente.)

| Teste | Resultado esperado | Resultado obtido |
|---|---|---|
| `npm start` | Mensagem "rodando na porta 3000" | ( ) |
| Abrir `localhost:3000` | Página com os dados | ( ) |
| Abrir `localhost:3000/api/info` | JSON com os dados | ( ) |
| Abrir `localhost:3000/health` | `{"status":"ok"}` | ( ) |

## 6. Publicação no GitHub

```bash
git init
git add .
git commit -m "Primeira versão do cloud-so-app"
git branch -M main
git remote add origin (URL do seu repositório)
git push -u origin main
```

(Print do repositório.)

## 7. Publicação no Render

| Campo | Valor |
|---|---|
| Tipo de serviço | Web Service |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free |

(Print do deploy concluído e da aplicação online.)

## 8. Comparação: local × nuvem

| Informação | Minha máquina | Render | Por que é diferente? |
|---|---|---|---|
| Ambiente | Local | Nuvem (Render) | |
| Nome do host | ( ) | ( ) | |
| Plataforma / Kernel | ( ) | ( ) | |
| Arquitetura | ( ) | ( ) | |
| Quantidade de CPUs | ( ) | ( ) | |
| Cota de CPU do container | ( ) | ( ) | |
| Memória total | ( ) | ( ) | |
| Limite do container | ( ) | ( ) | |
| Memória livre | ( ) | ( ) | |
| Tempo de atividade do SO | ( ) | ( ) | |
| Tempo de atividade do processo | ( ) | ( ) | |
| PID | ( ) | ( ) | |

## 9. Conceitos de Sistemas Operacionais na aplicação

### 9.1 Processos
### 9.2 Gerenciamento de memória
### 9.3 Uso de CPU
### 9.4 Sistema operacional hospedeiro
### 9.5 Virtualização e containers
### 9.6 Computação em nuvem (modelo de serviço, características NIST)

## 10. Conclusões

(O que você aprendeu; principais diferenças entre local e nuvem; vantagens e limitações do plano gratuito.)

## 11. Referências

- TANENBAUM, A. S.; BOS, H. *Sistemas Operacionais Modernos*. 4. ed. Pearson, 2016.
- SILBERSCHATZ, A.; GALVIN, P. B.; GAGNE, G. *Fundamentos de Sistemas Operacionais*. 9. ed. LTC, 2015.
- NIST SP 800-145 — The NIST Definition of Cloud Computing.
- Documentação do Node.js — módulo `os`: https://nodejs.org/api/os.html
- Documentação do Render: https://render.com/docs
