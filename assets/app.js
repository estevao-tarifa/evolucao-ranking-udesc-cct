/* Evolução no Ranking UDESC/CCT — app estático (GitHub Pages).
   Não oficial. Criado por Estevão Tarifa. Dados públicos do SIGA. */

let DB = {}, SEMS = [], INDEX = {}, ENT = {}, NOMES = {};
let rankChart, scoreChart, MOV = null;
let MOVF = 'todos';
let CUR_MAT = null, LAST = null, NEI_UP = 10, NEI_DOWN = 10, RANK_REVERSE = true, ONLY_SAME_ENTRY = false, SHOW_GHOSTS = false;

const $ = id => document.getElementById(id);

/* ---------- estatística ---------- */
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const stdev = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function correlation(x, y) {
  const mx = mean(x), my = mean(y);
  const num = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
  const dx = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0));
  const dy = Math.sqrt(y.reduce((s, v) => s + (v - my) ** 2, 0));
  return num / (dx * dy || 1);
}
const norm = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const num2 = v => Math.round(v * 100) / 100;

/* ---------- carga ---------- */
async function boot() {
  DB = await (await fetch('data/private/ranking.json')).json();
  SEMS = Object.keys(DB);
  for (const s of SEMS) {
    INDEX[s] = {};
    for (const r of DB[s]) INDEX[s][r.matricula] = r;
  }
  for (const s of SEMS) for (const r of DB[s]) {
    NOMES[r.matricula] = r.nome;
    if (!(r.matricula in ENT)) ENT[r.matricula] = s;
  }
  const semSel = $('semSel');
  semSel.innerHTML = SEMS.slice(1).map(s => `<option value="${s}">${s}</option>`).join('');
  semSel.value = SEMS.at(-1);
  initStats(stats(semSel.value));
  wireEvents();
  renderCmp();
}

/* ---------- API (equivalentes aos endpoints) ---------- */
function stats(cur) {
  const i = SEMS.indexOf(cur);
  const past = SEMS[i - 1];
  const idxP = INDEX[past], idxC = INDEX[cur];
  const left = DB[past].filter(r => !(r.matricula in idxC));
  const entered = DB[cur].filter(r => !(r.matricula in idxP));
  const both = DB[cur].filter(r => r.matricula in idxP).map(r => [idxP[r.matricula], r]);

  const mov = both.map(([a, b]) => ({
    matricula: a.matricula, nome: a.nome,
    ['rank_' + past]: a.rank, ['rank_' + cur]: b.rank,
    delta: b.rank - a.rank,
    ['escore_' + past]: a.escore, ['escore_' + cur]: b.escore,
    d_escore: num2(b.escore - a.escore),
    hist: SEMS.map(s => a.matricula in INDEX[s]),
  }));
  const deltas = mov.map(m => m.delta);

  let relTotal = 0, relBetter = 0;
  for (const [a, b] of both) {
    const nb = both
      .filter(([a2]) => a2.matricula !== a.matricula && Math.abs(a2.rank - a.rank) <= 5)
      .map(([, c]) => c.rank - a.rank);
    if (nb.length) { relTotal++; if (b.rank - a.rank < mean(nb)) relBetter++; }
  }
  const pct = relTotal ? num2(100 * relBetter / relTotal) : 0;
  const corr = mov.length > 1 ? Math.round(correlation(mov.map(m => m['rank_' + past]), deltas) * 1000) / 1000 : 0;
  const withHist = r => ({ ...r, hist: SEMS.map(s => r.matricula in INDEX[s]) });

  return {
    semesters: [past, cur], all_semesters: SEMS,
    totals: Object.fromEntries(SEMS.map(s => [s, DB[s].length])),
    n_left: left.length, n_entered: entered.length, n_both: both.length,
    left: [...left].map(withHist).sort((a, b) => a.rank - b.rank).slice(0, 100),
    entered: [...entered].map(withHist).sort((a, b) => a.rank - b.rank).slice(0, 100),
    mov,
    mean_delta: num2(mean(deltas)),
    std_delta: num2(stdev(deltas)),
    pct_better_than_neighbors: pct,
    corr_pos_delta: corr,
  };
}

