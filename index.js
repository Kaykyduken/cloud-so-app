/**
 * cloud-so-app
 * Aplicação Express que exibe informações do Sistema Operacional
 * usando os módulos nativos do Node.js (os, process, fs).
 *
 * Disciplina: Sistemas Operacionais — Aula 06: Nuvem e Sistemas Operacionais
 */

const express = require('express');
const cors = require('cors');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();

// O Render (e a maioria das plataformas de nuvem) injeta a porta pela
// variável de ambiente PORT. Localmente, usamos 3000.
const PORT = process.env.PORT || 3000;

app.use(cors());
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

/** Cota de CPU imposta pelo cgroup (ex.: 0.1 CPU no plano Free do Render). */
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

function identificarAmbiente() {
  if (process.env.RENDER) return 'Nuvem (Render)';
  if (process.env.KUBERNETES_SERVICE_HOST) return 'Nuvem (Kubernetes)';
  return 'Local';
}

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

let amostraAnterior = amostraCpu();
let usoCpuPorNucleo = [];
let usoCpuTotal = 0;

setInterval(() => {
  const atual = amostraCpu();
  usoCpuPorNucleo = atual.map((c, i) => {
    const ant = amostraAnterior[i] || c;
    const dTotal = c.total - ant.total;
    const dIdle = c.idle - ant.idle;
    return dTotal > 0 ? Number((100 * (1 - dIdle / dTotal)).toFixed(1)) : 0;
  });
  usoCpuTotal = usoCpuPorNucleo.length
    ? Number((usoCpuPorNucleo.reduce((a, b) => a + b, 0) / usoCpuPorNucleo.length).toFixed(1))
    : 0;
  amostraAnterior = atual;
}, 1000).unref();

/* ------------------------------------------------------------------ */
/* Rotas                                                               */
/* ------------------------------------------------------------------ */

// API com todas as informações (JSON)
app.get('/api/info', (req, res) => {
  const cpus = os.cpus();
  const memProcesso = process.memoryUsage();

  res.json({
    ambiente: {
      tipo: identificarAmbiente(),
      container: estaEmContainer(),
      limiteMemoriaContainer: limiteMemoriaCgroup(),
      cotaCpuContainer: cotaCpuCgroup(),
      regiao: process.env.RENDER_REGION || null,
      servico: process.env.RENDER_SERVICE_NAME || null,
    },
    sistema: {
      hostname: os.hostname(),
      plataforma: os.platform(),
      tipo: os.type(),
      release: os.release(),
      versao: typeof os.version === 'function' ? os.version() : null,
      arquitetura: os.arch(),
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      usuario: os.userInfo().username,
    },
    cpu: {
      quantidade: cpus.length,
      paralelismoDisponivel:
        typeof os.availableParallelism === 'function' ? os.availableParallelism() : cpus.length,
      modelo: cpus[0] ? cpus[0].model : 'desconhecido',
      velocidadeMHz: cpus[0] ? cpus[0].speed : null,
      usoTotal: usoCpuTotal,
      usoPorNucleo: usoCpuPorNucleo,
    },
    memoria: {
      total: os.totalmem(),
      livre: os.freemem(),
      usada: os.totalmem() - os.freemem(),
    },
    processo: {
      pid: process.pid,
      ppid: process.ppid,
      versaoNode: process.version,
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

// Health check (útil para o Render verificar se o serviço está no ar)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`cloud-so-app rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
});
