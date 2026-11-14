(function () {
  'use strict';

  var data = window.ROADMAP;
  var STORAGE_KEY = 'stroy-roadmap-v1';
  var COL_W = 260, ROW_H = 150, PAD_X = 30, PAD_Y = 90, NODE_W = 210, NODE_H = 96;
  var STATUS_LABEL = { locked: 'Закрыт', available: 'Доступен', progress: 'В работе', done: 'Завершён' };

  // ---------- Подготовка данных ----------
  var byId = {};
  data.stages.forEach(function (s) {
    byId[s.id] = s;
    s.unlocks = [];
    s.items = s.items.map(function (it, i) {
      var arr = Array.isArray(it) ? it : [it];
      return { id: s.id + '-' + i, title: arr[0], hint: arr[1] || '' };
    });
  });
  data.stages.forEach(function (s) {
    s.requires.forEach(function (r) { byId[r].unlocks.push(s.id); });
  });

  // ---------- Состояние ----------
  var state = load();
  var selectedId = null;
  var statusCache = {};

  function defaultState() { return { checked: {}, custom: {}, free: false, zoom: 1 }; }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) { /* хранилище недоступно */ }
    return defaultState();
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* игнорируем */ }
  }

  // ---------- Логика этапов ----------
  function itemsOf(s) { return s.items.concat(state.custom[s.id] || []); }

  function progressOf(s) {
    var list = itemsOf(s);
    var done = list.filter(function (i) { return state.checked[i.id]; }).length;
    return { done: done, total: list.length };
  }

  function statusOf(s) {
    if (statusCache[s.id]) return statusCache[s.id];
    var p = progressOf(s);
    var st;
    if (p.total > 0 && p.done === p.total) st = 'done';
    else if (!s.requires.every(function (r) { return statusOf(byId[r]) === 'done'; })) st = 'locked';
    else st = p.done > 0 ? 'progress' : 'available';
    statusCache[s.id] = st;
    return st;
  }

  function canEdit(s) { return state.free || statusOf(s) !== 'locked'; }

  // ---------- Отрисовка карты ----------
  var el = {
    viewport: document.getElementById('viewport'),
    sizer: document.getElementById('sizer'),
    tree: document.getElementById('tree'),
    phases: document.getElementById('phases'),
    links: document.getElementById('links'),
    nodes: document.getElementById('nodes'),
    panel: document.getElementById('panel'),
    panelBody: document.getElementById('panelBody'),
    toast: document.getElementById('toast')
  };

  var maxCol = Math.max.apply(null, data.stages.map(function (s) { return s.col; }));
  var maxRow = Math.max.apply(null, data.stages.map(function (s) { return s.row; }));
  var WIDTH = PAD_X * 2 + (maxCol + 1) * COL_W;
  var HEIGHT = PAD_Y + (maxRow + 1) * ROW_H + 40;

  function pos(s) {
    return { x: PAD_X + s.col * COL_W + (COL_W - NODE_W) / 2 - 10, y: PAD_Y + s.row * ROW_H + 20 };
  }

  function buildStatic() {
    el.tree.style.width = WIDTH + 'px';
    el.tree.style.height = HEIGHT + 'px';
    el.links.setAttribute('width', WIDTH);
    el.links.setAttribute('height', HEIGHT);

    el.phases.innerHTML = '';
    data.phases.forEach(function (ph, i) {
      var d = document.createElement('div');
      d.className = 'phase';
      d.style.setProperty('--c', ph.color);
      d.style.left = (PAD_X + ph.from * COL_W - 20) + 'px';
      d.style.width = ((ph.to - ph.from + 1) * COL_W) + 'px';
      d.innerHTML = '<div class="phase-title">Эпоха ' + (i + 1) + '<small>' + esc(ph.title) + '</small></div>';
      el.phases.appendChild(d);
    });

    el.nodes.innerHTML = '';
    data.stages.forEach(function (s) {
      var p = pos(s);
      var b = document.createElement('button');
      b.className = 'node';
      b.dataset.id = s.id;
      b.style.left = p.x + 'px';
      b.style.top = p.y + 'px';
      b.innerHTML =
        '<div class="node-icon">' + s.icon + '</div>' +
        '<div class="node-body">' +
          '<div class="node-title">' + esc(s.title) + '</div>' +
          '<div class="node-meta"><span class="node-status"></span><span class="node-count"></span></div>' +
          '<div class="node-bar"><i></i></div>' +
        '</div>';
      b.addEventListener('click', function () { if (!dragMoved) openPanel(s.id); });
      b.addEventListener('mouseenter', function () { highlight(s.id); });
      b.addEventListener('mouseleave', function () { highlight(selectedId); });
      el.nodes.appendChild(b);
    });
  }

  function renderNodes() {
    data.stages.forEach(function (s) {
      var b = el.nodes.querySelector('[data-id="' + s.id + '"]');
      var st = statusOf(s), p = progressOf(s);
      b.className = 'node ' + st + (s.id === selectedId ? ' selected' : '');
      b.querySelector('.node-status').textContent = STATUS_LABEL[st];
      b.querySelector('.node-count').textContent = p.done + '/' + p.total;
      b.querySelector('.node-bar > i').style.width = (p.total ? p.done / p.total * 100 : 0) + '%';
      b.setAttribute('aria-label', s.title + ', ' + STATUS_LABEL[st] + ', ' + p.done + ' из ' + p.total);
    });
  }

  function renderLinks() {
    var html = '';
    data.stages.forEach(function (s) {
      s.requires.forEach(function (rid) {
        var a = pos(byId[rid]), b = pos(s);
        var x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
        var mx = (x1 + x2) / 2;
        var srcDone = statusOf(byId[rid]) === 'done';
        var cls = srcDone ? (statusOf(s) === 'done' ? 'done' : 'ready') : '';
        html += '<path data-from="' + rid + '" data-to="' + s.id + '" class="' + cls + '" d="M' + x1 + ',' + y1 +
          ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '"/>';
      });
    });
    el.links.innerHTML = html;
    highlight(selectedId);
  }

  // Подсветка цепочки зависимостей этапа (всё, что нужно для него)
  function highlight(id) {
    var chain = {};
    (function walk(x) {
      if (!x || chain[x]) return;
      chain[x] = true;
      byId[x].requires.forEach(walk);
    })(id);
    el.links.querySelectorAll('path').forEach(function (p) {
      p.classList.toggle('hl', !!(chain[p.dataset.to] && chain[p.dataset.from]));
    });
  }

  function renderStats() {
    var total = 0, done = 0, stagesDone = 0;
    data.stages.forEach(function (s) {
      var p = progressOf(s);
      total += p.total; done += p.done;
      if (statusOf(s) === 'done') stagesDone++;
    });
    var pct = total ? Math.round(done / total * 100) : 0;
    document.getElementById('xpText').textContent = pct + '%';
    document.getElementById('xpFill').style.width = pct + '%';
    document.getElementById('stagesText').textContent = stagesDone + ' / ' + data.stages.length + ' этапов завершено';
  }

  function render() {
    statusCache = {};
    renderNodes();
    renderLinks();
    renderStats();
    if (selectedId) renderPanel();
  }

  // ---------- Панель этапа ----------
  function openPanel(id) {
    selectedId = id;
    el.panel.classList.add('open');
    el.panel.setAttribute('aria-hidden', 'false');
    render();
  }

  function closePanel() {
    selectedId = null;
    el.panel.classList.remove('open');
    el.panel.setAttribute('aria-hidden', 'true');
    render();
  }

  function chipList(ids, emptyText) {
    if (!ids.length) return '<span class="chip none">' + emptyText + '</span>';
    return ids.map(function (id) {
      var s = byId[id];
      var cls = statusOf(s) === 'done' ? ' done' : '';
      return '<button class="chip' + cls + '" data-goto="' + id + '">' + s.icon + ' ' + esc(s.title) + '</button>';
    }).join('');
  }

  function renderPanel() {
    var s = byId[selectedId];
    var st = statusOf(s), p = progressOf(s), editable = canEdit(s);
    var missing = s.requires.filter(function (r) { return statusOf(byId[r]) !== 'done'; });
    var custom = state.custom[s.id] || [];

    var items = itemsOf(s).map(function (it) {
      var isCustom = custom.some(function (c) { return c.id === it.id; });
      var checked = !!state.checked[it.id];
      return '<li class="' + (checked ? 'checked' : '') + '">' +
        '<input type="checkbox" id="cb-' + it.id + '" data-item="' + it.id + '"' + (checked ? ' checked' : '') + (editable ? '' : ' disabled') + '>' +
        '<label for="cb-' + it.id + '"><span class="item-title">' + esc(it.title) + '</span>' +
          (isCustom ? '<span class="custom-tag">свой</span>' : '') +
          (it.hint ? '<span class="item-hint">' + esc(it.hint) + '</span>' : '') + '</label>' +
        (isCustom ? '<button class="item-del" data-del="' + it.id + '" title="Удалить пункт">✕</button>' : '') +
        '</li>';
    }).join('');

    el.panelBody.innerHTML =
      '<div class="panel-head">' +
        '<div class="node-icon">' + s.icon + '</div>' +
        '<div><h2>' + esc(s.title) + '</h2><span class="badge ' + st + '">' + STATUS_LABEL[st] + '</span></div>' +
      '</div>' +
      '<p class="desc">' + esc(s.desc) + '</p>' +
      (st === 'locked' ? '<div class="locked-note">🔒 Чтобы открыть этап, завершите: ' +
        missing.map(function (r) { return esc(byId[r].title); }).join(', ') +
        (state.free ? '<br>Включён свободный режим — пункты можно отмечать.' : '') + '</div>' : '') +
      '<div class="facts">' +
        '<div><b>Ответственный</b>' + esc(s.who) + '</div>' +
        '<div><b>Результат этапа</b>' + esc(s.result) + '</div>' +
      '</div>' +
      '<div class="section-title">Требует</div><div class="chips">' + chipList(s.requires, 'Стартовый этап') + '</div>' +
      '<div class="section-title">Открывает</div><div class="chips">' + chipList(s.unlocks, 'Финальный этап 🎉') + '</div>' +
      '<div class="section-title">Подпункты <span class="mini-progress">' + p.done + ' / ' + p.total + '</span></div>' +
      '<ul class="checklist">' + items + '</ul>' +
      '<form class="add-item" id="addForm"><input id="addInput" placeholder="Добавить свой подпункт…" maxlength="140"><button class="btn" type="submit">+</button></form>' +
      '<div class="panel-actions">' +
        '<button class="btn" id="checkAll"' + (editable ? '' : ' disabled') + '>Отметить все</button>' +
        '<button class="btn danger" id="clearStage">Сбросить этап</button>' +
      '</div>';
  }

  el.panelBody.addEventListener('change', function (e) {
    var id = e.target.dataset.item;
    if (!id) return;
    setChecked([id], e.target.checked);
  });

  el.panelBody.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t) return;
    var s = byId[selectedId];
    if (t.dataset.goto) { openPanel(t.dataset.goto); scrollToNode(t.dataset.goto); }
    else if (t.dataset.del) {
      state.custom[s.id] = (state.custom[s.id] || []).filter(function (c) { return c.id !== t.dataset.del; });
      delete state.checked[t.dataset.del];
      save(); render();
    }
    else if (t.id === 'checkAll') setChecked(itemsOf(s).map(function (i) { return i.id; }), true);
    else if (t.id === 'clearStage') setChecked(itemsOf(s).map(function (i) { return i.id; }), false);
  });

  el.panelBody.addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('addInput');
    var title = input.value.trim();
    if (!title) return;
    var list = state.custom[selectedId] = state.custom[selectedId] || [];
    list.push({ id: selectedId + '-c' + Date.now().toString(36), title: title, hint: '' });
    save(); render();
    var again = document.getElementById('addInput');
    if (again) again.focus();
  });

  function setChecked(ids, value) {
    var before = {};
    data.stages.forEach(function (s) { before[s.id] = statusOf(s); });
    ids.forEach(function (id) { if (value) state.checked[id] = true; else delete state.checked[id]; });
    save();
    render();
    // Награда за завершение этапа
    data.stages.forEach(function (s) {
      if (before[s.id] !== 'done' && statusOf(s) === 'done') {
        var opened = s.unlocks.filter(function (u) { return before[u] === 'locked' && statusOf(byId[u]) !== 'locked'; });
        var msg = '🏆 Этап «' + s.title + '» завершён!';
        if (opened.length) msg += ' Открыто: ' + opened.map(function (u) { return byId[u].title; }).join(', ');
        else if (!s.unlocks.length) msg = '🎉 Объект построен и зарегистрирован! Поздравляем!';
        toast(msg);
      }
    });
  }

  var toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 3500);
  }

  // ---------- Масштаб и перемещение ----------
  function applyZoom() {
    var z = state.zoom;
    el.tree.style.transform = 'scale(' + z + ')';
    el.sizer.style.width = WIDTH * z + 'px';
    el.sizer.style.height = HEIGHT * z + 'px';
    document.getElementById('zoomReset').textContent = Math.round(z * 100) + '%';
  }
  function setZoom(z) {
    state.zoom = Math.min(1.6, Math.max(0.4, Math.round(z * 10) / 10));
    applyZoom(); save();
  }
  document.getElementById('zoomIn').onclick = function () { setZoom(state.zoom + 0.1); };
  document.getElementById('zoomOut').onclick = function () { setZoom(state.zoom - 0.1); };
  document.getElementById('zoomReset').onclick = function () { setZoom(1); };

  function scrollToNode(id) {
    var p = pos(byId[id]), z = state.zoom;
    el.viewport.scrollTo({
      left: p.x * z - el.viewport.clientWidth / 2 + NODE_W * z / 2,
      top: p.y * z - el.viewport.clientHeight / 2 + NODE_H * z / 2,
      behavior: 'smooth'
    });
  }

  var drag = null, dragMoved = false;
  el.viewport.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, sl: el.viewport.scrollLeft, st: el.viewport.scrollTop };
    dragMoved = false;
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 5) { dragMoved = true; el.viewport.classList.add('dragging'); }
    if (dragMoved) {
      el.viewport.scrollLeft = drag.sl - dx;
      el.viewport.scrollTop = drag.st - dy;
    }
  });
  window.addEventListener('pointerup', function () {
    drag = null;
    el.viewport.classList.remove('dragging');
    setTimeout(function () { dragMoved = false; }, 0);
  });
  el.viewport.addEventListener('wheel', function (e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(state.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });

  // ---------- Панель инструментов ----------
  var freeBox = document.getElementById('freeMode');
  freeBox.checked = state.free;
  freeBox.onchange = function () { state.free = freeBox.checked; save(); render(); };

  document.getElementById('resetBtn').onclick = function () {
    if (!confirm('Сбросить весь прогресс и свои подпункты?')) return;
    var zoom = state.zoom;
    state = defaultState();
    state.zoom = zoom;
    freeBox.checked = false;
    save(); render();
  };

  document.getElementById('exportBtn').onclick = function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stroy-roadmap-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };

  var fileInput = document.getElementById('importFile');
  document.getElementById('importBtn').onclick = function () { fileInput.click(); };
  fileInput.onchange = function () {
    var f = fileInput.files[0];
    if (!f) return;
    f.text().then(function (txt) {
      var parsed = JSON.parse(txt);
      if (!parsed || typeof parsed.checked !== 'object') throw new Error('bad');
      state = Object.assign(defaultState(), parsed);
      freeBox.checked = !!state.free;
      save(); applyZoom(); render();
      toast('📥 Прогресс загружен');
    }).catch(function () { toast('⚠️ Не удалось прочитать файл'); });
    fileInput.value = '';
  };

  document.getElementById('panelClose').onclick = closePanel;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && selectedId) closePanel(); });

  // ---------- Утилиты ----------
  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Старт ----------
  buildStatic();
  applyZoom();
  render();
})();