function student(matricula, cur) {
  const i = SEMS.indexOf(cur);
  const past = i > 0 ? SEMS[i - 1] : cur;
  const idxP = INDEX[past], idxC = INDEX[cur];
  const meP = idxP[matricula], meC = idxC[matricula];
  if (!meP && !meC) return null;

  const me = {
    matricula, nome: (meP || meC).nome, ranks: [], escores: [], entrada: ENT[matricula],
    rank_past: meP ? meP.rank : null, rank_cur: meC ? meC.rank : null,
    escore_past: meP ? meP.escore : null, escore_cur: meC ? meC.escore : null,
  };
  for (const s of SEMS) {
    const meS = INDEX[s][matricula];
    me.ranks.push(meS ? meS.rank : null);
    me.escores.push(meS ? meS.escore : null);
  }
  const present = SEMS.filter(s => matricula in INDEX[s]);
  const saidas = [];
  for (let k = 0; k < SEMS.length - 1; k++)
    if (matricula in INDEX[SEMS[k]] && !(matricula in INDEX[SEMS[k + 1]])) saidas.push(SEMS[k + 1]);
  const reentradas = present.filter(s => s !== present[0] && !(matricula in INDEX[SEMS[SEMS.indexOf(s) - 1]]));

  return {
    semesters: SEMS, pair: [past, cur],
    totals: Object.fromEntries(SEMS.map(s => [s, DB[s].length])),
    me, hist: { entrada: present[0], saidas, reentradas },
  };
}

/* janela de vizinhos: geral (±posições no ranking) ou coorte (X acima/abaixo do meu semestre) */
function neighborWindow(d) {
  const [p0, p1] = d.pair;
  const base = d.me.rank_past != null ? d.me.rank_past : d.me.rank_cur;
  const mk = rec => {
    const o = {
      matricula: rec.matricula, nome: rec.nome, entrada: ENT[rec.matricula],
      ['rank_' + p0]: rec.rank,
      ['rank_' + p1]: (INDEX[p1][rec.matricula] || {}).rank ?? null,
      ['escore_' + p0]: rec.escore,
      ['escore_' + p1]: (INDEX[p1][rec.matricula] || {}).escore ?? null,
      ranks: [], escores: [],
    };
    for (const s of SEMS) {
      const rr = INDEX[s][rec.matricula];
      o.ranks.push(rr ? rr.rank : null);
      o.escores.push(rr ? rr.escore : null);
    }
    return o;
  };
  let picks;
  if (ONLY_SAME_ENTRY) {
    const cohort = DB[p0].filter(r => ENT[r.matricula] === d.me.entrada).sort((a, b) => a.rank - b.rank);
    const i = cohort.findIndex(r => r.matricula === d.me.matricula);
    picks = [...cohort.slice(Math.max(0, i - NEI_UP), i), ...cohort.slice(i + 1, i + 1 + NEI_DOWN)];
  } else {
    picks = DB[p0].filter(r => r.matricula !== d.me.matricula && (r.rank - base) >= -NEI_UP && (r.rank - base) <= NEI_DOWN);
  }
  return picks.map(mk);
}

function searchStudents(qt) {
  const qn = norm(qt.trim());
  const last = SEMS.at(-1);
  let out = Object.keys(NOMES).map(m => ({
    matricula: m, nome: NOMES[m],
    rank: (INDEX[last][m] || {}).rank ?? null,
    entrada: ENT[m],
  }));
  if (qn) out = out.filter(r => norm(r.nome).includes(qn) || r.matricula.includes(qn));
  return out.slice(0, 30);
}

