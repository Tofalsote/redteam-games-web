/* Interfaz: misiones, juegos, terminal, explorador, puntos, logros, chuleta y editor. */
(function () {
  'use strict';

  const { Vfs, modeStr, HOME, USER } = window.VFS;
  const { Shell, DOCS, HOST } = window.SHELL;
  const WinShell = window.WIN && window.WIN.WinShell;
  /* Cada nivel tiene su zona de juego: SETS[n] = { challenges, flags, setup }. */
  const SETS = window.GAMES.sets;
  const setOf = (l) => SETS[l.glevel || 1] || SETS[1];
  const ALL_FLAGS = Object.keys(SETS).reduce((a, k) => a.concat(SETS[k].flags), []);
  const bestKey = (l) => 'rt.best_' + (l.glevel || 1);
  const LESSONS = window.LESSONS;
  const osOf = (l) => l.os || 'linux';
  const LVL_NAMES = {
    linux: { 1: 'Nivel 1 · El punto de apoyo', 2: 'Nivel 2 · Enumeración', 3: 'Nivel 3 · Pivoting de usuario', 4: 'Nivel 4 · Escalada a root', 5: 'Nivel 5 · Vectores avanzados' },
    windows: { 1: 'Nivel 1 · Reconocimiento', 2: 'Nivel 2 · Privilegios de token', 3: 'Nivel 3 · Servicios', 4: 'Nivel 4 · Credenciales y registro', 5: 'Nivel 5 · El asalto final' },
  };
  const WORLDS = [{ id: 'linux', name: 'Linux', icon: '🐉' }, { id: 'windows', name: 'Windows', icon: '🪟' }].filter((w) => LESSONS.some((l) => osOf(l) === w.id));
  let world = 'linux';
  const gnum = (l) => (typeof l.glevel === 'string' ? parseInt(l.glevel.replace(/\D/g, ''), 10) || 1 : l.glevel || 1);
  let LEVELS = [], MISSIONS = [];
  function rebuildLevels() {
    const ms = LESSONS.filter((l) => !l.mode && osOf(l) === world);
    const nums = [...new Set(ms.map((l) => l.level || 1))].sort((a, b) => a - b);
    LEVELS = nums.map((n) => ({ n, os: world, name: (LVL_NAMES[world] || {})[n] || 'Nivel ' + n, list: ms.filter((l) => (l.level || 1) === n) }));
    for (const lv of LEVELS) lv.games = LESSONS.filter((l) => (l.mode === 'arcade' || l.mode === 'ctf') && osOf(l) === world && gnum(l) === lv.n);
    MISSIONS = LEVELS.reduce((a, lv) => a.concat(lv.list), []);
  }
  const levelOf = (l) => LEVELS.find((lv) => lv.list.includes(l)) || LEVELS[0];
  const gotFlags = (l) => setOf(l).flags.filter((f) => flags.has(f.id)).length;

  /* Banderas únicas: cada navegador genera sus propios números y los recuerda,
     así que la bandera de un alumno no coincide con la de otro. */
  function randomDigits(n) {
    let out = '';
    try {
      const a = new Uint32Array(n);
      crypto.getRandomValues(a);
      for (const v of a) out += v % 10;
    } catch (e) {
      for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10);
    }
    return out;
  }
  function assignFlags(renew) {
    const saved = store.get('rt.flagvals', {});
    const vals = saved && typeof saved === 'object' ? saved : {};
    for (const f of ALL_FLAGS) {
      if (!/^\d{12}$/.test(vals[f.id] || '') || (renew && renew.includes(f))) vals[f.id] = randomDigits(12);
      f.flag = 'FLAG{' + vals[f.id] + '}';
    }
    store.set('rt.flagvals', vals);
  }

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const strip = (s) => s.replace(/\x01.|\x02/g, '');
  /* La CSP no deja estilos en línea dentro del HTML: la sangría del árbol (data-d) y el
     ancho de las barras (data-w) se aplican desde aquí cada vez que se pinta un panel. */
  function dataStyles(root) {
    for (const x of root.querySelectorAll('[data-d]')) x.style.setProperty('--d', x.dataset.d);
    for (const x of root.querySelectorAll('[data-w]')) x.style.width = x.dataset.w + '%';
  }

  /* El almacenamiento del navegador puede no estar disponible: la página funciona igual sin él. */
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {}
    },
  };

  const el = {
    sidebar: $('#sidebar'),
    lesson: $('#lesson'),
    panel: $('#panel'),
    buddy: $('#buddy'),
    say: $('#say'),
    out: $('#termOut'),
    body: $('#termBody'),
    input: $('#termIn'),
    prompt: $('#prompt'),
    title: $('#termTitle'),
    tree: $('#tree'),
    crumbs: $('#crumbs'),
    toasts: $('#toasts'),
  };

  const ICON = {
    dir: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2l1.6 1.8H13A1.5 1.5 0 0 1 14.5 5.3v6.2A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
    file: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.2L12.5 5v8A1.5 1.5 0 0 1 11 14.5H4A1.5 1.5 0 0 1 2.5 13V3A1.5 1.5 0 0 1 4 1.5zm5 .9V5h2.6z"/></svg>',
    lock: '<svg class="lock" viewBox="0 0 16 16" aria-label="sin permiso"><path d="M5 7V5a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v4a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 12.5v-4A1.5 1.5 0 0 1 4.5 7zm1.500 0h3V5a1.500 1.500 0 0 0-3 0z"/></svg>',
  };

  const RANKS = [
    [0, 'Script kiddie'],
    [120, 'Curioso'],
    [300, 'Pentester jr.'],
    [550, 'Operador'],
    [850, 'Red teamer'],
    [1200, 'root'],
    [1700, 'Fantasma'],
    [2300, 'Leyenda'],
  ];


  const BADGES = [
    { id: 'first', icon: '👋', name: 'Primer contacto', how: 'Escribe tu primera orden.' },
    { id: 'whoami', icon: '🪪', name: '¿Quién soy?', how: 'Averigua con qué usuario entraste.' },
    { id: 'sudol', icon: '📋', name: 'Lo primero que se mira', how: 'Lanza sudo -l (Linux).' },
    { id: 'suid', icon: '🔎', name: 'Caza de SUID', how: 'Busca binarios SUID (Linux).' },
    { id: 'priv', icon: '🎫', name: 'whoami /priv', how: 'Revisa tus privilegios de token (Windows).' },
    { id: 'nohint', icon: '🧠', name: 'De memoria', how: 'Completa una misión sin pedir pistas.' },
    { id: 'pivot', icon: '🔀', name: 'Pivoting', how: 'Cambia a otro usuario (Linux).' },
    { id: 'loot', icon: '💰', name: 'Botín', how: 'Encuentra una credencial en un archivo.' },
    { id: 'root', icon: '👑', name: '¡root!', how: 'Consigue una shell de root (Linux).' },
    { id: 'system', icon: '⚙️', name: '¡SYSTEM!', how: 'Consigue NT AUTHORITY\\SYSTEM (Windows).' },
    { id: 'gtfo', icon: '🏴', name: 'GTFOBins', how: 'Escala con un sudo mal configurado (Linux).' },
    { id: 'svc', icon: '🧩', name: 'Servicio pwneado', how: 'Escala por un servicio de Windows.' },
    { id: 'speed', icon: '🚀', name: 'Dedos rápidos', how: 'Acierta 8 retos en un contrarreloj.' },
    { id: 'ctf', icon: '🚩', name: 'Cazabanderas', how: 'Captura las banderas de un nivel.' },
    { id: 'ctfall', icon: '🏴‍☠️', name: 'Cazador total', how: 'Captura las banderas de todos los niveles.' },
    { id: 'linuxdone', icon: '🐧', name: 'Dueño del Linux', how: 'Completa todas las misiones de Linux.' },
    { id: 'windone', icon: '🪟', name: 'Dueño del Windows', how: 'Completa todas las misiones de Windows.' },
  ];



  const CHEERS = ['¡Dentro!', 'Perfecto.', 'Eso es.', '¡Bien visto!', 'Pwned.', 'Así se hace.'];

  let fs, sh, lesson, stepIdx, hintShown, usedHint;
  let done = new Set(store.get('rt.done', []));
  let badges = new Set(store.get('rt.badges', []));
  let flags = new Set(store.get('rt.flags', []));
  let xp = store.get('rt.xp', 0);
  let histPos = 0;
  let draft = '';
  let known = new Set();
  let open = new Set(['/', '/home', HOME]);
  let showHidden = false;
  let arc = null;
  const ctfHints = new Set();
  /* Grupos del menú que la persona ha recogido (se recuerda entre visitas). */
  const closed = new Set(store.get('rt.closed', []));
  const foldOf = (l) => world + ':' + (l.mode === 'free' ? 'g' : l.mode ? gnum(l) : levelOf(l).n);
  const foldHead = (key, name, count) =>
    `<h2><button type="button" class="fold" data-fold="${key}" aria-expanded="${!closed.has(key)}"><i aria-hidden="true">▾</i>${name}` +
    `${count ? ` <span>${count}</span>` : ''}</button></h2><ol class="${closed.has(key) ? 'closed' : ''}">`;

  /* ---------- puntos, rangos y logros ---------- */

  function rankOf(v) {
    let i = 0;
    while (i + 1 < RANKS.length && v >= RANKS[i + 1][0]) i++;
    return i;
  }

  function renderHud() {
    const i = rankOf(xp);
    const next = RANKS[i + 1];
    $('#hudLevel').textContent = i + 1;
    $('#hudRank').textContent = RANKS[i][1];
    $('#hudXp').textContent = next ? `${xp} / ${next[0]} XP` : `${xp} XP`;
    $('#hudFill').style.width = (next ? ((xp - RANKS[i][0]) / (next[0] - RANKS[i][0])) * 100 : 100) + '%';
    $('#badgeCount').textContent = `${badges.size}/${BADGES.length}`;
  }

  function addXp(n) {
    if (!n) return;
    const before = rankOf(xp);
    xp += n;
    store.set('rt.xp', xp);
    renderHud();
    const hud = $('#hud');
    hud.classList.remove('bump');
    void hud.offsetWidth;
    hud.classList.add('bump');
    if (rankOf(xp) > before) {
      toast('⬆️', 'Subes de rango', `Ahora eres ${RANKS[rankOf(xp)][1]}`);
      confetti(70);
    }
  }

  function award(id) {
    if (badges.has(id)) return;
    const b = BADGES.find((x) => x.id === id);
    if (!b) return; // logro heredado de Linux Games que aquí no existe (p. ej. 'nano')
    badges.add(id);
    store.set('rt.badges', [...badges]);
    toast(b.icon, 'Logro desbloqueado', b.name);
    addXp(20);
  }

  function toast(icon, title, text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span>${icon}</span><div><b>${esc(tr(title))}</b><small>${esc(tr(text))}</small></div>`;
    el.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3600);
    setTimeout(() => t.remove(), 4100);
  }

  function confetti(n) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#ff7a45', '#ffd166', '#4fd08a', '#74b8f7', '#e879f9'];
    const box = document.createElement('div');
    box.className = 'confetti';
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.style.cssText =
        `left:${Math.random() * 100}%;background:${colors[i % colors.length]};` +
        `animation-delay:${Math.random() * 0.35}s;animation-duration:${1.5 + Math.random()}s;` +
        `--r:${Math.random() * 720 - 360}deg;--x:${Math.random() * 240 - 120}px`;
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3400);
  }

  /* Pix, la mascota: comenta lo que pasa. mood: '', 'happy' u 'oops'. */
  function say(text, mood) {
    el.say.textContent = tr(text);
    el.buddy.className = 'buddy';
    void el.buddy.offsetWidth;
    if (mood) el.buddy.classList.add(mood);
  }

  function errorTip(err) {
    if (/orden no encontrada/.test(err)) return 'Esa orden no existe. Revisa las letras: en Linux las mayúsculas cuentan.';
    if (/se puede instalar con/.test(err)) return 'No está instalada, pero el propio error te dice cómo conseguirla.';
    if (/Permiso denegado|¿es usted superusuario/.test(err)) return 'Permiso denegado. A veces la llave es sudo, y a veces chmod.';
    if (/No existe el archivo/.test(err)) return 'Eso no está ahí. Haz ls para ver qué hay, o usa Tab para autocompletar.';
    if (/Es un directorio/.test(err)) return 'Eso es una carpeta, no un archivo.';
    if (/es peligroso/.test(err)) return '¡Eh! Esa es la orden más temida de Linux. Menos mal que esto es un simulador.';
    return 'Lee el error con calma: casi siempre dice justo lo que falla.';
  }

  /* ---------- terminal ---------- */

  function paintMarks(html) {
    return html.replace(/\x01([DXM])([^\x02]*)\x02/g, (m, t, s) => `<span class="c-${t}">${s}</span>`);
  }

  function print(text, cls) {
    if (!text) return;
    text = tr(text);
    const d = document.createElement('div');
    d.className = 'ln' + (cls ? ' ' + cls : '');
    d.innerHTML = paintMarks(esc(text.replace(/\n$/, '')));
    el.out.appendChild(d);
  }

  function promptHtml() {
    if (sh.win) {
      const cls = sh.system || sh.admin ? 'pr' : 'pp';
      return `<span class="${cls}">PS ${esc(sh.cwd)}</span><span class="${cls}">&gt;</span> `;
    }
    if (sh.rt && sh.rt.suPrompt) return '<span class="pp">Contraseña:</span> ';
    const u = (sh.rt && sh.user) || USER;
    const host = (sh.rt && sh.rt.host) || HOST;
    const root = sh.user === 'root';
    const path = sh.cwd === (sh.env && sh.env.HOME) ? '~' : sh.cwd;
    /* prompt de Kali en dos líneas */
    return (
      `<span class="ktop">┌──(<span class="pu${root ? ' pr' : ''}">${esc(u)}㉿${esc(host)}</span>)-[<span class="pp">${esc(path)}</span>]</span>` +
      `<span class="kbot"><span class="k1">└─</span><span class="${root ? 'pr' : 'pu'}">${root ? '#' : '$'}</span></span> `
    );
  }

  function echoLine(text) {
    const d = document.createElement('div');
    d.className = 'ln';
    d.innerHTML = promptHtml() + esc(text);
    el.out.appendChild(d);
  }

  function refreshPrompt() {
    el.prompt.innerHTML = promptHtml();
    el.title.textContent = sh.win ? sh.sessionInfo().user : sh.rt ? `${sh.user}@${sh.rt.host}` : `${USER}@${HOST}`;
  }

  function scrollTerm() {
    el.body.scrollTop = el.body.scrollHeight;
  }

  function submit(line) {
    echoLine(line);
    const r = sh.run(line);
    if (r.clear) el.out.innerHTML = '';
    for (const [kind, text] of r.parts) print(text, kind === 'err' ? 'err' : '');
    r.out = strip(r.out);

    histPos = sh.history.length;
    draft = '';
    refreshPrompt();
    renderTree();
    line = line.trim();
    if (line) {
      let passed = false;
      if (lesson.mode === 'arcade') passed = arcCheck(line, r);
      else if (lesson.mode === 'ctf') passed = ctfCheck(r);
      else passed = checkStep(line, r);
      if (!passed && r.err) say(errorTip(r.err), 'oops');
      globalBadges(line, r);
    }
    if (r.editor) openNano(r.editor);
    scrollTerm();
  }

  function globalBadges(line, r) {
    award('first');
    if (/^(whoami|id)\b/.test(line) && !r.err) award('whoami');
    if (/^sudo\s+-l/.test(line)) award('sudol');
    if (/find\b.*-perm\b.*4000/.test(line)) award('suid');
    if (/^whoami\s+\/priv/i.test(line)) award('priv');
    if (/password|passwd|clave|creds/i.test(line) && /^(grep|cat|find|type|reg|cmdkey)\b/i.test(line) && !r.err) award('loot');
    if (sh.rt && sh.user !== sh.rt.me && sh.user !== 'root' && /^su\b|\bsu\s/.test(line)) award('pivot');
    if (sh.rt && sh.user === 'root') {
      award('root');
      if (/^sudo\b/.test(line)) award('gtfo');
    }
    if (sh.win && sh.system) {
      award('system');
      if (/^(sc|net|copy)\b/i.test(line)) award('svc');
    }
  }



  function setInput(v) {
    el.input.value = v;
    el.input.setSelectionRange(v.length, v.length);
  }

  function useCommand(cmd) {
    setInput(cmd);
    el.input.focus();
  }

  function insertText(t) {
    const v = el.input.value;
    setInput(v + (v && !/\s$/.test(v) ? ' ' : '') + t);
    el.input.focus();
  }

  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = el.input.value;
      el.input.value = '';
      submit(v);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (histPos === sh.history.length) draft = el.input.value;
      if (histPos > 0) setInput(sh.history[--histPos]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histPos < sh.history.length) {
        histPos++;
        setInput(histPos === sh.history.length ? draft : sh.history[histPos]);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const c = sh.complete(el.input.value);
      if (c.options.length) {
        echoLine(el.input.value);
        print(c.options.join('  '), 'dim');
        scrollTerm();
      }
      setInput(c.line);
    } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      el.out.innerHTML = '';
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && el.input.selectionStart === el.input.selectionEnd) {
      e.preventDefault();
      echoLine(el.input.value + '^C');
      el.input.value = '';
      scrollTerm();
    }
  });

  /* Pulsar en la terminal lleva el cursor a la línea de órdenes, salvo que se esté seleccionando texto. */
  el.body.addEventListener('mouseup', () => {
    if (!String(window.getSelection())) el.input.focus();
  });

  $('#btnReset').addEventListener('click', () => startLesson(lesson.id));

  /* ---------- explorador ---------- */

  /* Panel de "Sesión" para el mundo Windows: quién eres, integridad, privilegios y servicios. */
  function renderWinPanel() {
    const info = sh.sessionInfo();
    const JUICY = (window.WIN && window.WIN.JUICY) || [];
    const hdr = document.querySelector('.exp-bar strong');
    if (hdr) hdr.textContent = 'Sesión';
    if ($('#crumbs')) $('#crumbs').textContent = '';
    const label = info.system ? 'SYSTEM' : info.admin ? 'Administrador' : 'Usuario';
    let html = '<div class="winpanel">';
    html +=
      `<div class="wp-user ${info.system ? 'system' : info.admin ? 'admin' : ''}"><span class="wp-ico">${info.system ? '⚙️' : info.admin ? '👑' : '👤'}</span>` +
      `<div class="wp-id"><b>${esc(info.user)}</b><small>${esc(info.host)} · Integridad ${esc(info.integrity)}</small></div><span class="wp-badge">${label}</span></div>`;
    html += '<div class="wp-sec">Privilegios de token</div>';
    html += info.privs.length
      ? '<ul class="wp-list">' + info.privs.map((pr) => `<li class="${JUICY.includes(pr) ? 'hot' : ''}">${esc(pr)}${JUICY.includes(pr) ? ' <span class="wp-warn">⚠ explotable</span>' : ''}</li>`).join('') + '</ul>'
      : '<p class="wp-empty">(ninguno fuera de lo normal)</p>';
    const svcs = Object.keys(info.services || {});
    if (svcs.length)
      html += '<div class="wp-sec">Servicios</div><ul class="wp-list">' + svcs.map((k) => `<li><b>${esc(k)}</b> <small>${info.services[k].state === 'running' ? 'en marcha' : 'parado'}</small></li>`).join('') + '</ul>';
    if (info.creds && info.creds.length)
      html += '<div class="wp-sec">Credenciales guardadas</div><ul class="wp-list">' + info.creds.map((c) => `<li>${esc(c.user)} <small>→ ${esc(c.target)}</small></li>`).join('') + '</ul>';
    html += '</div>';
    el.tree.innerHTML = html;
  }

  function renderTree() {
    if (sh.win) return renderWinPanel();
    const hdr = document.querySelector('.exp-bar strong');
    if (hdr) hdr.textContent = 'Explorador';
    const cwd = sh.cwd;
    let p = '';
    for (const s of cwd.split('/').filter(Boolean)) {
      p += '/' + s;
      open.add(p);
    }
    const all = fs.allPaths();
    const rows = [];
    const walk = (path, name, n, depth) => {
      const dir = n.type === 'dir';
      const who = sh.user || USER;
      const locked = !(fs.can(n, who, 4) && (!dir || fs.can(n, who, 1)));
      const isOpen = dir && !locked && open.has(path);
      const cls = ['row', dir ? 'dir' : 'file'];
      if (path === cwd) cls.push('here');
      if (!known.has(path) && known.size) cls.push('new');
      if (isOpen) cls.push('open');
      if (name[0] === '.') cls.push('dot');
      if (!dir && n.mode & 0o111) cls.push('exec');
      rows.push(
        `<div class="${cls.join(' ')}" data-path="${esc(path)}" data-dir="${dir ? 1 : 0}" data-d="${depth}" ` +
          `title="${modeStr(n)}  ${esc(n.owner)}:${esc(n.group)}">` +
          `<span class="caret">${dir && !locked ? '▸' : ''}</span>` +
          `<span class="ico">${dir ? ICON.dir : ICON.file}</span>` +
          `<span class="nm">${esc(name)}</span>` +
          (locked ? ICON.lock : '') +
          (path === cwd ? '<span class="badge">estás aquí</span>' : '') +
          `<span class="perm">${modeStr(n)}</span>` +
          '</div>'
      );
      if (isOpen)
        for (const k of Object.keys(n.children).sort((a, b) => a.localeCompare(b, 'es'))) {
          if (k[0] === '.' && !showHidden) continue;
          walk((path === '/' ? '' : path) + '/' + k, k, n.children[k], depth + 1);
        }
    };
    walk('/', '/', fs.root, 0);
    el.tree.innerHTML = rows.join('');
    dataStyles(el.tree);
    known = all;

    const parts = cwd.split('/').filter(Boolean);
    el.crumbs.innerHTML = '<b>/</b>' + parts.map((s) => `<span>${esc(s)}</span>`).join('<i>/</i>');

    const here = el.tree.querySelector('.here');
    if (here) {
      const top = here.offsetTop;
      const box = el.tree;
      if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 28) box.scrollTop = Math.max(0, top - box.clientHeight / 2);
    }
  }

  el.tree.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const path = row.dataset.path;
    if (row.dataset.dir === '1' && e.target.closest('.caret, .ico')) {
      if (open.has(path) && !(sh.cwd + '/').startsWith(path === '/' ? '/' : path + '/')) open.delete(path);
      else open.add(path);
      renderTree();
      return;
    }
    insertText(path === HOME ? '~' : path.startsWith(HOME + '/') ? '~' + path.slice(HOME.length) : path);
  });

  $('#showHidden').addEventListener('change', (e) => {
    showHidden = e.target.checked;
    renderTree();
  });

  /* ---------- menú lateral ---------- */

  function renderSidebar() {
    const item = (l, num, sub) => {
      const cls = [l.id === lesson.id ? 'active' : '', done.has(l.id) ? 'done' : '', l.mode ? 'game' : ''].join(' ');
      return (
        `<li><button type="button" class="${cls}" data-id="${l.id}">` +
        `<span class="num">${num}</span><span class="tx"><b>${esc(l.title)}</b><small>${esc(sub)}</small></span></button></li>`
      );
    };
    const gameSub = (l) => {
      const best = store.get(bestKey(l), 0);
      return l.mode === 'arcade' ? (best ? `Récord: ${best}` : l.tag) : `${gotFlags(l)}/${setOf(l).flags.length} banderas`;
    };
    el.sidebar.innerHTML =
      (WORLDS.length > 1
        ? '<div class="world-switch">' + WORLDS.map((wd) => `<button type="button" class="${wd.id === world ? 'on' : ''}" data-world="${wd.id}">${wd.icon} ${wd.name}</button>`).join('') + '</div>'
        : '') +
      LEVELS.map(
        (lv) =>
          foldHead(String(lv.n), lv.name, `${lv.list.filter((l) => done.has(l.id)).length}/${lv.list.length}`) +
          lv.list.map((l, i) => item(l, done.has(l.id) ? '✓' : i + 1, l.tag)).join('') +
          (lv.games.length ? '<li class="zone">Zona de juego</li>' + lv.games.map((l) => item(l, l.icon, gameSub(l))).join('') : '') +
          '</ol>'
      ).join('') +
      foldHead('g', 'Práctica libre', '') +
      LESSONS.filter((l) => l.mode === 'free' && osOf(l) === world)
        .map((l) => item(l, l.icon, l.tag))
        .join('') +
      '</ol><button type="button" class="link" id="btnWipe">Empezar de cero</button>';
  }

  el.sidebar.addEventListener('click', (e) => {
    const wb = e.target.closest('button[data-world]');
    if (wb) {
      if (wb.dataset.world === world) return;
      world = wb.dataset.world;
      rebuildLevels();
      const pend = MISSIONS.find((l) => !done.has(l.id)) || MISSIONS[0];
      return startLesson(pend.id);
    }
    const b = e.target.closest('button[data-id]');
    if (b) return startLesson(b.dataset.id);
    const f = e.target.closest('[data-fold]');
    if (f) {
      if (closed.has(f.dataset.fold)) closed.delete(f.dataset.fold);
      else closed.add(f.dataset.fold);
      store.set('rt.closed', [...closed]);
      return renderSidebar();
    }
    if (e.target.id === 'btnWipe' && confirm(tr('¿Borrar tus puntos, logros y misiones completadas?'))) {
      done = new Set();
      badges = new Set();
      flags = new Set();
      xp = 0;
      for (const k of ['done', 'badges', 'flags', 'flagvals', 'xp', 'best', 'best2', 'best3', 'best4', 'current', 'closed']) {
        try {
          localStorage.removeItem('rt.' + k);
        } catch (err) {}
      }
      assignFlags();
      renderHud();
      startLesson(LESSONS[0].id);
    }
  });

  /* ---------- misiones ---------- */

  function hintButton(cmd) {
    return `<button type="button" class="hint-cmd" data-cmd="${esc(cmd)}" title="Pulsa para llevarla a la terminal"><code>${esc(cmd)}</code><span>usar</span></button>`;
  }

  function renderPanel() {
    if (lesson.mode === 'arcade') return renderArcade();
    if (lesson.mode === 'ctf') return renderCtf();
    renderLesson();
  }

  function renderLesson() {
    const i = MISSIONS.indexOf(lesson);
    const finished = !lesson.mode && stepIdx >= lesson.steps.length;
    let html =
      `<div class="kicker">${lesson.mode ? 'Práctica libre' : 'Nivel ' + levelOf(lesson).n + ' · Misión ' + (levelOf(lesson).list.indexOf(lesson) + 1)} · ${esc(lesson.tag)}</div>` +
      `<h1>${esc(lesson.title)}</h1><div class="prose">${lesson.body}</div>`;
    if (lesson.widget === 'perms') html += '<div id="permsWidget" class="perms-widget"></div>';

    if (lesson.steps.length) {
      const pct = (Math.min(stepIdx, lesson.steps.length) / lesson.steps.length) * 100;
      html +=
        `<h2 class="steps-title">Tu turno <span>${Math.min(stepIdx, lesson.steps.length)} / ${lesson.steps.length}</span>` +
        `<i class="mini-bar"><i data-w="${pct}"></i></i></h2><ol class="steps">`;
      lesson.steps.forEach((s, k) => {
        const st = k < stepIdx ? 'done' : k === stepIdx ? 'current' : 'todo';
        html += `<li class="${st}"><span class="mk">${k < stepIdx ? '✓' : k + 1}</span><div><p>${s.t}</p>`;
        if (st === 'current') html += hintShown ? hintButton(s.hint) : '<button type="button" class="link" id="btnHint">Necesito una pista</button>';
        html += '</div></li>';
      });
      html += '</ol>';
    }

    if (finished) {
      const next = MISSIONS[i + 1];
      const lvDone = !next || levelOf(next) !== levelOf(lesson);
      const arcade = levelOf(lesson).games.find((g) => g.mode === 'arcade');
      html +=
        '<div class="finish"><div class="big">✓</div><div><b>¡Misión superada!</b>' +
        `<p>${!next ? 'Has completado todas las misiones. Ahora demuéstralo en la zona de juego.' : levelOf(next) !== levelOf(lesson) ? '¡Nivel completado! Se desbloquea el siguiente: ahora viene lo serio.' : 'Una menos. La siguiente te espera.'}</p>` +
        (next
          ? `<button type="button" class="btn primary" data-next="${next.id}">${levelOf(next) !== levelOf(lesson) ? 'Empezar el nivel ' + levelOf(next).n : 'Siguiente'}: ${esc(next.title)} →</button>`
          : '') +
        (lvDone && arcade ? ` <button type="button" class="btn${next ? '' : ' primary'}" data-next="${arcade.id}">Jugar a la zona de juego del nivel ${levelOf(lesson).n}</button>` : '') +
        '</div></div>';
    }
    el.panel.innerHTML = html;
    dataStyles(el.panel);
    if (lesson.widget === 'perms') renderPerms();
    const cur = el.panel.querySelector('.steps .current, .finish');
    if (cur && stepIdx > 0) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  el.panel.addEventListener('click', (e) => {
    if (e.target.id === 'btnHint') {
      hintShown = true;
      usedHint = true;
      renderLesson();
      return;
    }
    const h = e.target.closest('.hint-cmd');
    if (h) return useCommand(h.dataset.cmd);
    const n = e.target.closest('[data-next]');
    if (n) return startLesson(n.dataset.next);
    const code = e.target.closest('.cards code');
    if (code) return useCommand(code.textContent);
    const pb = e.target.closest('.pw-bits button');
    if (pb) {
      permBits ^= Number(pb.dataset.bit);
      return renderPerms();
    }
    if (e.target.closest('#arcStart')) return arcStart();
    if (e.target.closest('#arcSkip')) return arcSkip();
    if (e.target.closest('#ctfReset')) {
      for (const f of setOf(lesson).flags) flags.delete(f.id);
      assignFlags(setOf(lesson).flags);
      store.set('rt.flags', [...flags]);
      return startLesson(lesson.id);
    }
    const fh = e.target.closest('[data-flaghint]');
    if (fh) {
      ctfHints.add(fh.dataset.flaghint);
      renderCtf();
    }
  });

  function checkStep(line, r) {
    const step = lesson.steps[stepIdx];
    if (!step) return false;
    let pass = false;
    try {
      pass = step.ok({ line, sh, fs, r });
    } catch (e) {
      pass = false;
    }
    if (!pass) return false;
    const fresh = !done.has(lesson.id);
    const gain = fresh ? (hintShown ? 5 : 10) : 0;
    stepIdx++;
    hintShown = false;
    if (stepIdx >= lesson.steps.length) {
      done.add(lesson.id);
      store.set('rt.done', [...done]);
      print('✓ ¡Misión superada!' + (fresh ? `  +${gain + 50} XP` : ''), 'ok');
      say('¡Misión superada! Eres una máquina.', 'happy');
      confetti(90);
      if (fresh) addXp(gain + 50);
      if (!usedHint) award('nohint');
      if (LESSONS.filter((l) => !l.mode && osOf(l) === 'linux').every((l) => done.has(l.id))) award('linuxdone');
      if (LESSONS.filter((l) => !l.mode && osOf(l) === 'windows').every((l) => done.has(l.id))) award('windone');
      renderSidebar();
    } else {
      print('✓ Paso ' + stepIdx + (gain ? `  +${gain} XP` : ''), 'ok');
      say(pick(CHEERS), 'happy');
      addXp(gain);
    }
    renderLesson();
    return true;
  }

  /* ---------- contrarreloj ---------- */

  const ARC_TIME = 75;

  function renderArcade() {
    const best = store.get(bestKey(lesson), 0);
    let html = `<div class="kicker">Nivel ${lesson.glevel || 1} · Zona de juego · ${ARC_TIME} segundos</div><h1>Contrarreloj</h1>`;
    if (!arc) {
      html +=
        '<div class="prose"><p>Pix te pide algo y tú lo escribes en la terminal. Cada acierto suma puntos, y si aciertas varios seguidos, el <b>combo</b> los multiplica. Solo salen órdenes de este nivel.</p></div>' +
        `<div class="arc-idle"><div class="arc-best"><small>Tu récord</small><b>${best}</b></div>` +
        '<button type="button" class="btn primary big" id="arcStart">▶ Empezar</button></div>' +
        '<p class="note">¿Te atascas? Pulsa «Saltar»: pierdes el combo, pero ves cómo se hacía.</p>';
    } else if (!arc.over) {
      html +=
        '<div class="arc-hud">' +
        `<div><small>Puntos</small><b>${arc.score}</b></div>` +
        `<div class="${arc.combo > 1 ? 'hot' : ''}"><small>Combo</small><b>x${Math.max(arc.combo, 1)}</b></div>` +
        `<div><small>Tiempo</small><b id="arcSecs">${ARC_TIME}</b></div></div>` +
        '<div class="arc-time"><i id="arcBar"></i></div>' +
        `<div class="arc-card"><small>Reto ${arc.hits + arc.skips + 1}</small><p>${arc.cur.goal}</p></div>` +
        '<button type="button" class="btn" id="arcSkip">Saltar →</button>';
    } else {
      html +=
        `<div class="arc-result"><div class="arc-best"><small>${arc.record ? '¡Nuevo récord!' : 'Puntuación'}</small><b>${arc.score}</b></div>` +
        `<p>${arc.hits} ${arc.hits === 1 ? 'acierto' : 'aciertos'} · mejor combo x${Math.max(arc.maxCombo, 1)} · +${arc.hits * 5} XP</p>` +
        `<p class="note">Tu récord: ${Math.max(best, arc.score)}</p>` +
        '<button type="button" class="btn primary big" id="arcStart">↻ Otra vez</button></div>';
    }
    el.panel.innerHTML = html;
    if (arc && !arc.over) arcTick();
  }

  function arcStart() {
    arcStop();
    resetWorld();
    el.out.innerHTML = '';
    arc = { end: Date.now() + ARC_TIME * 1000, score: 0, combo: 0, maxCombo: 0, hits: 0, skips: 0, cur: null, over: false };
    arcNext();
    arc.timer = setInterval(arcTick, 100);
    say('¡Vamos! Lee el reto y escribe.', 'happy');
    renderArcade();
    el.input.focus();
  }

  function arcStop() {
    if (arc && arc.timer) clearInterval(arc.timer);
  }

  function arcNext() {
    let ch;
    do ch = pick(setOf(lesson).challenges);
    while (ch === arc.cur);
    arc.cur = ch;
    if (!sh.win) sh.cwd = ch.cwd || HOME;
    if (ch.setup) ch.setup(sh, fs);
    refreshPrompt();
    renderTree();
  }

  function arcTick() {
    if (!arc || arc.over) return;
    const left = Math.max(0, arc.end - Date.now());
    const bar = $('#arcBar');
    if (bar) {
      bar.style.width = (left / (ARC_TIME * 1000)) * 100 + '%';
      bar.classList.toggle('low', left < 15000);
      $('#arcSecs').textContent = Math.ceil(left / 1000);
    }
    if (left <= 0) arcEnd();
  }

  function arcCheck(line, r) {
    if (!arc || arc.over) return false;
    let pass = false;
    try {
      pass = arc.cur.ok({ line, sh, fs, r });
    } catch (e) {
      pass = false;
    }
    if (pass) {
      arc.combo++;
      arc.maxCombo = Math.max(arc.maxCombo, arc.combo);
      const pts = 100 + (arc.combo - 1) * 25;
      arc.score += pts;
      arc.hits++;
      print(`✓ +${pts}` + (arc.combo > 1 ? `   combo x${arc.combo}` : ''), 'ok');
      say(arc.combo > 2 ? `¡Combo x${arc.combo}!` : pick(CHEERS), 'happy');
      arcNext();
    } else arc.combo = 0;
    renderArcade();
    return pass;
  }

  function arcSkip() {
    if (!arc || arc.over) return;
    print('Se podía hacer con:  ' + arc.cur.sol, 'dim');
    arc.combo = 0;
    arc.skips++;
    arcNext();
    renderArcade();
    scrollTerm();
    el.input.focus();
  }

  function arcEnd() {
    arcStop();
    arc.over = true;
    const best = store.get(bestKey(lesson), 0);
    arc.record = arc.score > best && arc.score > 0;
    if (arc.record) store.set(bestKey(lesson), arc.score);
    print(`⏱ ¡Tiempo! ${arc.score} puntos.`, 'ok');
    say(arc.record ? '¡Nuevo récord! Enséñaselo a alguien.' : arc.hits ? 'Nada mal. ¿Otra para superarte?' : 'El primero siempre cuesta. Repasa una misión y vuelve.', arc.hits ? 'happy' : '');
    if (arc.record) confetti(90);
    addXp(arc.hits * 5);
    if (arc.hits >= 8) award('speed');
    renderArcade();
    renderSidebar();
    scrollTerm();
  }

  /* ---------- caza de banderas ---------- */

  function renderCtf() {
    const FLAGS = setOf(lesson).flags;
    const got = gotFlags(lesson);
    const all = got === FLAGS.length;
    let html =
      `<div class="kicker">Nivel ${lesson.glevel || 1} · Zona de juego · 5 secretos</div><h1>Caza de banderas</h1>` +
      '<div class="prose"><p>Alguien ha escondido cinco banderas con la forma <code>FLAG{...}</code> en este sistema. ' +
      'Para capturar una, consigue que aparezca en tu terminal. Así son las competiciones de hacking de verdad (se llaman <b>CTF</b>).</p>' +
      '<p class="note">Tus banderas son únicas: los números de dentro son distintos en cada ordenador, así que las de otra persona no te sirven.</p></div>' +
      `<div class="flag-count">${FLAGS.map((f) => `<i class="${flags.has(f.id) ? 'on' : ''}">🚩</i>`).join('')}<span>${got} de ${FLAGS.length}</span></div>` +
      '<ol class="flags">';
    FLAGS.forEach((f, i) => {
      const got = flags.has(f.id);
      html += `<li class="${got ? 'got' : ''}"><span class="mk">${got ? '✓' : i + 1}</span><div><b>${esc(f.name)}</b><p>${esc(f.clue)}</p>`;
      if (got) html += `<code class="flag">${esc(f.flag)}</code>`;
      else if (ctfHints.has(f.id)) html += `<p class="flag-hint">💡 ${esc(f.hint)}</p>`;
      else html += `<button type="button" class="link" data-flaghint="${f.id}">Necesito una pista</button>`;
      html += '</div></li>';
    });
    html += '</ol>';
    if (all)
      html +=
        '<div class="finish"><div class="big">🚩</div><div><b>¡Las tienes todas!</b><p>' + esc(lesson.outro || 'Has usado ls, find, grep, chmod y sudo para resolver un problema real. Eso es saber Linux.') + '</p>' +
        '<button type="button" class="btn" id="ctfReset">Volver a esconderlas</button></div></div>';
    el.panel.innerHTML = html;
  }

  function ctfCheck(r) {
    let hit = false;
    const FLAGS = setOf(lesson).flags;
    for (const f of FLAGS) {
      if (flags.has(f.id) || !r.out.includes(f.flag)) continue;
      hit = true;
      flags.add(f.id);
      store.set('rt.flags', [...flags]);
      print(`🚩 Bandera capturada: ${f.name}   +40 XP`, 'ok');
      say(`¡Bandera! Llevas ${gotFlags(lesson)} de ${FLAGS.length}.`, 'happy');
      confetti(50);
      addXp(40);
    }
    if (hit) {
      if (gotFlags(lesson) === FLAGS.length) award('ctf');
      if (ALL_FLAGS.every((f) => flags.has(f.id))) award('ctfall');
      renderCtf();
      renderSidebar();
    }
    return hit;
  }

  /* ---------- cambio de misión o juego ---------- */

  function resetWorld() {
    histPos = 0;
    draft = '';
    if (osOf(lesson) === 'windows') {
      sh = new WinShell();
      fs = null;
      if (lesson.mode === 'ctf') setOf(lesson).setup(sh);
      if (lesson.setup) lesson.setup(sh);
      refreshPrompt();
      renderTree();
      return;
    }
    fs = new Vfs();
    sh = new Shell(fs);
    open = new Set(['/', '/home', HOME]);
    known = new Set();
    if (lesson.mode === 'ctf') setOf(lesson).setup(sh, fs);
    if (lesson.setup) lesson.setup(sh, fs);
    refreshPrompt();
    renderTree();
  }

  function startLesson(id) {
    arcStop();
    arc = null;
    $('#nano').hidden = true;
    lesson = LESSONS.find((l) => l.id === id) || LESSONS[0];
    world = osOf(lesson);
    rebuildLevels();
    store.set('rt.world', world);
    if (closed.delete(foldOf(lesson))) store.set('rt.closed', [...closed]);
    stepIdx = 0;
    hintShown = false;
    usedHint = false;
    store.set('rt.current', lesson.id);
    el.out.innerHTML = '';
    resetWorld();
    print(
      lesson.mode === 'ctf'
        ? 'Empieza por aquí:  cat LEEME.txt'
        : lesson.mode === 'arcade'
          ? 'Pulsa «Empezar» cuando quieras. Mientras tanto, puedes calentar aquí.'
          : lesson.mode === 'free'
            ? 'Terminal libre. Escribe «help» para ver todas las órdenes.'
            : 'Terminal de prácticas. Es un simulador: nada de lo que hagas aquí afecta a tu equipo.',
      'dim'
    );
    el.input.value = '';
    say(lesson.say || '', '');
    renderSidebar();
    renderPanel();
    el.lesson.scrollTop = 0;
  }

  /* ---------- calculadora de permisos ---------- */

  let permBits = 0o644;

  function renderPerms() {
    const box = $('#permsWidget');
    if (!box) return;
    const who = ['Dueño', 'Grupo', 'Los demás'];
    const what = [
      ['r', 'leer', 4],
      ['w', 'escribir', 2],
      ['x', 'ejecutar', 1],
    ];
    let html = '<div class="pw-grid">';
    who.forEach((w, i) => {
      const shift = 6 - i * 3;
      const val = (permBits >> shift) & 7;
      html += `<div class="pw-col"><span class="pw-who">${w}</span><div class="pw-bits">`;
      for (const [letter, label, bit] of what) {
        const on = !!(val & bit);
        html += `<button type="button" class="${on ? 'on' : ''}" data-bit="${bit << shift}" aria-pressed="${on}" title="${label} (${bit})">${letter}<small>${bit}</small></button>`;
      }
      html += `</div><span class="pw-num">${val}</span></div>`;
    });
    const oct = permBits.toString(8).padStart(3, '0');
    html +=
      `</div><div class="pw-out"><code class="pw-str">${modeStr({ type: 'file', mode: permBits })}</code>` +
      hintButton(`chmod ${oct} hola.sh`) +
      '</div><p class="pw-note">Cada grupo suma: leer 4 + escribir 2 + ejecutar 1. Pulsa las letras.</p>';
    box.innerHTML = html;
  }

  /* ---------- chuleta y logros ---------- */

  const cheat = $('#cheat');
  const trophy = $('#trophy');

  function renderCheat(q) {
    q = (q || '').toLowerCase();
    const cats = {};
    for (const d of DOCS) {
      if ((d.os || 'linux') !== world) continue;
      if (q && !(d.cmd + ' ' + d.desc + ' ' + d.cat + ' ' + d.ex).toLowerCase().includes(q)) continue;
      (cats[d.cat] = cats[d.cat] || []).push(d);
    }
    const keys = Object.keys(cats);
    $('#cheatBody').innerHTML = keys.length
      ? keys
          .map(
            (k) =>
              `<section><h3>${esc(k)}</h3><div class="cheat-grid">` +
              cats[k].map((d) => `<article><code class="cmd">${esc(d.cmd)}</code><p>${esc(d.desc)}</p>${hintButton(d.ex)}</article>`).join('') +
              '</div></section>'
          )
          .join('')
      : '<p class="empty">Ninguna orden coincide con esa búsqueda.</p>';
  }

  $('#btnCheat').addEventListener('click', () => {
    $('#cheatSearch').value = '';
    renderCheat('');
    cheat.showModal();
  });
  $('#cheatSearch').addEventListener('input', (e) => renderCheat(e.target.value));
  cheat.addEventListener('click', (e) => {
    if (e.target === cheat || e.target.closest('.dlg-close')) return cheat.close();
    const h = e.target.closest('.hint-cmd');
    if (h) {
      cheat.close();
      useCommand(h.dataset.cmd);
    }
  });

  function openTrophies() {
    const i = rankOf(xp);
    $('#trophyBody').innerHTML =
      '<div class="ranks">' +
      RANKS.map(([min, name], k) => `<div class="${k < i ? 'past' : k === i ? 'now' : ''}"><b>${k + 1}</b><span>${name}</span><small>${min} XP</small></div>`).join('') +
      '</div><div class="badge-grid">' +
      BADGES.map(
        (b) => `<article class="${badges.has(b.id) ? 'on' : ''}"><span>${badges.has(b.id) ? b.icon : '🔒'}</span><b>${esc(b.name)}</b><small>${esc(b.how)}</small></article>`
      ).join('') +
      '</div>';
    trophy.showModal();
  }
  $('#hud').addEventListener('click', openTrophies);
  $('#btnTrophy').addEventListener('click', openTrophies);
  trophy.addEventListener('click', (e) => {
    if (e.target === trophy || e.target.closest('.dlg-close')) trophy.close();
  });

  /* ---------- editor nano ---------- */

  const nano = { box: $('#nano'), text: $('#nanoText'), msg: $('#nanoMsg'), state: $('#nanoState'), file: null };

  function openNano(ed) {
    nano.file = ed;
    nano.text.value = ed.content;
    $('#nanoFile').textContent = ed.name;
    nano.state.textContent = '';
    nano.msg.textContent = ed.content ? `[ ${ed.content.replace(/\n$/, '').split('\n').length} líneas leídas ]` : '[ Archivo nuevo ]';
    nano.box.hidden = false;
    nano.text.focus();
  }

  function saveNano() {
    let content = nano.text.value;
    if (content && !content.endsWith('\n')) content += '\n';
    try {
      fs.write(nano.file.path, nano.file.user, content);
      nano.msg.textContent = `[ ${content ? content.split('\n').length - 1 : 0} líneas escritas ]`;
      nano.state.textContent = '';
      renderTree();
      award('nano');
    } catch (e) {
      nano.msg.textContent = `[ Error al escribir ${nano.file.name}: ${e.message} ]`;
    }
  }

  function closeNano() {
    nano.box.hidden = true;
    el.input.focus();
  }

  nano.text.addEventListener('input', () => (nano.state.textContent = tr('Modificado')));
  nano.text.addEventListener('keydown', (e) => {
    if (!e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === 'o' || k === 's') {
      e.preventDefault();
      saveNano();
    } else if (k === 'x') {
      e.preventDefault();
      closeNano();
    }
  });
  $('#nanoSave').addEventListener('click', () => {
    saveNano();
    nano.text.focus();
  });
  $('#nanoExit').addEventListener('click', closeNano);

  /* ---------- tema ---------- */

  const theme = store.get('rt.theme', null);
  if (theme) document.documentElement.dataset.theme = theme;
  $('#btnTheme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    store.set('rt.theme', next);
  });

  /* ---------- arranque ---------- */

  /* ---------- idioma ---------- */

  /* Castellano por defecto. En inglés se cambian los textos de las misiones y juegos por los de js/en.js,
     y lo que pinta la interfaz o la terminal pasa por tr(), que sustituye frases conocidas. */
  const EN = window.EN;
  let lang = EN && store.get('rt.lang', 'es') === 'en' ? 'en' : 'es';

  function tr(s) {
    if (lang !== 'en' || !s) return s;
    for (const [a, b] of EN.rules) s = typeof a === 'string' ? s.split(a).join(b) : s.replace(a, b);
    return s;
  }
  const trEl = (e) => {
    if (lang !== 'en' || !e) return;
    for (const x of e.querySelectorAll('[style]')) x.removeAttribute('style'); // si no, la CSP los bloquea al volver a leerlos
    e.innerHTML = tr(e.innerHTML);
    dataStyles(e);
  };

  function applyLang() {
    const en = lang === 'en' ? EN : null;
    for (const l of LESSONS) {
      if (!l._es) l._es = { title: l.title, tag: l.tag, say: l.say, body: l.body, outro: l.outro, steps: l.steps.map((s) => s.t) };
      const src = (en && en.lessons[l.id]) || {};
      for (const k of ['title', 'tag', 'say', 'body', 'outro']) l[k] = src[k] !== undefined ? src[k] : l._es[k];
      l.steps.forEach((s, k) => (s.t = (src.steps && src.steps[k]) || l._es.steps[k]));
    }
    for (const n of Object.keys(SETS)) {
      SETS[n].challenges.forEach((ch, k) => {
        if (ch._es === undefined) ch._es = ch.goal;
        ch.goal = (en && en.goals[n] && en.goals[n][k]) || ch._es;
      });
      for (const f of SETS[n].flags) {
        if (!f._es) f._es = [f.name, f.clue, f.hint];
        [f.name, f.clue, f.hint] = (en && en.flags[f.id]) || f._es;
      }
    }
    for (const d of DOCS) {
      if (!d._es) d._es = [d.cat, d.desc];
      d.cat = (en && en.cats[d._es[0]]) || d._es[0];
      d.desc = (en && en.docs[d.cmd]) || d._es[1];
    }
    for (const b of BADGES) {
      if (!b._es) b._es = [b.name, b.how];
      [b.name, b.how] = (en && en.badges[b.id]) || b._es;
    }
    RANKS.forEach((r, i) => {
      if (r[2] === undefined) r[2] = r[1];
      r[1] = (en && en.ranks[i]) || r[2];
    });
    for (const lv of LEVELS) {
      if (!lv._es) lv._es = lv.name;
      lv.name = (en && en.levels[lv.n]) || lv._es;
    }
    if (!CHEERS._es) CHEERS._es = CHEERS.slice();
    CHEERS.forEach((x, i) => (CHEERS[i] = (en && en.cheers[i]) || CHEERS._es[i]));
  }

  const pageEs = [];
  function applyPage() {
    const get = (e, kind) => (kind === 'text' ? e.textContent : kind === 'html' ? e.innerHTML : e.getAttribute(kind === 'aria' ? 'aria-label' : kind));
    const set = (e, kind, v) => {
      if (kind === 'text') e.textContent = v;
      else if (kind === 'html') e.innerHTML = v;
      else e.setAttribute(kind === 'aria' ? 'aria-label' : kind, v);
    };
    (EN ? EN.page : []).forEach(([sel, kind, en], i) => {
      for (const e of document.querySelectorAll(sel)) {
        if (pageEs[i] === undefined) pageEs[i] = get(e, kind);
        set(e, kind, lang === 'en' ? en : pageEs[i]);
      }
    });
    document.documentElement.lang = lang;
    if ($('#btnLang')) $('#btnLang').textContent = lang === 'en' ? 'ES' : 'EN';
  }

  /* Tras pintar cada zona, se traduce lo que ha quedado en pantalla. */
  const after = (fn, extra) =>
    function () {
      const r = fn.apply(this, arguments);
      extra();
      return r;
    };
  renderSidebar = after(renderSidebar, () => trEl(el.sidebar));
  renderLesson = after(renderLesson, () => trEl(el.panel));
  renderArcade = after(renderArcade, () => trEl(el.panel));
  renderCtf = after(renderCtf, () => trEl(el.panel));
  renderPerms = after(renderPerms, () => trEl($('#permsWidget')));
  renderCheat = after(renderCheat, () => trEl($('#cheatBody')));
  renderTree = after(renderTree, () => trEl(el.tree));
  const nanoTr = () => (nano.msg.textContent = tr(nano.msg.textContent));
  openNano = after(openNano, nanoTr);
  saveNano = after(saveNano, nanoTr);
  $('#hud').addEventListener('click', () => trEl($('#trophyBody')));
  $('#btnTrophy').addEventListener('click', () => trEl($('#trophyBody')));
  $('#nanoSave').addEventListener('click', nanoTr);

  if ($('#btnLang')) $('#btnLang').addEventListener('click', () => {
    if (!EN) return;
    lang = lang === 'en' ? 'es' : 'en';
    store.set('rt.lang', lang);
    applyLang();
    applyPage();
    renderHud();
    renderSidebar();
    renderPanel();
    renderTree();
    say(lesson.say || '', '');
  });

  applyLang();
  applyPage();

  assignFlags();
  renderHud();
  world = store.get('rt.world', 'linux');
  if (!WORLDS.some((w) => w.id === world)) world = 'linux';
  rebuildLevels();
  const pending = MISSIONS.find((l) => !done.has(l.id));
  startLesson(store.get('rt.current', null) || (pending || LESSONS[0]).id);
  if (window.matchMedia('(min-width: 900px)').matches) el.input.focus();
})();
