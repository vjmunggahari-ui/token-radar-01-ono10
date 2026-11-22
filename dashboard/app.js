// Token Radar page: renders window.RADAR with no fetch and no network.
// Sortable columns, category / chain / TVL-band / text filters, pagination
// and a detail view for every protocol. Views are hash-routed so each
// screenshot state is a plain link: #/detail/<slug> and #/filter/<params>.
(function () {
  var D = window.RADAR;
  if (!D || !D.rows) { document.body.textContent = 'No radar data.'; return; }
  var rows = D.rows;
  var maxTvl = 0;
  rows.forEach(function (r) { if (r.tvl_usd > maxTvl) maxTvl = r.tvl_usd; });

  var state = { q: '', cat: '', chain: '', band: '', sort: 'implied', dir: -1, page: 0, detail: null };
  var pageSize = D.layout === 'dense' ? 30 : 20;
  if (D.layout === 'dense') document.body.classList.add('dense');

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function growth(r) {
    if (r.change_7d == null) return '<span class="flat">—</span>';
    var cls = r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat';
    var sign = r.change_7d > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + r.change_7d.toFixed(1) + '%</span>';
  }
  function age(r) { return r.age_days == null ? '—' : r.age_days + 'd'; }

  // KPI strip: one question answered at a glance — which pre-token protocol is worth farming next?
  $('kpis').innerHTML = [
    ['Watchlist', D.watchlist_size, 'floor ' + money(D.floor_usd) + ' TVL'],
    ['Board rows', D.board_size, D.early_size + ' early, below the floor'],
    ['Top implied value', '<em>' + moneyFull(D.top_implied_usd) + '</em>', 'rank 1 of ' + D.board_size],
    ['Pre-token universe', D.pre_token_universe, D.token_trading + ' already trade'],
  ].map(function (k) {
    return '<div class="kpi"><span>' + k[0] + '</span><b>' + k[1] + '</b><span>' + k[2] + '</span></div>';
  }).join('');
  $('asof').textContent = 'Snapshot ' + D.as_of;
  $('model').textContent = 'Model ' + D.model_version + ' · variant ' + D.variant + ' (' + D.variant_label + ')';
  $('method').textContent = 'Method: implied value = TVL x ' + D.baseMultiple + ' x growth factor x patience factor'
    + (D.variant === 'C' ? ' x chain-breadth factor' : '')
    + ', from the snapshot\'s own figures only (TVL, 7-day change, days listed with no token'
    + (D.variant === 'C' ? ', chain count' : '') + '). No name is ever special-cased.'
    + ' "vs cat." divides a protocol\'s TVL by its category\'s median TVL on this board.';

  // Filter option lists, from the data itself.
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    $('cat').appendChild(new Option(c, c));
  });
  Object.keys(chains).sort().forEach(function (c) {
    $('chain').appendChild(new Option(c, c));
  });

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.band === 'big' && r.tvl_usd < 1e9) return false;
      if (state.band === 'mid' && (r.tvl_usd < 1e8 || r.tvl_usd >= 1e9)) return false;
      if (state.band === 'small' && r.tvl_usd >= 1e8) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var k = state.sort, d = state.dir;
    var val = {
      rank: function (r) { return r.rank; },
      name: function (r) { return r.name.toLowerCase(); },
      category: function (r) { return (r.category || '').toLowerCase(); },
      chains: function (r) { return r.chains.length; },
      tvl: function (r) { return r.tvl_usd; },
      rel: function (r) { return r.relStrength; },
      growth: function (r) { return r.change_7d == null ? -1e9 : r.change_7d; },
      age: function (r) { return r.age_days == null ? -1 : r.age_days; },
      implied: function (r) { return r.implied_value_usd; },
    }[k] || function (r) { return r.implied_value_usd; };
    out.sort(function (a, b) {
      var va = val(a), vb = val(b);
      var c = va < vb ? -1 : va > vb ? 1 : 0;
      if (c === 0) c = a.slug < b.slug ? -1 : 1;
      return c * d;
    });
    return out;
  }

  function render() {
    var list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / pageSize));
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;
    var slice = list.slice(state.page * pageSize, state.page * pageSize + pageSize);
    $('rows').innerHTML = slice.map(function (r) {
      var pct = maxTvl ? Math.max(2, Math.round((r.tvl_usd / maxTvl) * 100)) : 0;
      var gpct = r.change_7d == null ? 0 : Math.max(2, Math.min(100, Math.abs(r.change_7d)));
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="sel"' : '') + '>'
        + '<td class="rank">' + r.rank + '</td>'
        + '<td class="name"><b>' + esc(r.name) + '</b><small>' + esc(r.slug) + ' · records no token</small></td>'
        + '<td class="cat">' + esc(r.category || '—') + '</td>'
        + '<td class="chains">' + esc(r.chains.join(', ') || '—') + '</td>'
        + '<td class="num tvlv">' + money(r.tvl_usd) + '<span class="bar"><i style="width:' + pct + '%"></i></span></td>'
        + '<td class="num agev">×' + r.relStrength.toFixed(1) + '</td>'
        + '<td class="num">' + growth(r) + '<span class="bar g"><i style="width:' + gpct + '%"></i></span></td>'
        + '<td class="num agev">' + age(r) + '</td>'
        + '<td class="num imp">' + moneyFull(r.implied_value_usd) + '</td></tr>';
    }).join('') || '<tr><td colspan="9">No protocol matches these filters.</td></tr>';
    $('count').textContent = list.length === 0 ? '0 rows'
      : 'Showing ' + (state.page * pageSize + 1) + '–' + Math.min(list.length, (state.page + 1) * pageSize) + ' of ' + list.length;
    $('prev').disabled = state.page === 0;
    $('next').disabled = state.page >= pages - 1;
    renderDetail();
  }

  function renderDetail() {
    var box = $('detail');
    if (!state.detail) { box.hidden = true; box.innerHTML = ''; return; }
    var r = null;
    rows.forEach(function (x) { if (x.slug === state.detail) r = x; });
    if (!r) { box.hidden = true; return; }
    var base = Math.round(r.tvl_usd * D.baseMultiple);
    var steps = r.farm_steps.map(function (s, i) {
      return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(s) + '</li>';
    }).join('');
    box.hidden = false;
    box.innerHTML = '<button class="close" type="button" id="dclose">Close ✕</button>'
      + '<h2>' + esc(r.name) + '</h2><div class="sub">Rank ' + r.rank + ' · ' + esc(r.slug) + ' · '
      + esc(r.category || 'no category') + ' · ' + esc(r.chains.join(', ') || '—') + '</div>'
      + '<div class="big">' + moneyFull(r.implied_value_usd) + '</div>'
      + '<div class="sub">implied launch value · records no token</div>'
      + '<div class="formula">TVL ' + money(r.tvl_usd) + ' × ' + D.baseMultiple + ' = ' + money(base)
      + '<br>× growth ' + r.growthMult.toFixed(2) + ' × patience ' + r.patienceMult.toFixed(2)
      + (D.variant === 'C' ? ' × breadth ' + r.breadthMult.toFixed(2) : '')
      + '<br>= ' + moneyFull(r.implied_value_usd) + '</div>'
      + '<h3>Figures</h3><dl>'
      + '<dt>TVL</dt><dd>' + moneyFull(r.tvl_usd) + '</dd>'
      + '<dt>7-day change</dt><dd>' + (r.change_7d == null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</dd>'
      + '<dt>Listed</dt><dd>' + esc(r.listed_at || '—') + '</dd>'
      + '<dt>Age, no token</dt><dd>' + age(r) + '</dd></dl>'
      + '<h3>Farm plan — ' + r.farm_steps.length + ' steps</h3><ol>' + steps + '</ol>';
    $('dclose').addEventListener('click', function () { setDetail(null); });
  }

  function syncHash() {
    var h = state.detail ? '#/detail/' + state.detail
      : '#/filter/q=' + encodeURIComponent(state.q) + '&cat=' + encodeURIComponent(state.cat)
      + '&chain=' + encodeURIComponent(state.chain) + '&band=' + state.band
      + '&sort=' + state.sort + '&dir=' + state.dir + '&page=' + state.page;
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  function setDetail(slug) {
    state.detail = slug;
    render();
    syncHash();
  }

  function readHash() {
    var h = location.hash || '';
    var m = h.match(/^#\/detail\/([\w.-]+)$/);
    if (m) { state.detail = m[1]; return; }
    var f = h.match(/^#\/filter\/(.*)$/);
    if (f) {
      var p = {};
      f[1].split('&').forEach(function (kv) {
        var i = kv.indexOf('=');
        if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
      });
      if (p.q != null) { state.q = p.q; $('q').value = p.q; }
      if (p.cat != null) { state.cat = p.cat; $('cat').value = p.cat; }
      if (p.chain != null) { state.chain = p.chain; $('chain').value = p.chain; }
      if (p.band != null) { state.band = p.band; $('band').value = p.band; }
      if (p.sort) { state.sort = p.sort; $('sort').value = p.sort; }
      if (p.dir) state.dir = p.dir === '1' ? 1 : -1;
      if (p.page) state.page = Math.max(0, parseInt(p.page, 10) || 0);
    }
  }

  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) setDetail(tr.getAttribute('data-slug'));
  });
  document.querySelectorAll('#board th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
      state.page = 0;
      render(); syncHash();
    });
  });
  function refilter() {
    state.q = $('q').value; state.cat = $('cat').value; state.chain = $('chain').value;
    state.band = $('band').value; state.page = 0;
    render(); syncHash();
  }
  ['q', 'cat', 'chain', 'band'].forEach(function (id) {
    $(id).addEventListener(id === 'q' ? 'input' : 'change', refilter);
  });
  $('sort').addEventListener('change', function () {
    state.sort = $('sort').value; state.dir = state.sort === 'name' ? 1 : -1; state.page = 0;
    render(); syncHash();
  });
  $('reset').addEventListener('click', function () {
    state.q = ''; state.cat = ''; state.chain = ''; state.band = '';
    state.sort = 'implied'; state.dir = -1; state.page = 0; state.detail = null;
    $('q').value = ''; $('cat').value = ''; $('chain').value = ''; $('band').value = ''; $('sort').value = 'implied';
    render(); syncHash();
  });
  $('prev').addEventListener('click', function () { state.page--; render(); syncHash(); });
  $('next').addEventListener('click', function () { state.page++; render(); syncHash(); });
  window.addEventListener('hashchange', function () { readHash(); render(); });

  // Live-token table: the market's own values, set apart from the ranking.
  $('liverows').innerHTML = D.live.map(function (r) {
    return '<tr><td><b>' + esc(r.name) + '</b><br><small style="color:var(--faint);font:11px var(--mono)">'
      + esc(r.slug) + '</small></td><td class="cat">' + esc(r.category || '—') + '</td>'
      + '<td class="num tvlv">' + money(r.tvl_usd) + '</td>'
      + '<td class="num imp">' + (r.mcap_usd == null ? '—' : moneyFull(r.mcap_usd)) + '</td>'
      + '<td class="num">' + growth(r) + '</td></tr>';
  }).join('');

  readHash();
  render();
})();