/* ---------- busca ---------- */
let timer;
function wireEvents() {
  const q = $('q'), list = $('list');
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (q.value.length < 2) { list.classList.add('hide'); return; }
      renderSearch(searchStudents(q.value));
    }, 150);
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) list.classList.add('hide'); });

  $('semSel').addEventListener('change', () => {
    initStats(stats($('semSel').value));
    if (CUR_MAT) load(CUR_MAT);
  });
  $('posUp').addEventListener('change', e => { NEI_UP = Math.max(0, parseInt(e.target.value, 10) || 0); if (CUR_MAT) load(CUR_MAT); });
  $('posDown').addEventListener('change', e => { NEI_DOWN = Math.max(0, parseInt(e.target.value, 10) || 0); if (CUR_MAT) load(CUR_MAT); });
  $('flipRank').addEventListener('click', () => { RANK_REVERSE = !RANK_REVERSE; if (LAST) show(LAST); });
  $('sameEntry').addEventListener('change', e => { ONLY_SAME_ENTRY = e.target.checked; if (CUR_MAT) load(CUR_MAT); });
  $('showGhosts').addEventListener('change', e => { SHOW_GHOSTS = e.target.checked; if (LAST) show(LAST); });

  $('toggleMov').addEventListener('click', () => {
    const c = $('movCard');
    c.classList.toggle('collapsed');
    $('toggleMov').textContent = c.classList.contains('collapsed') ? 'Mostrar' : 'Ocultar';
  });
  $('fsearch').addEventListener('input', renderMov);

  const cmpQ = $('cmpQ'), cmpList = $('cmpList');
  cmpQ.addEventListener('input', () => {
    if (cmpQ.value.length < 2) { cmpList.classList.add('hide'); return; }
    const res = searchStudents(cmpQ.value);
    cmpList.innerHTML = '';
    cmpList.classList.toggle('hide', !res.length);
    for (const s of res) {
      const div = document.createElement('div');
      div.innerHTML = `<span>${s.nome} <span class="small">· desde ${s.entrada}</span></span><span class="r">#${s.rank ?? '—'}</span>`;
      div.onclick = () => { addCmp(s.matricula); cmpQ.value = ''; cmpList.classList.add('hide'); };
      cmpList.appendChild(div);
    }
  });
  document.addEventListener('click', e => { if (!e.target.closest('#cmpCard')) cmpList.classList.add('hide'); });
  $('cmpAlign').addEventListener('change', renderCmp);
  $('toggleCmp').addEventListener('click', () => {
    const c = $('cmpCard');
    c.classList.toggle('collapsed');
    $('toggleCmp').textContent = c.classList.contains('collapsed') ? 'Mostrar' : 'Ocultar';
  });
}

/* ---------- comparação de alunos ---------- */
const CMP_COLORS = ['#1d4ed8', '#C1282A', '#139954', '#f2b705', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
let CMP = [], cmpChart = null;

const escoreSeries = m => SEMS.map(s => (INDEX[s][m] || {}).escore ?? null);
function addCmp(m) { if (!CMP.includes(m)) CMP.push(m); renderCmp(); }
function removeCmp(m) { CMP = CMP.filter(x => x !== m); renderCmp(); }

function renderCmp() {
  const chips = $('cmpChips');
  chips.innerHTML = CMP.length
    ? CMP.map(m => `<span class="chip">${NOMES[m]} <b data-rm="${m}" title="remover">×</b></span>`).join('')
    : '<span class="small">Nenhum aluno adicionado. Busque acima e clique para adicionar.</span>';
  chips.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => removeCmp(b.dataset.rm));

  cmpChart?.destroy();
  cmpChart = null;
  if (!CMP.length) return;

  const align = $('cmpAlign').checked;
  let labels, series;
  if (align) {
    series = CMP.map(m => { const s = escoreSeries(m); const k = s.findIndex(v => v != null); return s.slice(k < 0 ? 0 : k); });
    const maxLen = Math.max(1, ...series.map(s => s.length));
    labels = Array.from({ length: maxLen }, (_, i) => `${i + 1}º sem.`);
  } else {
    labels = SEMS;
    series = CMP.map(m => escoreSeries(m));
  }
  const datasets = CMP.map((m, i) => ({
    label: NOMES[m], data: series[i],
    borderColor: CMP_COLORS[i % CMP_COLORS.length], borderWidth: 3,
    tension: 0.35, spanGaps: true, pointRadius: 3,
    pointBackgroundColor: '#fff', pointBorderColor: CMP_COLORS[i % CMP_COLORS.length], pointBorderWidth: 2,
  }));

  cmpChart = new Chart($('cmpChart'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#1a2320' } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y ?? '—'}` } },
      },
      scales: {
        x: { ticks: { color: '#6b7b74' }, grid: { color: '#e2e8e5' } },
        y: { ticks: { color: '#6b7b74' }, grid: { color: '#e2e8e5' }, beginAtZero: false },
      },
    },
  });
}


function renderSearch(students) {
  const list = $('list');
  list.innerHTML = '';
  list.classList.toggle('hide', !students.length);
  for (const s of students) {
    const d = document.createElement('div');
    d.innerHTML = `<span>${s.nome} <span class="small">· desde ${s.entrada}</span></span><span class="r">#${s.rank ?? '—'}</span>`;
    d.onclick = () => { $('q').value = s.nome; list.classList.add('hide'); load(s.matricula); };
    list.appendChild(d);
  }
}

