(function () {
  'use strict';

  var DATA = window.ROADMAP;
  var I18N = window.I18N;
  var STORAGE_KEY = 'stroy-roadmap-v2';
  var OLD_STORAGE_KEY = 'stroy-roadmap-v1';
  var COL_W = 260, ROW_H = 150, PAD_X = 30, PAD_Y = 90, NODE_W = 210, NODE_H = 96;

  var LIB = {};
  DATA.stages.forEach(function (s) { LIB[s.id] = s; });
  var TEMPLATES = {};
  DATA.templates.forEach(function (t) { TEMPLATES[t.id] = t; });

  // ---------- Состояние ----------
  // { v, projects: [{ id, name, template, checked, custom }], current, free, zoom, lang }
  var state = load();
  var tree = null;          // собранная карта текущего объекта
  var selectedId = null;
  var statusCache = {};

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function detectLang() {
    var l = (navigator.language || '').toLowerCase();
    return l.indexOf('kk') === 0 ? 'kk' : 'ru';
  }

  function defaultState() {
    return { v: 2, projects: [], current: null, free: false, zoom: 1, lang: detectLang() };
  }

  function newProject(name, template) {
    return { id: uid(), name: name, template: template, checked: {}, custom: {} };
  }

  // Приводит сохранённые данные (в т.ч. старого формата v1) к текущему виду
  function normalize(raw) {
    var st = defaultState();
    if (!raw || typeof raw !== 'object') return st;
    ['free', 'zoom', 'lang'].forEach(function (k) { if (k in raw) st[k] = raw[k]; });
    if (Array.isArray(raw.projects)) {
      st.projects = raw.projects.filter(function (p) { return p && TEMPLATES[p.template]; }).map(function (p) {
        return { id: p.id || uid(), name: String(p.name || ''), template: p.template, checked: p.checked || {}, custom: p.custom || {} };
      });
      st.current = raw.current;
    } else if (raw.checked && typeof raw.checked === 'object') {
      // v1: один объект с полной картой
      var p = newProject(TEMPLATES.multi.title, 'multi');
      p.checked = raw.checked;
      p.custom = raw.custom || {};
      st.projects.push(p);
    }
    if (!st.projects.some(function (p) { return p.id === st.current; })) {
      st.current = st.projects.length ? st.projects[0].id : null;
    }
    if (st.lang !== 'kk') st.lang = 'ru';
    if (typeof st.zoom !== 'number') st.zoom = 1;
    return st;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
      var old = localStorage.getItem(OLD_STORAGE_KEY);
      if (old) return normalize(JSON.parse(old));
    } catch (e) { /* хранилище недоступно */ }
    return defaultState();
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* игнорируем */ }
  }

  function project() {
    for (var i = 0; i < state.projects.length; i++) if (state.projects[i].id === state.current) return state.projects[i];
    return null;
  }

  // ---------- Перевод ----------
  function T(key, vars) {
    var str = (I18N.ui[state.lang] || I18N.ui.ru)[key] || I18N.ui.ru[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { str = str.replace('{' + k + '}', vars[k]); });
    return str;
  }
  function isKk() { return state.lang === 'kk'; }
  function tTitle(t) { return (isKk() && I18N.kk.templates[t.id] && I18N.kk.templates[t.id].title) || t.title; }
  function tDesc(t) { return (isKk() && I18N.kk.templates[t.id] && I18N.kk.templates[t.id].desc) || t.desc; }
  function L(s, field) { return (isKk() && s.kk[field]) || s.ru[field]; }
  function itemTitle(it) { return (isKk() && it.kkTitle) || it.title; }
  function itemHint(it) { return isKk() && it.kkTitle ? it.kkHint : it.hint; }
  function phaseTitle(id) { return (isKk() && I18N.kk.phases[id]) || DATA.phaseTitles[id]; }
  function projectName(p) { return p.name || tTitle(TEMPLATES[p.template]); }

  // ---------- Сборка карты по шаблону ----------
  var treeCache = {};
  function buildTree(tid) {
    if (treeCache[tid]) return treeCache[tid];
    var t = TEMPLATES[tid];
    var ov = t.overrides || {};
    var kkOv = (I18N.kk.templates[tid] || {}).overrides || {};
    var byId = {};
    var stages = t.layout.map(function (row) {
      var id = row[0], base = LIB[id], o = ov[id] || {}, ko = kkOv[id] || {}, kb = I18N.kk.stages[id] || {};
      var s = { id: id, icon: base.icon, col: row[1], row: row[2], requires: row[3], unlocks: [], ru: {}, kk: {} };
      ['title', 'who', 'result', 'desc'].forEach(function (f) {
        s.ru[f] = o[f] || base[f];
        // если поле переопределено шаблоном, берём только перевод переопределения
        s.kk[f] = o[f] ? ko[f] : (ko[f] || kb[f]);
      });
      var ruItems = o.items || base.items;
      var kkItems = o.items ? ko.items : kb.items;
      s.items = ruItems.map(function (it, i) {
        var a = Array.isArray(it) ? it : [it];
        var k = kkItems && kkItems[i];
        return { id: id + '-' + i, title: a[0], hint: a[1] || '', kkTitle: k ? k[0] : '', kkHint: k ? (k[1] || '') : '' };
      });
      byId[id] = s;
      return s;
    });
    stages.forEach(function (s) { s.requires.forEach(function (r) { byId[r].unlocks.push(s.id); }); });
    var maxCol = Math.max.apply(null, stages.map(function (s) { return s.col; }));
    var maxRow = Math.max.apply(null, stages.map(function (s) { return s.row; }));
    treeCache[tid] = {
      template: t, stages: stages, byId: byId, final: t.final,
      width: PAD_X * 2 + (maxCol + 1) * COL_W,
      height: PAD_Y + (maxRow + 1) * ROW_H + 40
    };
    return treeCache[tid];
  }

  // ---------- Логика этапов ----------
  function itemsOf(s) { return s.items.concat(project().custom[s.id] || []); }

  function progressOf(s) {
    var list = itemsOf(s), checked = project().checked;
    var done = list.filter(function (i) { return checked[i.id]; }).length;
    return { done: done, total: list.length };
  }

  function statusOf(s) {
    if (statusCache[s.id]) return statusCache[s.id];
    var p = progressOf(s), st;
    if (p.total > 0 && p.done === p.total) st = 'done';
    else if (!s.requires.every(function (r) { return statusOf(tree.byId[r]) === 'done'; })) st = 'locked';
    else st = p.done > 0 ? 'progress' : 'available';
    statusCache[s.id] = st;
    return st;
  }

  function canEdit(s) { return state.free || statusOf(s) !== 'locked'; }

  // ---------- Элементы ----------
  var el = {
    viewport: document.getElementById('viewport'),
    sizer: document.getElementById('sizer'),
    tree: document.getElementById('tree'),
    phases: document.getElementById('phases'),
    links: document.getElementById('links'),
    nodes: document.getElementById('nodes'),
    panel: document.getElementById('panel'),
    panelBody: document.getElementById('panelBody'),
    toast: document.getElementById('toast'),
    modal: document.getElementById('modal'),
    modalCard: document.getElementById('modalCard'),
    projectSelect: document.getElementById('projectSelect')
  };

  function pos(s) {
    return { x: PAD_X + s.col * COL_W + (COL_W - NODE_W) / 2 - 10, y: PAD_Y + s.row * ROW_H + 20 };
  }

  // ---------- Отрисовка карты ----------
  function buildStatic() {
    el.tree.style.width = tree.width + 'px';
    el.tree.style.height = tree.height + 'px';
    el.links.setAttribute('width', tree.width);
    el.links.setAttribute('height', tree.height);

    el.phases.innerHTML = '';
    tree.template.phases.forEach(function (ph, i) {
      var d = document.createElement('div');
      d.className = 'phase';
      d.dataset.phase = ph[0];
      d.dataset.index = i;
      d.style.setProperty('--c', DATA.phaseColors[ph[0]]);
      d.style.left = (PAD_X + ph[1] * COL_W - 20) + 'px';
      d.style.width = ((ph[2] - ph[1] + 1) * COL_W) + 'px';
      d.innerHTML = '<div class="phase-title"><span class="phase-era"></span><small></small></div>';
      el.phases.appendChild(d);
    });

    el.nodes.innerHTML = '';
    tree.stages.forEach(function (s) {
      var p = pos(s);
      var b = document.createElement('button');
      b.className = 'node';
      b.dataset.id = s.id;
      b.style.left = p.x + 'px';
      b.style.top = p.y + 'px';
      b.innerHTML =
        '<div class="node-icon">' + s.icon + '</div>' +
        '<div class="node-body">' +
          '<div class="node-title"></div>' +
          '<div class="node-meta"><span class="node-status"></span><span class="node-count"></span></div>' +
          '<div class="node-bar"><i></i></div>' +
        '</div>';
      b.addEventListener('click', function () { if (!dragMoved) openPanel(s.id); });
      b.addEventListener('mouseenter', function () { highlight(s.id); });
      b.addEventListener('mouseleave', function () { highlight(selectedId); });
      el.nodes.appendChild(b);
    });
    applyZoom();
  }

  function renderNodes() {
    el.phases.querySelectorAll('.phase').forEach(function (d) {
      d.querySelector('.phase-era').textContent = T('era') + ' ' + (+d.dataset.index + 1);
      d.querySelector('small').textContent = phaseTitle(d.dataset.phase);
    });
    tree.stages.forEach(function (s) {
      var b = el.nodes.querySelector('[data-id="' + s.id + '"]');
      var st = statusOf(s), p = progressOf(s);
      b.className = 'node ' + st + (s.id === selectedId ? ' selected' : '');
      b.querySelector('.node-title').textContent = L(s, 'title');
      b.querySelector('.node-status').textContent = T(st);
      b.querySelector('.node-count').textContent = p.done + '/' + p.total;
      b.querySelector('.node-bar > i').style.width = (p.total ? p.done / p.total * 100 : 0) + '%';
      b.setAttribute('aria-label', L(s, 'title') + ', ' + T(st) + ', ' + p.done + '/' + p.total);
    });
  }

  function renderLinks() {
    var html = '';
    tree.stages.forEach(function (s) {
      s.requires.forEach(function (rid) {
        var a = pos(tree.byId[rid]), b = pos(s);
        var x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
        var mx = (x1 + x2) / 2;
        var srcDone = statusOf(tree.byId[rid]) === 'done';
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
      if (!x || chain[x] || !tree.byId[x]) return;
      chain[x] = true;
      tree.byId[x].requires.forEach(walk);
    })(id);
    el.links.querySelectorAll('path').forEach(function (p) {
      p.classList.toggle('hl', !!(chain[p.dataset.to] && chain[p.dataset.from]));
    });
  }

  function renderStats() {
    var total = 0, done = 0, stagesDone = 0;
    tree.stages.forEach(function (s) {
      var p = progressOf(s);
      total += p.total; done += p.done;
      if (statusOf(s) === 'done') stagesDone++;
    });
    var pct = total ? Math.round(done / total * 100) : 0;
    document.getElementById('xpText').textContent = pct + '%';
    document.getElementById('xpFill').style.width = pct + '%';
    document.getElementById('stagesText').textContent = T('stagesDone', { n: stagesDone, t: tree.stages.length });
  }

  function renderProjects() {
    el.projectSelect.innerHTML = state.projects.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === state.current ? ' selected' : '') + '>' +
        TEMPLATES[p.template].icon + ' ' + esc(projectName(p)) + '</option>';
    }).join('');
    document.getElementById('deleteProjectBtn').disabled = state.projects.length < 2;
  }

  function applyStaticText() {
    document.documentElement.lang = state.lang;
    document.title = T('appTitle');
    document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = T(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(function (n) {
      n.title = T(n.dataset.i18nTitle);
      if (n.tagName === 'BUTTON' || n.tagName === 'SELECT') n.setAttribute('aria-label', n.title);
    });
    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.lang === state.lang);
      b.setAttribute('aria-pressed', b.dataset.lang === state.lang);
    });
  }

  function render() {
    applyStaticText();
    if (!project()) return;
    statusCache = {};
    renderProjects();
    renderNodes();
    renderLinks();
    renderStats();
    if (selectedId) renderPanel();
  }

  // Переключение на объект: пересобрать карту
  function switchProject(id) {
    state.current = id;
    save();
    closePanel(true);
    tree = buildTree(project().template);
    buildStatic();
    el.viewport.scrollTo(0, 0);
    render();
  }

  // ---------- Панель этапа ----------
  function openPanel(id) {
    selectedId = id;
    el.panel.classList.add('open');
    el.panel.setAttribute('aria-hidden', 'false');
    render();
  }

  function closePanel(silent) {
    selectedId = null;
    el.panel.classList.remove('open');
    el.panel.setAttribute('aria-hidden', 'true');
    if (!silent) render();
  }

  function chipList(ids, emptyText) {
    if (!ids.length) return '<span class="chip none">' + emptyText + '</span>';
    return ids.map(function (id) {
      var s = tree.byId[id];
      var cls = statusOf(s) === 'done' ? ' done' : '';
      return '<button class="chip' + cls + '" data-goto="' + id + '">' + s.icon + ' ' + esc(L(s, 'title')) + '</button>';
    }).join('');
  }

  function renderPanel() {
    var s = tree.byId[selectedId];
    var proj = project();
    var st = statusOf(s), p = progressOf(s), editable = canEdit(s);
    var missing = s.requires.filter(function (r) { return statusOf(tree.byId[r]) !== 'done'; });
    var custom = proj.custom[s.id] || [];

    var items = itemsOf(s).map(function (it) {
      var isCustom = custom.some(function (c) { return c.id === it.id; });
      var checked = !!proj.checked[it.id];
      return '<li class="' + (checked ? 'checked' : '') + '">' +
        '<input type="checkbox" id="cb-' + it.id + '" data-item="' + it.id + '"' + (checked ? ' checked' : '') + (editable ? '' : ' disabled') + '>' +
        '<label for="cb-' + it.id + '"><span class="item-title">' + esc(itemTitle(it)) + '</span>' +
          (isCustom ? '<span class="custom-tag">' + T('custom') + '</span>' : '') +
          (itemHint(it) ? '<span class="item-hint">' + esc(itemHint(it)) + '</span>' : '') + '</label>' +
        (isCustom ? '<button class="item-del" data-del="' + it.id + '" title="' + T('deleteItem') + '">✕</button>' : '') +
        '</li>';
    }).join('');

    var noUnlocks = s.id === tree.final ? T('finalStage') : T('noUnlocks');

    el.panelBody.innerHTML =
      '<div class="panel-head">' +
        '<div class="node-icon">' + s.icon + '</div>' +
        '<div><h2>' + esc(L(s, 'title')) + '</h2><span class="badge ' + st + '">' + T(st) + '</span></div>' +
      '</div>' +
      '<p class="desc">' + esc(L(s, 'desc')) + '</p>' +
      (st === 'locked' ? '<div class="locked-note">' + T('lockedNote') +
        missing.map(function (r) { return esc(L(tree.byId[r], 'title')); }).join(', ') +
        (state.free ? '<br>' + T('freeNote') : '') + '</div>' : '') +
      '<div class="facts">' +
        '<div><b>' + T('who') + '</b>' + esc(L(s, 'who')) + '</div>' +
        '<div><b>' + T('result') + '</b>' + esc(L(s, 'result')) + '</div>' +
      '</div>' +
      '<div class="section-title">' + T('requires') + '</div><div class="chips">' + chipList(s.requires, T('startStage')) + '</div>' +
      '<div class="section-title">' + T('unlocks') + '</div><div class="chips">' + chipList(s.unlocks, noUnlocks) + '</div>' +
      '<div class="section-title">' + T('items') + ' <span class="mini-progress">' + p.done + ' / ' + p.total + '</span></div>' +
      '<ul class="checklist">' + items + '</ul>' +
      '<form class="add-item" id="addForm"><input id="addInput" placeholder="' + T('addPlaceholder') + '" maxlength="140"><button class="btn" type="submit">+</button></form>' +
      '<div class="panel-actions">' +
        '<button class="btn" id="checkAll"' + (editable ? '' : ' disabled') + '>' + T('checkAll') + '</button>' +
        '<button class="btn danger" id="clearStage">' + T('clearStage') + '</button>' +
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
    var s = tree.byId[selectedId], proj = project();
    if (t.dataset.goto) { openPanel(t.dataset.goto); scrollToNode(t.dataset.goto); }
    else if (t.dataset.del) {
      proj.custom[s.id] = (proj.custom[s.id] || []).filter(function (c) { return c.id !== t.dataset.del; });
      delete proj.checked[t.dataset.del];
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
    var proj = project();
    var list = proj.custom[selectedId] = proj.custom[selectedId] || [];
    list.push({ id: selectedId + '-c' + uid(), title: title, hint: '' });
    save(); render();
    var again = document.getElementById('addInput');
    if (again) again.focus();
  });

  function setChecked(ids, value) {
    var proj = project();
    var before = {};
    tree.stages.forEach(function (s) { before[s.id] = statusOf(s); });
    ids.forEach(function (id) { if (value) proj.checked[id] = true; else delete proj.checked[id]; });
    save();
    render();
    // Награда за завершение этапа
    tree.stages.forEach(function (s) {
      if (before[s.id] !== 'done' && statusOf(s) === 'done') {
        var opened = s.unlocks.filter(function (u) { return before[u] === 'locked' && statusOf(tree.byId[u]) !== 'locked'; });
        var msg = T('stageDone', { s: L(s, 'title') });
        if (s.id === tree.final) msg = T('finished');
        else if (opened.length) msg += T('opened') + opened.map(function (u) { return L(tree.byId[u], 'title'); }).join(', ');
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

  // ---------- Объекты (проекты) ----------
  function openProjectModal(first) {
    var cards = DATA.templates.map(function (t, i) {
      return '<label class="tpl">' +
        '<input type="radio" name="tpl" value="' + t.id + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<span class="tpl-icon">' + t.icon + '</span>' +
        '<span class="tpl-body"><b>' + esc(tTitle(t)) + '</b><small>' + esc(tDesc(t)) + '</small>' +
        '<em>' + T('stagesCount', { n: t.layout.length }) + '</em></span>' +
        '</label>';
    }).join('');
    el.modalCard.innerHTML =
      '<form id="projectForm">' +
        '<div class="lang-switch modal-lang" role="group">' +
          Object.keys(I18N.langs).map(function (l) {
            return '<button type="button" class="btn" data-lang="' + l + '">' + I18N.langs[l] + '</button>';
          }).join('') +
        '</div>' +
        '<h2>' + (first ? T('welcome') : T('newProjectTitle')) + '</h2>' +
        '<p class="modal-text">' + T('welcomeText') + '</p>' +
        '<div class="tpl-list">' + cards + '</div>' +
        '<label class="field"><span>' + T('projectName') + '</span>' +
          '<input id="projectName" maxlength="60" placeholder="' + esc(tTitle(DATA.templates[0])) + '"></label>' +
        '<div class="modal-actions">' +
          (first ? '' : '<button type="button" class="btn" id="modalCancel">' + T('cancel') + '</button>') +
          '<button type="submit" class="btn primary">' + T('create') + '</button>' +
        '</div>' +
      '</form>';
    el.modal.classList.add('open');
    el.modal.dataset.required = first ? '1' : '';
    applyStaticText();
    var form = document.getElementById('projectForm');
    form.addEventListener('change', function () {
      document.getElementById('projectName').placeholder = tTitle(TEMPLATES[form.tpl.value]);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var tid = form.tpl.value;
      var name = document.getElementById('projectName').value.trim() || tTitle(TEMPLATES[tid]);
      var p = newProject(name, tid);
      state.projects.push(p);
      el.modal.dataset.required = '';
      closeModal();
      switchProject(p.id);
    });
    var cancel = document.getElementById('modalCancel');
    if (cancel) cancel.onclick = closeModal;
    setTimeout(function () { var r = form.querySelector('input[name=tpl]:checked'); if (r) r.focus(); }, 50);
  }

  function closeModal() {
    if (el.modal.dataset.required) return;   // первый объект обязателен
    el.modal.classList.remove('open');
  }
  el.modal.addEventListener('click', function (e) { if (e.target === el.modal) closeModal(); });

  el.projectSelect.onchange = function () { switchProject(el.projectSelect.value); };
  document.getElementById('newProjectBtn').onclick = function () { openProjectModal(false); };
  document.getElementById('renameProjectBtn').onclick = function () {
    var p = project();
    var name = prompt(T('renamePrompt'), projectName(p));
    if (name === null) return;
    p.name = name.trim();
    save(); render();
  };
  document.getElementById('deleteProjectBtn').onclick = function () {
    var p = project();
    if (state.projects.length < 2) return;
    if (!confirm(T('deleteConfirm', { s: projectName(p) }))) return;
    state.projects = state.projects.filter(function (x) { return x.id !== p.id; });
    switchProject(state.projects[0].id);
  };

  // ---------- Масштаб и перемещение ----------
  function applyZoom() {
    var z = state.zoom;
    el.tree.style.transform = 'scale(' + z + ')';
    if (tree) {
      el.sizer.style.width = tree.width * z + 'px';
      el.sizer.style.height = tree.height * z + 'px';
    }
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
    var p = pos(tree.byId[id]), z = state.zoom;
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

  // Сброс — только прогресс текущего объекта
  document.getElementById('resetBtn').onclick = function () {
    if (!confirm(T('resetConfirm'))) return;
    var p = project();
    p.checked = {};
    p.custom = {};
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
      var next = normalize(JSON.parse(txt));
      if (!next.projects.length) throw new Error('empty');
      state = next;
      freeBox.checked = !!state.free;
      el.modal.dataset.required = '';
      closeModal();
      save();
      switchProject(state.current);
      toast(T('imported'));
    }).catch(function () { toast(T('importError')); });
    fileInput.value = '';
  };

  document.getElementById('panelClose').onclick = function () { closePanel(); };
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (el.modal.classList.contains('open')) closeModal();
    else if (selectedId) closePanel();
  });

  // Переключатель языка (в шапке и в окне выбора объекта)
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-lang]');
    if (!b || b.dataset.lang === state.lang) return;
    state.lang = b.dataset.lang;
    save();
    render();
    if (el.modal.classList.contains('open')) {
      // сохраняем выбранный тип и введённое название
      var form = document.getElementById('projectForm');
      var tpl = form.tpl.value, name = document.getElementById('projectName').value;
      openProjectModal(!!el.modal.dataset.required);
      form = document.getElementById('projectForm');
      form.querySelector('input[value="' + tpl + '"]').checked = true;
      document.getElementById('projectName').value = name;
      document.getElementById('projectName').placeholder = tTitle(TEMPLATES[tpl]);
    }
  });

  // ---------- Установка (PWA) ----------
  var installPrompt = null;
  var installBtn = document.getElementById('installBtn');
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.onclick = function () {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.finally(function () { installPrompt = null; installBtn.hidden = true; });
  };
  window.addEventListener('appinstalled', function () { installBtn.hidden = true; });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* без офлайн-режима */ });
    });
  }

  // ---------- Утилиты ----------
  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Старт ----------
  if (project()) {
    switchProject(state.current);
  } else {
    applyStaticText();
    openProjectModal(true);
  }
})();
