/* tracelens review app — frontend logic (plain JS, runs straight in the browser, served statically by the server). */
const $ = (s) => document.querySelector(s);
let cfg = null;
let selId = null;
let picked = {};
let page = 1;
let totalPages = 1;
const LIMIT = 20;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function boot() {
  cfg = await (await fetch('/api/config')).json();
  const m = $('#mode');
  m.textContent = cfg.mode + ' · ' + cfg.sourceName;
  if (cfg.mode === 'demo') m.classList.add('demo');
  await loadList(1);
}

async function loadList(p) {
  page = p || 1;
  const tags = $('#f-tags').value.trim();
  const uid = $('#f-user').value.trim();
  const search = $('#f-search').value.trim();
  // When the backend can't search (Langfuse has no full-text API), the frontend falls back to substring-filtering a larger window — a real filter, not just an explanation.
  const clientSearch = cfg.searchMode === 'client' && !!search;
  const limit = clientSearch ? 200 : LIMIT;
  const q = new URLSearchParams({ page: String(clientSearch ? 1 : page), limit: String(limit) });
  if (tags) q.set('tags', tags);
  if (uid) q.set('userId', uid);
  if (search) q.set('search', search);                 // handled by the backend in server mode; ignored by the backend in client mode, with the frontend fallback below
  const r = await (await fetch('/api/traces?' + q)).json();
  let items = r.items || [];
  const windowSize = items.length;
  if (clientSearch) {
    const needle = search.toLowerCase();
    items = items.filter((t) => [t.id, t.sessionId, t.userId, ...(t.tags || [])]
      .filter(Boolean).join(' ').toLowerCase().includes(needle));
  }
  const hintEl = $('#search-hint');
  if (clientSearch) {
    totalPages = 1;
    $('#count').textContent = items.length + ' match' + (items.length === 1 ? '' : 'es') + ' · client-side filter over last ' + windowSize;
    if (cfg.searchHint) { hintEl.textContent = cfg.searchHint; hintEl.style.display = 'block'; } else hintEl.style.display = 'none';
  } else {
    const total = r.total == null ? items.length : r.total;
    totalPages = Math.max(1, Math.ceil(total / LIMIT));
    $('#count').textContent = total + ' traces';
    hintEl.style.display = 'none';
  }
  const empty = clientSearch
    ? 'No matches in this window — try userId / tags, or set LANGFUSE_SEARCH_METADATA_KEY.'
    : 'No traces';
  $('#list').innerHTML = items.length ? items.map(rowHtml).join('') : '<div class="detail-empty">' + empty + '</div>';
  renderPager();
  document.querySelectorAll('.row').forEach((el) => { el.onclick = () => openTrace(el.dataset.id); });
  if (page === 1 && items.length && !selId) openTrace(items[0].id);   // auto-open the first item on the initial view
}

function renderPager() {
  const el = $('#pager');
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = '<button id="prev"' + (page <= 1 ? ' disabled' : '') + '>◀ Prev</button>'
    + '<span>' + page + ' / ' + totalPages + '</span>'
    + '<button id="next"' + (page >= totalPages ? ' disabled' : '') + '>Next ▶</button>';
  const prev = $('#prev'); if (prev) prev.onclick = () => loadList(page - 1);
  const next = $('#next'); if (next) next.onclick = () => loadList(page + 1);
}

function rowHtml(t) {
  const tags = (t.tags || []).map((x) => '<span class="rtag">' + esc(x) + '</span>').join('');
  const meta = [t.sessionId ? ('session ' + t.sessionId) : '', t.userId || ''].filter(Boolean).join(' · ');
  return '<div class="row" data-id="' + esc(t.id) + '"><div class="rid">' + esc(t.id) + '</div>'
    + '<div class="rmeta">' + esc(meta) + ' ' + tags + '</div></div>';
}

