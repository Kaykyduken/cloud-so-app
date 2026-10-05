/**
 * cloud-so-app — SO Dashboard
 * Aplicação Express que monitora o Sistema Operacional onde está rodando,
 * usando os módulos nativos do Node.js (os, process, fs).
 *
 * Disciplina: Sistemas Operacionais
 *  - Aula 06: informações básicas do SO, deploy no Render
 *  - Aula 07: dashboard de monitoramento, gerenciador de tarefas e comparação
 *             Render × Railway × Vercel
 *
 * A mesma base de código roda:
 *  - localmente (npm start)
 *  - em container, como processo contínuo (Render, Railway)
 *  - como função serverless (Vercel), que importa o "app" exportado no fim do arquivo
 */

const express = require('express');
const cors = require('cors');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { obterProcessos } = require('./processos');

const app = express();

// As plataformas de nuvem injetam a porta pela variável de ambiente PORT.
// Localmente, usamos 3000.
const PORT = process.env.PORT || 3000;

app.use(cors());
// Na Vercel, express.static é ignorado: a pasta public/ é servida pela CDN.
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------------ */
/* Funções auxiliares                                                  */
/* ------------------------------------------------------------------ */

function lerArquivo(caminho) {
  try {
    return fs.readFileSync(caminho, 'utf8').trim();
  } catch {
    return null;
  }
}

function tentar(fn, padrao = null) {
  try {
    return fn();
  } catch {
    return padrao;
  }
}

/* ---------- Container / cgroups ---------- */

/**
 * Limite de memória imposto pelo cgroup (Linux).
 * Em containers, os.totalmem() mostra a memória do HOST,
 * mas o limite real do container fica no cgroup.
 */
function limiteMemoriaCgroup() {
  const v2 = lerArquivo('/sys/fs/cgroup/memory.max'); // cgroup v2
  if (v2 && v2 !== 'max') return Number(v2);

  const v1 = lerArquivo('/sys/fs/cgroup/memory/memory.limit_in_bytes'); // cgroup v1
  if (v1) {
    const n = Number(v1);
    if (n > 0 && n < 2 ** 60) return n; // valores gigantes = "sem limite"
  }
  return null;
}