function load(matricula) {
  CUR_MAT = matricula;
  const d = student(matricula, $('semSel').value);
  if (d) show(d);
}

/* ---------- painel do aluno ---------- */
function show(d) {
  LAST = d;
  const panel = $('panel');
  panel.classList.remove('hide');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const [p0, p1] = d.pair;
  const vis = neighborWindow(d);
  $('tblTitle').textContent = ONLY_SAME_ENTRY
    ? `Vizinhos do meu semestre (${d.me.entrada}) — ${NEI_UP} acima / ${NEI_DOWN} abaixo · ${vis.length} alunos`
    : `Vizinhos no ranking geral — ${NEI_UP} acima / ${NEI_DOWN} abaixo · ${vis.length} alunos`;

  const meOld = d.me.rank_past, meNew = d.me.rank_cur;
  const delta = meOld != null && meNew != null ? meNew - meOld : null;
  const cls = delta < 0 ? 'up' : delta > 0 ? 'down' : '';
  const arrow = delta < 0 ? '▲ subiu' : delta > 0 ? '▼ desceu' : '— manteve';
  $('stats').innerHTML = `
    <div class="stat"><b>${d.me.nome}</b><span>Aluno · entrou em ${d.me.entrada}</span></div>
    <div class="stat"><b>#${meNew ?? '—'} / ${d.totals[p1]}</b><span>Posição atual (${p1})</span></div>
    <div class="stat"><b class="${cls}">${delta != null ? (delta > 0 ? '+' : '') + delta : 'novo'}</b><span>${delta != null ? arrow + ' vs ' + p0 : 'entrou neste semestre'}</span></div>
    <div class="stat"><b>${d.me.escore_cur ?? '—'}</b><span>Escore atual</span></div>`;

  const h = d.hist;
  let hl = h.entrada === d.semesters[0] ? 'Presente desde ' + h.entrada : 'Entrou em ' + h.entrada;
  if (h.saidas.length) hl += ' · <span class="down">saiu em ' + h.saidas.join(', ') + '</span>';
  if (h.reentradas.length) hl += ' · <span class="up">voltou em ' + h.reentradas.join(', ') + '</span>';
  if (!h.saidas.length && h.entrada !== d.semesters.at(-1)) hl += ' · nunca saiu';
  if (h.entrada === d.semesters.at(-1)) hl += ' · <span class="up">calouro</span>';
  $('histline').innerHTML = hl;

  /* gráficos: Melhor (verde) x Pior (vermelho) x Média (amarelo) x Você (azul) */
  const BRAND = { me: '#1d4ed8', best: '#139954', worst: '#C1282A', mean: '#f2b705', ghost: 'rgba(120,140,132,.35)' };
  const KEEP = ['Você', 'Melhor', 'Média', 'Pior'];
  const aggregate = (key, lowerBetter) => {
    const lists = [d.me[key], ...vis.map(n => n[key])];
    const best = [], worst = [], meanArr = [];
    for (let i = 0; i < d.semesters.length; i++) {
      const v = lists.map(a => a[i]).filter(x => x != null);
      if (!v.length) { best.push(null); worst.push(null); meanArr.push(null); continue; }
      meanArr.push(num2(mean(v)));
      best.push(Math[lowerBetter ? 'min' : 'max'](...v));
      worst.push(Math[lowerBetter ? 'max' : 'min'](...v));
    }
    return { best, worst, mean: meanArr };
  };
  const build = (canvas, key, prev, lowerBetter) => {
    prev?.destroy();
    const a = aggregate(key, lowerBetter);
    const curve = { tension: 0.35, pointRadius: 0, spanGaps: true };
    const datasets = [
      ...(SHOW_GHOSTS ? vis.map(n => ({ label: n.nome, data: n[key], borderColor: BRAND.ghost, borderWidth: 1, ...curve, order: 10 })) : []),
      { label: 'Média', data: a.mean, borderColor: BRAND.mean, borderWidth: 2, borderDash: [5, 4], ...curve, order: 4 },
      { label: 'Melhor', data: a.best, borderColor: BRAND.best, borderWidth: 2.5, ...curve, order: 5 },
      { label: 'Pior', data: a.worst, borderColor: BRAND.worst, borderWidth: 2.5, ...curve, order: 5 },
      { label: 'Você', data: d.me[key], borderColor: BRAND.me, backgroundColor: BRAND.me,
        borderWidth: 3.5, tension: 0.35, spanGaps: true, order: 1,
        pointRadius: 4, pointHoverRadius: 6,
        pointBackgroundColor: '#fff', pointBorderColor: BRAND.me, pointBorderWidth: 2 },
    ];
    const grid = '#e2e8e5', tick = '#6b7b74';
    return new Chart(document.getElementById(canvas), {
      type: 'line',
      data: { labels: d.semesters, datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#1a2320', boxWidth: 14, filter: it => KEEP.includes(it.text) } },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y ?? '—'}` } },
        },
        scales: {
          x: { ticks: { color: tick }, grid: { color: grid } },
          y: { reverse: key === 'ranks' ? RANK_REVERSE : false, ticks: { color: tick }, grid: { color: grid }, beginAtZero: false },
        },
      },
    });
  };
  rankChart = build('rankChart', 'ranks', rankChart, true);
  scoreChart = build('scoreChart', 'escores', scoreChart, false);

  const meRec = {
    nome: d.me.nome + ' (você)', me: true, entrada: d.me.entrada,
    ['rank_' + p0]: meOld, ['rank_' + p1]: meNew,
    ['escore_' + p0]: d.me.escore_past, ['escore_' + p1]: d.me.escore_cur,
  };
  const all = [meRec, ...vis].sort((x, y) =>
    (x['rank_' + p0] ?? x['rank_' + p1] ?? 1e9) - (y['rank_' + p0] ?? y['rank_' + p1] ?? 1e9));
  const rows = all.map(n => {
    const a = n['rank_' + p0], b = n['rank_' + p1];
    const dl = a != null && b != null ? b - a : null;
    const c = dl == null ? '' : dl < 0 ? 'up' : dl > 0 ? 'down' : '';
    const dlt = dl != null ? (dl > 0 ? '+' : '') + dl : (b == null ? 'saiu' : 'novo');
    const name = n.me ? `<b>${n.nome}</b>` : n.nome;
    const attr = n.me ? '' : ` data-m="${n.matricula}"`;
    return `<tr class="${n.me ? 'name' : ''}"${attr}><td>${name}</td><td class="small">${n.entrada ?? '—'}</td><td class="n">${a ?? '—'}</td><td class="n">${b ?? '—'}</td><td class="n ${c}">${dlt}</td><td class="n">${n['escore_' + p0] ?? '—'} → ${n['escore_' + p1] ?? '—'}</td></tr>`;
  }).join('');
  const t = $('tbl');
  t.innerHTML = '<thead><tr><th>Aluno</th><th>Entrou</th><th class="n">Antes</th><th class="n">Agora</th><th class="n">Δ</th><th class="n">Escore</th></tr></thead><tbody>'
    + rows + '</tbody>';
  t.querySelectorAll('tbody tr[data-m]').forEach(tr => tr.onclick = () => load(tr.dataset.m));
}

