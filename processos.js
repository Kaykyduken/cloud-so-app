/**
 * Gerenciador de tarefas — lista os processos que o SO deixa a aplicação enxergar.
 *
 * Linux: lê o sistema de arquivos virtual /proc, onde o kernel publica um
 *        diretório por processo (/proc/<PID>/stat, status, cmdline).
 * Windows: usa o PowerShell (Get-Process); se falhar, o comando tasklist.
 * macOS/outros: usa o comando ps.
 *
 * O %CPU de cada processo é calculado comparando o tempo de CPU acumulado
 * (modo usuário + modo sistema) entre duas leituras, como fazem o top e o
 * Gerenciador de Tarefas.
 */

const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const CLK_TCK = 100; // "ticks" por segundo usados pelo kernel Linux em /proc/<pid>/stat
const PAGINA = 4096; // tamanho da página de memória (bytes) na maioria dos sistemas x64/arm64

const ESTADOS = {
  R: 'Executando',
  S: 'Dormindo',
  D: 'Aguardando E/S',
  Z: 'Zumbi',
  T: 'Parado',
  t: 'Rastreado',
  I: 'Ocioso',
  X: 'Finalizado',
  P: 'Estacionado',
};

function lerArquivo(caminho) {
  try {
    return fs.readFileSync(caminho, 'utf8');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Linux: /proc                                                        */
/* ------------------------------------------------------------------ */

let usuariosCache = null;
function nomeUsuario(uid) {
  if (!usuariosCache) {
    usuariosCache = {};
    for (const linha of (lerArquivo('/etc/passwd') || '').split('\n')) {
      const p = linha.split(':');
      if (p.length > 2) usuariosCache[p[2]] = p[0];
    }
  }
  return usuariosCache[uid] || String(uid);
}

/** Lê /proc/<pid>/stat. O nome vem entre parênteses e pode conter espaços. */
function lerStat(pid) {
  const txt = lerArquivo(`/proc/${pid}/stat`);
  if (!txt) return null;
  const ini = txt.indexOf('(');
  const fim = txt.lastIndexOf(')');
  const nome = txt.slice(ini + 1, fim);
  const c = txt.slice(fim + 2).split(' '); // c[0] = estado (campo 3 do stat)
  return {
    pid,
    nome,
    estado: c[0],
    ppid: Number(c[1]),
    ticksCpu: Number(c[11]) + Number(c[12]), // utime + stime
    prioridade: Number(c[15]),
    nice: Number(c[16]),
    threads: Number(c[17]),
    inicioTicks: Number(c[19]),
    rss: Number(c[21]) * PAGINA,
  };
}

function listarPids() {
  try {
    return fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map(Number);
  } catch {
    return [];
  }
}

function amostraLinux() {
  const mapa = new Map();
  for (const pid of listarPids()) {
    const s = lerStat(pid);
    if (s) mapa.set(pid, s);
  }
  return { instante: Date.now(), mapa };
}

let anteriorLinux = null;

async function processosLinux() {
  // Precisamos de duas leituras para calcular %CPU. Se a anterior for antiga
  // (ou não existir, como na primeira chamada ou em serverless), lemos duas vezes.
  if (!anteriorLinux || Date.now() - anteriorLinux.instante > 10000) {
    anteriorLinux = amostraLinux();
    await new Promise((r) => setTimeout(r, 300));
  }
  const atual = amostraLinux();
  const dt = (atual.instante - anteriorLinux.instante) / 1000;
  const nucleos = os.cpus().length || 1;
  const uptime = os.uptime();

  const lista = [];
  for (const [pid, s] of atual.mapa) {
    const ant = anteriorLinux.mapa.get(pid);
    const dTicks = ant ? s.ticksCpu - ant.ticksCpu : 0;
    // % de um núcleo (como o top) e % da CPU total (como o Gerenciador de Tarefas)
    const cpuNucleo = dt > 0 ? (100 * dTicks) / CLK_TCK / dt : 0;

    const status = lerArquivo(`/proc/${pid}/status`) || '';
    const uidMatch = status.match(/^Uid:\s+(\d+)/m);
    const cmd = (lerArquivo(`/proc/${pid}/cmdline`) || '').replace(/\0/g, ' ').trim();

    lista.push({
      pid,
      ppid: s.ppid,
      nome: s.nome,
      comando: cmd ? cmd.slice(0, 160) : `[${s.nome}]`,
      estado: s.estado,
      estadoDescricao: ESTADOS[s.estado] || s.estado,
      usuario: uidMatch ? nomeUsuario(uidMatch[1]) : null,
      threads: s.threads,
      prioridade: s.prioridade,
      nice: s.nice,
      memoria: s.rss,
      cpu: Number((cpuNucleo / nucleos).toFixed(1)),
      cpuNucleo: Number(cpuNucleo.toFixed(1)),
      tempoCpu: s.ticksCpu / CLK_TCK,
      executandoHa: Math.max(0, uptime - s.inicioTicks / CLK_TCK),
    });
  }
  anteriorLinux = atual;
  return { fonte: '/proc (sistema de arquivos virtual do kernel Linux)', lista, cpuPorNucleo: true };
}

/* ------------------------------------------------------------------ */
/* Windows e macOS: comandos do sistema                                */
/* ------------------------------------------------------------------ */

function executar(cmd, args, timeout = 8000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (erro, saida) =>
      erro ? reject(erro) : resolve(saida));
  });
}

let anteriorWin = null;