/** Memória que o kernel contabiliza para o cgroup (container) neste momento. */
function memoriaUsadaCgroup() {
  const v2 = lerArquivo('/sys/fs/cgroup/memory.current');
  if (v2) return Number(v2);
  const v1 = lerArquivo('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  return v1 ? Number(v1) : null;
}

/** Cota de CPU imposta pelo cgroup (ex.: 0.15 CPU no plano Free do Render). */
function cotaCpuCgroup() {
  const v2 = lerArquivo('/sys/fs/cgroup/cpu.max'); // formato: "quota periodo"
  if (v2) {
    const [quota, periodo] = v2.split(' ');
    if (quota !== 'max') return Number(quota) / Number(periodo);
  }
  const quota = lerArquivo('/sys/fs/cgroup/cpu/cpu.cfs_quota_us');
  const periodo = lerArquivo('/sys/fs/cgroup/cpu/cpu.cfs_period_us');
  if (quota && periodo && Number(quota) > 0) return Number(quota) / Number(periodo);
  return null;
}

/** Tenta identificar se o processo está rodando dentro de um container. */
function estaEmContainer() {
  if (fs.existsSync('/.dockerenv')) return true;
  const cgroup = lerArquivo('/proc/1/cgroup') || '';
  if (/docker|kubepods|containerd|lxc/i.test(cgroup)) return true;
  return limiteMemoriaCgroup() !== null;
}

/* ---------- Virtualização ---------- */

/**
 * Indícios de máquina virtual: a flag "hypervisor" em /proc/cpuinfo é
 * marcada pelo processador quando o SO roda sobre um hypervisor.
 * Os arquivos DMI (quando acessíveis) mostram o fabricante "virtual".
 */
function infoVirtualizacao() {
  const cpuinfo = lerArquivo('/proc/cpuinfo') || '';
  const flagHypervisor = /\bhypervisor\b/.test(cpuinfo);
  const fabricante = lerArquivo('/sys/class/dmi/id/sys_vendor');
  const produto = lerArquivo('/sys/class/dmi/id/product_name');
  const kernel = os.release();
  return {
    flagHypervisor,
    fabricante,
    produto,
    kernelAws: /aws/i.test(kernel),
  };
}

/* ---------- Ambiente de execução (local × nuvem) ---------- */

/**
 * Cada plataforma injeta variáveis de ambiente próprias.
 * Elas permitem descobrir onde a aplicação está hospedada.
 */
function identificarAmbiente() {
  const e = process.env;
  if (e.VERCEL) {
    return {
      plataforma: 'Vercel',
      tipo: 'Nuvem',
      modelo: 'Serverless (função sob demanda)',
      regiao: e.VERCEL_REGION || e.AWS_REGION || null,
      servico: e.VERCEL_PROJECT_PRODUCTION_URL || e.VERCEL_URL || null,
      etapa: e.VERCEL_ENV || null,
    };
  }
  if (e.RAILWAY_ENVIRONMENT || e.RAILWAY_PROJECT_ID || e.RAILWAY_SERVICE_ID) {
    return {
      plataforma: 'Railway',
      tipo: 'Nuvem',
      modelo: 'Container (processo contínuo)',
      regiao: e.RAILWAY_REPLICA_REGION || null,
      servico: e.RAILWAY_SERVICE_NAME || null,
      etapa: e.RAILWAY_ENVIRONMENT_NAME || e.RAILWAY_ENVIRONMENT || null,
    };
  }
  if (e.RENDER) {
    return {
      plataforma: 'Render',
      tipo: 'Nuvem',
      modelo: 'Container (processo contínuo)',
      regiao: e.RENDER_REGION || null,
      servico: e.RENDER_SERVICE_NAME || null,
      etapa: null,
    };
  }
  if (e.AWS_LAMBDA_FUNCTION_NAME) {
    return {
      plataforma: 'AWS Lambda',
      tipo: 'Nuvem',
      modelo: 'Serverless (função sob demanda)',
      regiao: e.AWS_REGION || null,
      servico: e.AWS_LAMBDA_FUNCTION_NAME,
      etapa: null,
    };
  }
  if (e.KUBERNETES_SERVICE_HOST) {
    return { plataforma: 'Kubernetes', tipo: 'Nuvem', modelo: 'Container (processo contínuo)', regiao: null, servico: null, etapa: null };
  }
  return { plataforma: 'Local', tipo: 'Local', modelo: 'Processo no computador do usuário', regiao: null, servico: null, etapa: null };
}

/**
 * Variáveis de ambiente exibidas no painel.
 * Só mostramos VALORES de uma lista de variáveis conhecidas e não sensíveis;
 * das demais, exibimos apenas a quantidade (podem conter senhas e tokens).
 */
const VARIAVEIS_SEGURAS = [
  'NODE_ENV', 'PORT', 'TZ', 'HOSTNAME',
  // Render
  'RENDER', 'RENDER_SERVICE_NAME', 'RENDER_SERVICE_TYPE', 'RENDER_EXTERNAL_URL', 'RENDER_GIT_BRANCH', 'RENDER_GIT_COMMIT', 'RENDER_INSTANCE_ID',
  // Railway
  'RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_SERVICE_NAME', 'RAILWAY_PROJECT_NAME', 'RAILWAY_PUBLIC_DOMAIN', 'RAILWAY_REPLICA_REGION', 'RAILWAY_REPLICA_ID', 'RAILWAY_GIT_BRANCH', 'RAILWAY_GIT_COMMIT_SHA',
  // Vercel / AWS Lambda
  'VERCEL', 'VERCEL_ENV', 'VERCEL_REGION', 'VERCEL_URL', 'VERCEL_GIT_COMMIT_REF', 'VERCEL_GIT_COMMIT_SHA', 'AWS_REGION', 'AWS_LAMBDA_FUNCTION_MEMORY_SIZE',
];

function variaveisAmbiente() {
  const visiveis = {};
  for (const nome of VARIAVEIS_SEGURAS) {
    if (process.env[nome] !== undefined) {
      let valor = process.env[nome];
      if (/COMMIT/.test(nome)) valor = valor.slice(0, 7); // hash curto
      visiveis[nome] = valor;
    }
  }
  return { visiveis, total: Object.keys(process.env).length };
}

/* ---------- Rede ---------- */

function interfacesRede() {
  const lista = [];
  const redes = tentar(() => os.networkInterfaces(), {});
  for (const nome in redes) {
    for (const r of redes[nome]) {
      lista.push({ interface: nome, endereco: r.address, familia: r.family, mac: r.mac, interna: r.internal });
    }
  }
  return lista;
}

function ipPrincipal(lista) {
  const ip = lista.find((i) => !i.interna && i.familia === 'IPv4');
  return ip ? ip.endereco : null;
}

/* ---------- Arquivos do projeto ---------- */

const IGNORAR = new Set(['node_modules', '.git']);

/** Conta recursivamente os arquivos do projeto (sem node_modules e .git). */
function contarArquivos(dir, profundidade = 0) {
  if (profundidade > 6) return 0;
  let total = 0;
  for (const item of tentar(() => fs.readdirSync(dir, { withFileTypes: true }), [])) {
    if (IGNORAR.has(item.name)) continue;
    const caminho = path.join(dir, item.name);
    if (item.isDirectory()) total += contarArquivos(caminho, profundidade + 1);
    else total += 1;
  }
  return total;
}

/** Lista o primeiro nível da pasta do projeto. */
function listarProjeto(dir) {
  return tentar(() => fs.readdirSync(dir), [])
    .filter((nome) => !IGNORAR.has(nome))
    .sort()
    .slice(0, 30)
    .map((nome) => {
      const stat = tentar(() => fs.statSync(path.join(dir, nome)));
      return {
        nome,
        tipo: stat && stat.isDirectory() ? 'Pasta' : 'Arquivo',
        tamanho: stat && !stat.isDirectory() ? stat.size : null,
        modificado: stat ? stat.mtime.toISOString() : null,
      };
    });
}

/* ---------- CPU ---------- */

/**
 * Uso de CPU do sistema.
 * os.cpus() devolve o tempo acumulado de cada núcleo em cada estado
 * (user, nice, sys, idle, irq). Comparando duas amostras, calculamos
 * a porcentagem de tempo em que os núcleos NÃO ficaram ociosos.
 */
function amostraCpu() {
  return os.cpus().map((c) => {
    const total = Object.values(c.times).reduce((a, b) => a + b, 0);
    return { total, idle: c.times.idle };
  });
}

function calcularUso(anterior, atual) {
  const porNucleo = atual.map((c, i) => {
    const ant = anterior[i] || c;
    const dTotal = c.total - ant.total;
    const dIdle = c.idle - ant.idle;
    return dTotal > 0 ? Number((100 * (1 - dIdle / dTotal)).toFixed(1)) : 0;
  });
  const media = porNucleo.length
    ? Number((porNucleo.reduce((a, b) => a + b, 0) / porNucleo.length).toFixed(1))
    : 0;
  return { porNucleo, media };
}

// Em processo contínuo (local, Render, Railway), uma amostra é tirada a cada segundo.
let amostraAnterior = amostraCpu();
let usoCpu = { porNucleo: [], media: 0 };
let ultimaAmostra = 0;

setInterval(() => {
  const atual = amostraCpu();
  usoCpu = calcularUso(amostraAnterior, atual);
  amostraAnterior = atual;
  ultimaAmostra = Date.now();
}, 1000).unref();

/**
 * Em serverless (Vercel), a função fica "congelada" entre as requisições
 * e o setInterval não roda. Nesse caso, medimos na hora: duas amostras
 * separadas por 300 ms.
 */
async function obterUsoCpu() {
  if (Date.now() - ultimaAmostra < 3000) return { ...usoCpu, metodo: 'amostragem contínua (1 s)' };
  const a = amostraCpu();
  await new Promise((r) => setTimeout(r, 300));
  const b = amostraCpu();
  return { ...calcularUso(a, b), metodo: 'medição sob demanda (300 ms)' };
}

/* ---------- Status geral ---------- */

/**
 * Mesmo critério do exemplo da aula: RAM acima de 85 % ou carga média
 * maior que o número de núcleos = ALTO USO; acima de 65 % ou 70 % dos
 * núcleos = ATENÇÃO. Em container, também comparamos com o limite do cgroup.
 */
function statusGeral(ramPct, carga1, nucleos, containerPct) {
  const motivos = [];
  let nivel = 0;
  const subir = (n, motivo) => { nivel = Math.max(nivel, n); motivos.push(motivo); };

  if (ramPct > 85) subir(2, `RAM do host em ${ramPct.toFixed(0)} %`);
  else if (ramPct > 65) subir(1, `RAM do host em ${ramPct.toFixed(0)} %`);

  if (carga1 > nucleos) subir(2, `carga média ${carga1.toFixed(2)} > ${nucleos} núcleos`);
  else if (carga1 > nucleos * 0.7) subir(1, `carga média ${carga1.toFixed(2)} acima de 70 % dos núcleos`);

  if (containerPct != null) {
    if (containerPct > 85) subir(2, `container usando ${containerPct.toFixed(0)} % do limite`);
    else if (containerPct > 65) subir(1, `container usando ${containerPct.toFixed(0)} % do limite`);
  }

  const rotulos = ['NORMAL', 'ATENÇÃO', 'ALTO USO'];
  return { nivel, rotulo: rotulos[nivel], motivos };
}

/* ------------------------------------------------------------------ */
/* Rotas                                                               */
/* ------------------------------------------------------------------ */

// API com todas as informações (JSON) — consumida pela página a cada poucos segundos
app.get('/api/info', async (req, res) => {
  const cpus = os.cpus();
  const memProcesso = process.memoryUsage();
  const total = os.totalmem();
  const livre = os.freemem();
  const usada = total - livre;
  const ramPct = (100 * usada) / total;
  const carga = os.loadavg();
  const cpu = await obterUsoCpu();
  const rede = interfacesRede();
  const usuario = tentar(() => os.userInfo(), {});
  const limite = limiteMemoriaCgroup();
  // Só faz sentido mostrar o uso do container quando existe um limite.
  const usadaContainer = limite ? memoriaUsadaCgroup() : null;
  const containerPct = limite && usadaContainer ? (100 * usadaContainer) / limite : null;
  const dirProjeto = __dirname;

  res.json({
    status: statusGeral(ramPct, carga[0], cpus.length, containerPct),
    ambiente: {
      ...identificarAmbiente(),
      container: estaEmContainer(),
      limiteMemoriaContainer: limite,
      memoriaUsadaContainer: usadaContainer,
      cotaCpuContainer: cotaCpuCgroup(),
      virtualizacao: infoVirtualizacao(),
      porta: process.env.PORT || null,
      nodeEnv: process.env.NODE_ENV || null,
      variaveis: variaveisAmbiente(),
    },
    sistema: {
      hostname: os.hostname(),
      plataforma: os.platform(),
      tipo: os.type(),
      release: os.release(),
      versao: typeof os.version === 'function' ? os.version() : null,
      arquitetura: os.arch(),
      endianness: os.endianness(),
      uptime: os.uptime(),
      loadavg: carga,
      fusoHorario: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    usuario: {
      nome: usuario.username || null,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      gid: typeof process.getgid === 'function' ? process.getgid() : null,
      shell: usuario.shell || null,
      home: tentar(() => os.homedir()),
      temp: os.tmpdir(),
    },
    cpu: {
      quantidade: cpus.length,
      paralelismoDisponivel:
        typeof os.availableParallelism === 'function' ? os.availableParallelism() : cpus.length,
      modelo: cpus[0] ? cpus[0].model : 'desconhecido',
      velocidadeMHz: cpus[0] ? cpus[0].speed : null,
      usoMedio: cpu.media,
      usoPorNucleo: cpu.porNucleo,
      metodoMedicao: cpu.metodo,
    },
    memoria: {
      total,
      livre,
      usada,
      percentual: Number(ramPct.toFixed(1)),
    },
    rede: {
      ipPrincipal: ipPrincipal(rede),
      interfaces: rede,
    },
    arquivos: {
      diretorio: dirProjeto,
      quantidade: contarArquivos(dirProjeto),
      lista: listarProjeto(dirProjeto),
    },
    processo: {
      pid: process.pid,
      ppid: process.ppid,
      versaoNode: process.version,
      versaoV8: process.versions.v8,
      execPath: process.execPath,
      cwd: process.cwd(),
      uptime: process.uptime(),
      rss: memProcesso.rss,
      heapTotal: memProcesso.heapTotal,
      heapUsado: memProcesso.heapUsed,
      externa: memProcesso.external,
      cpuUsuarioMs: process.cpuUsage().user / 1000,
      cpuSistemaMs: process.cpuUsage().system / 1000,
    },
    geradoEm: new Date().toISOString(),
  });
});

// Gerenciador de tarefas: processos visíveis para a aplicação
app.get('/api/processos', async (req, res) => {
  try {
    res.json(await obterProcessos());
  } catch (erro) {
    res.status(500).json({ erro: 'Não foi possível listar os processos', detalhe: erro.message });
  }
});

// Health check (usado pelas plataformas para verificar se o serviço está no ar)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Rodando direto (npm start, Render, Railway): abre a porta.
// Importado por outra plataforma (Vercel): só exporta o app.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`cloud-so-app rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
  });
}

module.exports = app;