// Aggregate and de-duplicate existing scores by name (so dozens of duplicate chips don't pile into a wall)
function scoresHtml(scores) {
  if (!scores.length) return '<span class="muted">none yet</span>';
  const byName = {};
  for (const s of scores) {
    const k = s.name || '?';
    if (!byName[k]) byName[k] = { count: 0, values: [], source: s.source };
    byName[k].count++;
    byName[k].values.push(String(s.value));
  }
  const chips = Object.keys(byName).map((name) => {
    const g = byName[name];
    const uniq = [...new Set(g.values)];
    const val = uniq.length === 1 ? uniq[0] : uniq.join(' / ');
    const cnt = g.count > 1 ? ' <i>×' + g.count + '</i>' : '';
    const src = g.source ? ' <i>(' + esc(g.source) + ')</i>' : '';
    return '<span class="es">' + esc(name) + '=' + esc(val) + cnt + src + '</span>';
  });
  return '<div class="existing-scores">' + chips.join('') + '</div>';
}

async function openTrace(id) {
  selId = id; picked = {};
  document.querySelectorAll('.row').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  const r = await (await fetch('/api/traces/' + encodeURIComponent(id))).json();
  const note = r.meta && r.meta.degraded
    ? '<div class="note">⚠ No specialized renderer matched this trace — showing a best-effort view. '
      + 'Write one in ~30 lines (see <code>examples/custom-tag-chatbot</code>).</div>'
    : '';
  // Conversation + process go into the scrollable #convo; existing scores + your judgment go into the fixed sidebar #judgment (so you can score from anywhere in the scroll).
  $('#main').innerHTML =
    '<div class="convo" id="convo">'
      + note
      + '<div class="sec-h">Conversation · ' + esc(id) + '</div>' + (r.viewHtml || '')
    + '</div>'
    + '<div class="judgment" id="judgment">'
      + '<div class="sec-h">Existing scores</div>' + scoresHtml(r.scores || [])
      + '<div class="sec-h">Your judgment</div><div id="score"></div>'
    + '</div>';
  renderScore();
}

function renderScore() {
  const dims = cfg.rubric.dimensions.map((d) => {
    let opts;
    if (d.scale === 'binary') opts = [['👍 Good', true], ['👎 Bad', false]];
    else if (d.scale === 'numeric') {
      const range = d.range || [1, 5];
      opts = [];
      for (let i = range[0]; i <= range[1]; i++) opts.push([String(i), i]);
    } else opts = (d.options || []).map((o) => [o, o]);
    const btns = opts.map((o) => '<button class="tl-opt" data-dim="' + d.key + '" data-val=\''
      + JSON.stringify(o[1]) + '\'>' + esc(o[0]) + '</button>').join('');
    const desc = d.description ? '<span class="tl-dim-desc">' + esc(d.description) + '</span>' : '';
    return '<div class="tl-dim-row"><div class="tl-dim-label">' + esc(d.label) + desc
      + '</div><div class="tl-opts">' + btns + '</div></div>';
  }).join('');
  $('#score').innerHTML = '<div class="tl-score">' + dims
    + '<textarea id="comment" class="tl-comment" placeholder="Comment / corrected output — fed back to dataset & judge-calibration…"></textarea>'
    + '<button id="submit" class="tl-submit">Submit judgment →</button><span id="submsg"></span></div>';
  document.querySelectorAll('#score .tl-opt').forEach((b) => {
    b.onclick = () => {
      const dim = b.dataset.dim;
      picked[dim] = JSON.parse(b.dataset.val);
      document.querySelectorAll('#score .tl-opt[data-dim="' + dim + '"]').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    };
  });
  $('#submit').onclick = submit;
}