/* ---------- visão geral ---------- */
function initStats(d) {
  $('semLabel').textContent = `${d.semesters[0]} → ${d.semesters.at(-1)}`;
  $('semBase').textContent = `(movimentação calculada contra ${d.semesters[0]})`;
  $('ostats').innerHTML = `
    <div class="stat"><b>${d.totals[d.semesters[0]]} → ${d.totals[d.semesters.at(-1)]}</b><span>Alunos no ranking</span></div>
    <div class="stat"><b class="up">${d.n_entered}</b><span>Entraram</span></div>
    <div class="stat"><b class="down">${d.n_left}</b><span>Saíram</span></div>
    <div class="stat"><b>${d.n_both}</b><span>Permaneceram</span></div>
    <div class="stat"><b>${d.mean_delta > 0 ? '+' : ''}${d.mean_delta}</b><span>Média de movimento</span></div>
    <div class="stat"><b>±${d.std_delta}</b><span>Desvio-padrão</span></div>
    <div class="stat"><b>${d.corr_pos_delta}</b><span>Correlação posição×movimento</span></div>
    <div class="stat"><b class="up">${d.pct_better_than_neighbors}%</b><span>Subiram mais que seus vizinhos</span></div>`;
  MOV = d;
  renderFilters(d);
  renderMov();
}