async function processosWindows() {
  try {
    const script =
      'Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64,' +
      '@{n="Threads";e={$_.Threads.Count}},@{n="Prio";e={$_.BasePriority}} | ConvertTo-Json -Compress';
    const saida = await executar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    const dados = JSON.parse(saida);
    const agora = Date.now();
    const nucleos = os.cpus().length || 1;
    const mapaAnt = anteriorWin && agora - anteriorWin.instante < 15000 ? anteriorWin.mapa : null;
    const dt = mapaAnt ? (agora - anteriorWin.instante) / 1000 : 0;
    const mapa = new Map();
    const lista = (Array.isArray(dados) ? dados : [dados]).map((p) => {
      const tempo = p.CPU || 0; // segundos de CPU acumulados
      mapa.set(p.Id, tempo);
      const ant = mapaAnt ? mapaAnt.get(p.Id) : undefined;
      const cpuNucleo = ant !== undefined && dt > 0 ? (100 * (tempo - ant)) / dt : 0;
      return {
        pid: p.Id,
        ppid: null,
        nome: p.ProcessName,
        comando: p.ProcessName,
        estado: null,
        estadoDescricao: null,
        usuario: null,
        threads: p.Threads,
        prioridade: p.Prio,
        nice: null,
        memoria: p.WorkingSet64,
        cpu: Number((cpuNucleo / nucleos).toFixed(1)),
        cpuNucleo: Number(cpuNucleo.toFixed(1)),
        tempoCpu: tempo,
        executandoHa: null,
      };
    });
    anteriorWin = { instante: agora, mapa };
    return {
      fonte: 'PowerShell Get-Process (Windows)' + (mapaAnt ? '' : ' — %CPU aparece a partir da 2ª leitura'),
      lista,
      cpuPorNucleo: !!mapaAnt,
    };
  } catch {
    // Alternativa mais simples: tasklist (sem %CPU)
    const saida = await executar('tasklist', ['/fo', 'csv', '/nh']);
    const lista = saida.trim().split(/\r?\n/).map((linha) => {
      const c = linha.split('","').map((x) => x.replace(/"/g, ''));
      return {
        pid: Number(c[1]), ppid: null, nome: c[0], comando: c[0], estado: null, estadoDescricao: null,
        usuario: null, threads: null, prioridade: null, nice: null,
        memoria: Number((c[4] || '').replace(/\D/g, '')) * 1024,
        cpu: null, cpuNucleo: null, tempoCpu: null, executandoHa: null,
      };
    });
    return { fonte: 'tasklist (Windows) — sem %CPU', lista, cpuPorNucleo: false };
  }
}

async function processosPs() {
  const saida = await executar('ps', ['-axo', 'pid=,ppid=,state=,rss=,pcpu=,user=,comm=']);
  const nucleos = os.cpus().length || 1;
  const lista = saida.trim().split('\n').map((linha) => {
    const [pid, ppid, estado, rss, pcpu, usuario, ...cmd] = linha.trim().split(/\s+/);
    const nome = cmd.join(' ');
    return {
      pid: Number(pid), ppid: Number(ppid), nome: nome.split('/').pop(), comando: nome,
      estado: estado[0], estadoDescricao: ESTADOS[estado[0]] || estado, usuario,
      threads: null, prioridade: null, nice: null, memoria: Number(rss) * 1024,
      cpu: Number((Number(pcpu) / nucleos).toFixed(1)), cpuNucleo: Number(pcpu),
      tempoCpu: null, executandoHa: null,
    };
  });
  return { fonte: 'comando ps', lista, cpuPorNucleo: true };
}

/* ------------------------------------------------------------------ */
/* Resumo                                                              */
/* ------------------------------------------------------------------ */

/** Sobe pela árvore de processos a partir da própria aplicação (PID → PPID → ...). */
function cadeiaDaAplicacao(lista) {
  const porPid = new Map(lista.map((p) => [p.pid, p]));
  const cadeia = [];
  let pid = process.pid;
  const vistos = new Set();
  while (pid && !vistos.has(pid) && cadeia.length < 12) {
    vistos.add(pid);
    const p = porPid.get(pid);
    if (!p) {
      if (pid === process.ppid) cadeia.push({ pid, nome: '(fora do alcance da aplicação)' });
      break;
    }
    cadeia.push({ pid: p.pid, nome: p.nome });
    pid = p.ppid;
  }
  return cadeia;
}

let cache = null;

async function obterProcessos() {
  // Evita abrir vários PowerShell/ps se a página pedir muito rápido
  if (cache && Date.now() - cache.instante < 1500) return cache.dados;

  let r;
  if (process.platform === 'linux' && fs.existsSync('/proc/self/stat')) r = await processosLinux();
  else if (process.platform === 'win32') r = await processosWindows();
  else r = await processosPs();

  const porEstado = {};
  let threads = 0;
  let memoria = 0;
  for (const p of r.lista) {
    if (p.estadoDescricao) porEstado[p.estadoDescricao] = (porEstado[p.estadoDescricao] || 0) + 1;
    threads += p.threads || 0;
    memoria += p.memoria || 0;
  }

  const ordenada = [...r.lista].sort((a, b) => (b.cpu || 0) - (a.cpu || 0) || (b.memoria || 0) - (a.memoria || 0));

  const dados = {
    fonte: r.fonte,
    total: r.lista.length,
    threads: threads || null,
    memoriaSomada: memoria,
    porEstado,
    pidAplicacao: process.pid,
    cadeia: cadeiaDaAplicacao(r.lista),
    processos: ordenada.slice(0, 150),
    exibidos: Math.min(150, ordenada.length),
    geradoEm: new Date().toISOString(),
  };
  cache = { instante: Date.now(), dados };
  return dados;
}

module.exports = { obterProcessos };