async function submit() {
  if (!selId) return;
  const msg = $('#submsg');
  if (!Object.keys(picked).length) { msg.textContent = 'pick at least one score'; msg.style.color = '#b9770e'; return; }
  const j = { traceId: selId, rubricId: cfg.rubric.id, rubricVersion: cfg.rubric.version, scores: picked, comment: $('#comment').value };
  try {
    const r = await (await fetch('/api/judgments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(j) })).json();
    if (r.ok) {
      msg.textContent = '✓ submitted → ' + r.sink + ' · refreshing…';
      msg.style.color = '#0a7f5b';
      // Refresh after submit: clear the form + re-fetch the detail (in live mode this echoes back the score just written, preventing duplicate submissions)
      setTimeout(() => openTrace(selId), 700);
    } else {
      msg.textContent = '✗ ' + (r.error || 'failed');
      msg.style.color = '#c0392b';
    }
  } catch (e) {
    msg.textContent = '✗ ' + e.message;
    msg.style.color = '#c0392b';
  }
}

// ── View switching ──
function showView(v) {
  const review = v !== 'cal';
  $('#main').style.display = review ? 'flex' : 'none';
  $('#cal').style.display = review ? 'none' : 'block';
  $('#nav-review').classList.toggle('on', review);
  $('#nav-cal').classList.toggle('on', !review);
  if (!review) loadCalibration();
}

async function loadCalibration() {
  $('#cal').innerHTML = '<div class="muted">computing calibration…</div>';
  try {
    const r = await (await fetch('/api/calibration')).json();
    if (r.error) { $('#cal').innerHTML = '<div class="note">Calibration unavailable: ' + esc(r.error) + '</div>'; return; }
    $('#cal').innerHTML = r.html || '<div class="muted">no data</div>';
    document.querySelectorAll('#cal .tl-cal-top').forEach((el) => {
      el.onclick = () => openCalTrace(el.dataset.trace, el.dataset.dim);
    });
  } catch (e) { $('#cal').innerHTML = '<div class="note">Calibration request failed: ' + esc(e.message) + '</div>'; }
}

async function openCalTrace(id, dim) {
  $('#cal').innerHTML = '<span class="cal-back" id="cal-back">← Back to calibration</span><div class="muted">loading…</div>';
  $('#cal-back').onclick = loadCalibration;
  const r = await (await fetch('/api/calibration/trace/' + encodeURIComponent(id))).json();
  $('#cal').innerHTML = '<span class="cal-back" id="cal-back2">← Back to calibration</span>'
    + '<div class="sec-h">Compare · ' + esc(id) + (dim ? ' · ' + esc(dim) : '') + '</div>'
    + (r.drillHtml || '')
    + '<div class="sec-h">Conversation</div>' + (r.viewHtml || '')
    + '<div style="margin-top:12px"><button class="tl-submit" id="cal-judge-wrong">🟥 judge is wrong → flag into judge-eval set</button> <span id="cal-msg" style="font-size:12px"></span></div>';
  $('#cal-back2').onclick = loadCalibration;
  $('#cal-judge-wrong').onclick = () => submitCalFlag(id);
}

// Closed-loop exit: feed "judge is wrong" back as a calibration judgment (reusing /api/judgments → FeedbackSink)
async function submitCalFlag(id) {
  const msg = $('#cal-msg');
  const j = { traceId: id, rubricId: cfg.rubric.id, rubricVersion: cfg.rubric.version, scores: {}, verdict: 'bad', comment: 'judge-eval: flagged from calibration drilldown' };
  try {
    const r = await (await fetch('/api/judgments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(j) })).json();
    msg.textContent = r.ok ? ('✓ flagged → ' + r.sink) : ('✗ ' + (r.error || 'failed'));
    msg.style.color = r.ok ? '#0a7f5b' : '#c0392b';
  } catch (e) { msg.textContent = '✗ ' + e.message; msg.style.color = '#c0392b'; }
}

$('#nav-review').onclick = () => showView('review');
$('#nav-cal').onclick = () => showView('cal');

['#f-tags', '#f-user', '#f-search'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') loadList(1); }));
$('#refresh').onclick = () => loadList(1);
boot();