/* ---------- movimentação ---------- */
const FILTERS = [
  ['todos', m => true],
  ['subiram', m => m.delta < 0],
  ['desceram', m => m.delta > 0],
  ['estáveis', m => m.delta === 0],
  ['entraram', m => m.entrou],
  ['saíram', m => m.saiu],
];

function renderFilters(d) {
  const counts = {
    todos: d.mov.length, subiram: d.mov.filter(m => m.delta < 0).length,
    desceram: d.mov.filter(m => m.delta > 0).length, estáveis: d.mov.filter(m => m.delta === 0).length,
    entraram: d.n_entered, saíram: d.n_left,
  };
  $('filters').innerHTML = FILTERS.map(([k]) =>
    `<button data-f="${k}" class="${k === 'todos' ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)} <span class="count">${counts[k]}</span></button>`).join('');
  document.querySelectorAll('#filters button').forEach(b => b.onclick = () => {
    MOVF = b.dataset.f;
    document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x === b));
    renderMov();
  });
}

function renderMov() {
  const d = MOV, term = $('fsearch').value.toLowerCase();
  const f = FILTERS.find(([k]) => k === MOVF)[1];
  let rows = d.mov.map(m => ({ ...m, entrou: false, saiu: false }));
  rows = rows.filter(f);
  if (term) rows = rows.filter(m => m.nome.toLowerCase().includes(term));
  rows.sort((a, b) => a.delta - b.delta || a['rank_' + d.semesters[0]] - b['rank_' + d.semesters[0]]);

  const extra = (MOVF === 'entraram' ? d.entered.map(r => ({
    matricula: r.matricula, nome: r.nome, delta: null,
    ['rank_' + d.semesters.at(-1)]: r.rank, ['escore_' + d.semesters.at(-1)]: r.escore, entrou: true,
  })) : MOVF === 'saíram' ? d.left.map(r => ({
    matricula: r.matricula, nome: r.nome, delta: null,
    ['rank_' + d.semesters[0]]: r.rank, ['escore_' + d.semesters[0]]: r.escore, saiu: true,
  })) : []).filter(m => !term || m.nome.toLowerCase().includes(term));

  const head = '<thead><tr><th>Aluno</th><th>Presença</th><th class="n">Antes</th><th class="n">Agora</th><th class="n">Δ</th><th class="n">Escore</th><th class="n">Δ Escore</th></tr></thead>';
  const short = s => s.slice(2);
  const pres = hist => hist ? hist.map((p, i) =>
    `<span class="${p ? '' : 'muted'}" title="${d.all_semesters[i]}${p ? '' : ' — ausente'}">${p ? short(d.all_semesters[i]) : '✗'}</span>`).join(' · ') : '—';
  const body = [...rows, ...extra].map(m => {
    const a = m['rank_' + d.semesters[0]], b = m['rank_' + d.semesters.at(-1)];
    const ea = m['escore_' + d.semesters[0]], eb = m['escore_' + d.semesters.at(-1)];
    const c = m.delta == null ? '' : m.delta < 0 ? 'up' : m.delta > 0 ? 'down' : 'muted';
    const tag = m.entrou ? ' <span class="up">novo</span>' : m.saiu ? ' <span class="down">saiu</span>' : '';
    const dlt = m.delta == null ? (m.entrou ? 'novo' : 'saiu') : (m.delta > 0 ? '+' : '') + m.delta;
    const des = m.d_escore == null ? '—' : (m.d_escore > 0 ? '+' : '') + m.d_escore;
    const cc = m.d_escore == null ? '' : m.d_escore > 0 ? 'up' : m.d_escore < 0 ? 'down' : 'muted';
    return `<tr data-m="${m.entrou || m.saiu ? '' : m.matricula}"><td>${m.nome}${tag}</td><td class="small">${pres(m.hist)}</td><td class="n">${a ?? '—'}</td><td class="n">${b ?? '—'}</td><td class="n ${c}">${dlt}</td><td class="n">${ea ?? '—'} → ${eb ?? '—'}</td><td class="n ${cc}">${des}</td></tr>`;
  }).join('');

  $('mov').innerHTML = head + '<tbody>' + body + '</tbody>';
  $('movNote').textContent = `${rows.length + extra.length} alunos · Δ negativo = subiu no ranking · clique numa linha para ver a evolução`;
}

boot();
