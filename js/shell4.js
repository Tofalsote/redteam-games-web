/* Órdenes del nivel 4: expresiones regulares (grep -o), huellas (sha256sum, base64), permisos
   (stat, find -perm/-user), red (nmap, nc, nslookup) y git. Se añaden sin cambiar las anteriores. */
(function (G) {
  'use strict';

  const { FsError, fail, modeStr, HOME, USER } = G.VFS;
  const { COMMANDS, DOCS, PACKAGES, HOSTS } = G.SHELL;
  const { opts, guard, inputs, lines, bytes, base, cmp, escRe, globRe, mark } = G.SHELL.util;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  PACKAGES.nmap = 'escáner de puertos';
  HOSTS.servidor = '192.168.1.50';
  HOSTS.router = '192.168.1.1';

  /* Estado propio del nivel: repositorios git y puertos extra de la red simulada. */
  function x4(sh) {
    if (!sh.x4) sh.x4 = { repos: {}, ports: {}, banners: {} };
    return sh.x4;
  }

  /* ---------- huellas ---------- */

  function sha256(text) {
    const data = Array.from(new TextEncoder().encode(text));
    const primes = [];
    for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n);
    const frac = (x) => Math.floor((x - Math.floor(x)) * 4294967296);
    const K = primes.map((p) => frac(Math.cbrt(p)));
    let h = primes.slice(0, 8).map((p) => frac(Math.sqrt(p)));
    const bits = data.length * 8;
    data.push(0x80);
    while (data.length % 64 !== 56) data.push(0);
    for (let i = 7; i >= 0; i--) data.push(i > 3 ? 0 : (bits >>> (i * 8)) & 255);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < data.length; o += 64) {
      const w = [];
      for (let i = 0; i < 16; i++) w[i] = ((data[o + i * 4] << 24) | (data[o + i * 4 + 1] << 16) | (data[o + i * 4 + 2] << 8) | data[o + i * 4 + 3]) >>> 0;
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      h = [a, b, c, d, e, f, g, hh].map((v, i) => (v + h[i]) >>> 0);
    }
    return h.map((v) => v.toString(16).padStart(8, '0')).join('');
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64enc(text) {
    const b = new TextEncoder().encode(text);
    let o = '';
    for (let i = 0; i < b.length; i += 3) {
      const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
      o += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
    }
    return o;
  }
  function b64dec(s) {
    s = s.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4) return null;
    const out = [];
    for (let i = 0; i < s.length; i += 4) {
      const v = [0, 1, 2, 3].map((k) => (s[i + k] === '=' ? 0 : B64.indexOf(s[i + k])));
      const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
      out.push((n >> 16) & 255);
      if (s[i + 2] !== '=') out.push((n >> 8) & 255);
      if (s[i + 3] !== '=') out.push(n & 255);
    }
    return new TextDecoder().decode(new Uint8Array(out));
  }

  /* ---------- permisos ---------- */

  /* -perm 644 (exacto), -perm -022 (todos esos bits), -perm -o+w (letras). */
  function permTest(spec) {
    let all = false;
    if (spec[0] === '-' || spec[0] === '/') {
      all = true;
      spec = spec.slice(1);
    }
    let bits;
    if (/^[0-7]{1,4}$/.test(spec)) bits = parseInt(spec, 8) & 0o7777;
    else {
      const m = /^([ugoa]*)[+=]([rwx]+)$/.exec(spec);
      if (!m) return null;
      let b = 0;
      for (const ch of m[2]) b |= { r: 4, w: 2, x: 1 }[ch];
      bits = 0;
      for (const w of !m[1] || m[1].includes('a') ? 'ugo' : m[1]) bits |= b << { u: 6, g: 3, o: 0 }[w];
      all = true;
    }
    return (mode) => (all ? (mode & bits) === bits : (mode & 0o777) === bits);
  }

  /* ---------- red ---------- */

  const PORTS = {
    '127.0.0.1': { 22: ['ssh', 'OpenSSH 9.6p1 Ubuntu'], 631: ['ipp', 'CUPS 2.4'] },
    '192.168.1.50': { 22: ['ssh', 'OpenSSH 9.6p1 Ubuntu'], 80: ['http', 'nginx 1.24.0'], 3306: ['mysql', 'MySQL 8.0.36'] },
    '192.168.1.1': { 53: ['domain', 'dnsmasq 2.90'], 80: ['http', 'lighttpd'] },
  };
  const resolve = (h) => (/^\d+\.\d+\.\d+\.\d+$/.test(h || '') ? h : h === 'localhost' ? '127.0.0.1' : HOSTS[h]);
  function portsOf(sh, addr) {
    const out = Object.assign({}, PORTS[addr] || {}, x4(sh).ports[addr] || {});
    if (addr === '127.0.0.1')
      for (const p of sh.procs) {
        const m = /\bnc\b.*-l.*?(\d{2,5})/.exec(p.cmd);
        if (m) out[m[1]] = ['desconocido', ''];
      }
    return out;
  }

  /* ---------- git ---------- */

  function repoOf(c) {
    const repos = x4(c.sh).repos;
    let p = c.sh.cwd;
    for (;;) {
      if (own(repos, p) && c.fs.find(p + '/.git')) return { root: p, r: repos[p] };
      if (p === '/') return null;
      p = c.fs.split(p)[0];
    }
  }
  function workTree(c, root) {
    const out = {};
    const walk = (p, rel, n) => {
      if (n.type === 'file') out[rel] = n.content;
      else for (const k of Object.keys(n.children)) if (!(rel === '' && k === '.git')) walk(p + '/' + k, rel ? rel + '/' + k : k, n.children[k]);
    };
    walk(root, '', c.fs.node(root));
    return out;
  }
  const headTree = (r) => (r.commits.length ? r.commits[r.commits.length - 1].tree : {});
  const relOf = (c, root, arg) => {
    const p = c.path(arg);
    return p === root ? '' : p.startsWith(root + '/') ? p.slice(root.length + 1) : null;
  };

  /* Para preparar repositorios desde las misiones y los juegos. */
  function makeRepo(sh, fs, root, commits) {
    if (!fs.find(root + '/.git')) {
      let cur = '';
      for (const s of (root + '/.git').split('/').filter(Boolean)) {
        cur += '/' + s;
        if (!fs.find(cur)) {
          fs.mkdir(cur, 'root');
          Object.assign(fs.node(cur), { owner: USER, group: USER });
        }
      }
    }
    const r = (x4(sh).repos[root] = { index: {}, commits: [] });
    commits.forEach((cm, i) => {
      const tree = Object.assign({}, cm.files);
      r.commits.push({ id: sha256(cm.msg + i + JSON.stringify(tree)).slice(0, 7), msg: cm.msg, tree });
      r.index = Object.assign({}, tree);
    });
    const last = headTree(r);
    for (const k of Object.keys(last)) {
      fs.write(root + '/' + k, 'root', last[k]);
      Object.assign(fs.node(root + '/' + k), { owner: USER, group: USER });
    }
    return r;
  }

  const grepPrev = COMMANDS.grep;

  Object.assign(COMMANDS, {
    grep(a, c) {
      const { flags, rest } = opts(a);
      if (!flags.has('o') || flags.has('r') || flags.has('R') || flags.has('l')) return grepPrev(a, c);
      if (!rest.length) return c.fail('Modo de empleo: grep -o PATRÓN [FICHERO]...');
      const pat = rest.shift();
      let re;
      try {
        re = new RegExp(pat, 'g' + (flags.has('i') ? 'i' : ''));
      } catch (e) {
        re = new RegExp(escRe(pat), 'g' + (flags.has('i') ? 'i' : ''));
      }
      const ins = inputs(c, 'grep', rest);
      let found = false;
      for (const [name, text] of ins)
        lines(text).forEach((l, i) => {
          for (const m of l.match(re) || []) {
            if (!m) continue;
            found = true;
            c.print((ins.length > 1 ? name + ':' : '') + (flags.has('n') ? i + 1 + ':' : '') + (c.tty ? mark('M', m) : m));
          }
        });
      if (!found) c.code = 1;
    },

    find(a, c) {
      const start = [];
      const tests = [];
      for (let i = 0; i < a.length; i++) {
        const x = a[i];
        if (x === '-name' || x === '-iname') {
          const re = globRe(a[++i] || '*', x === '-iname');
          tests.push((n, name) => re.test(name));
        } else if (x === '-type') {
          const t = a[++i];
          tests.push((n) => (t === 'd') === (n.type === 'dir'));
        } else if (x === '-user') {
          const u = a[++i];
          tests.push((n) => n.owner === u);
        } else if (x === '-writable') {
          tests.push((n) => c.fs.can(n, c.user, 2));
        } else if (x === '-readable') {
          tests.push((n) => c.fs.can(n, c.user, 4));
        } else if (x === '-perm') {
          const t = permTest(a[++i] || '');
          if (!t) return c.fail(`find: modo no válido «${a[i] || ''}». Ejemplos: -perm 644   -perm -o+w`);
          tests.push((n) => t(n.mode));
        } else if (x[0] === '-') return c.fail(`find: predicado desconocido '${x}'`);
        else start.push(x);
      }
      if (!start.length) start.push('.');
      for (const s of start)
        guard(c, `find: '${s}'`, () => {
          const walk = (shown, p, n) => {
            if (tests.every((t) => t(n, p === '/' ? '/' : base(p)))) c.print(shown);
            if (n.type !== 'dir') return;
            if (!c.fs.can(n, c.user, 4) || !c.fs.can(n, c.user, 1)) return c.fail(`find: '${shown}': Permiso denegado`);
            for (const k of Object.keys(n.children).sort(cmp)) walk(shown.replace(/\/$/, '') + '/' + k, (p === '/' ? '' : p) + '/' + k, n.children[k]);
          };
          walk(s, c.path(s), c.fs.node(c.path(s), c.user));
        });
    },

    stat(a, c) {
      if (!a.length) return c.fail('stat: falta un operando. Ejemplo: stat notas.txt');
      for (const t of a)
        guard(c, `stat: no se puede efectuar 'stat' sobre '${t}'`, () => {
          const n = c.fs.node(c.path(t), c.user);
          const size = n.type === 'dir' ? 4096 : n.size !== undefined ? n.size : bytes(n.content);
          const uid = (u) => (own(c.sh.users, u) ? c.sh.users[u] : 1100);
          c.print(
            `  Fichero: ${t}\n  Tamaño: ${size}\t\t${n.type === 'dir' ? 'directorio' : 'fichero regular'}\n` +
              `Acceso: (${(n.mode & 0o777).toString(8).padStart(4, '0')}/${modeStr(n)})  Uid: (${String(uid(n.owner)).padStart(5)}/${n.owner})   Gid: (${String(uid(n.group)).padStart(5)}/${n.group})\n` +
              `Modificación: ${new Date(n.mtime).toISOString().replace('T', ' ').slice(0, 19)}`
          );
        });
    },

    sha256sum(a, c) {
      const { flags, rest } = opts(a);
      if (flags.has('c')) {
        if (!rest.length) return c.fail('sha256sum: indica el archivo con las sumas. Ejemplo: sha256sum -c SHA256SUMS');
        let bad = 0;
        for (const l of lines(c.fs.read(c.path(rest[0]), c.user))) {
          const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l.trim());
          if (!m) continue;
          let ok = false;
          try {
            ok = sha256(c.fs.read(c.path(m[2]), c.user)) === m[1];
          } catch (e) {
            if (!(e instanceof FsError)) throw e;
            c.fail(`sha256sum: ${m[2]}: ${e.message}`);
          }
          if (!ok) bad++;
          c.print(`${m[2]}: ${ok ? 'La suma coincide' : 'FALLÓ'}`);
        }
        if (bad) {
          c.fail(`sha256sum: ATENCIÓN: ${bad} suma${bad > 1 ? 's calculadas NO coinciden' : ' calculada NO coincide'}`);
          c.code = 1;
        }
        return;
      }
      for (const [name, text] of inputs(c, 'sha256sum', rest)) c.print(sha256(text) + '  ' + (name || '-'));
    },

    base64(a, c) {
      const { flags, rest } = opts(a);
      for (const [, text] of inputs(c, 'base64', rest)) {
        if (flags.has('d')) {
          const out = b64dec(text);
          if (out === null) {
            c.fail('base64: entrada inválida');
            continue;
          }
          c.out += out;
        } else c.print(b64enc(text).replace(/(.{76})(?=.)/g, '$1\n'));
      }
    },

    which(a, c) {
      for (const n of a) {
        if (n === 'cd' || n === 'history' || n === 'help') continue;
        if (COMMANDS[n] && c.sh.available(n)) c.print('/usr/bin/' + n);
        else {
          const p = c.sh.lookPath(n, c.user);
          if (p) c.print(p);
          else c.code = 1;
        }
      }
    },

    ss(a, c) {
      const rows = [
        'Netid State  Local Address:Port   Proceso',
        'udp   UNCONN 127.0.0.53%lo:53     systemd-resolved',
        'udp   UNCONN 0.0.0.0:5353         avahi-daemon',
        'tcp   LISTEN 127.0.0.53%lo:53     systemd-resolved',
        'tcp   LISTEN 127.0.0.1:631        cupsd',
        'tcp   LISTEN 0.0.0.0:22           sshd',
      ];
      for (const p of c.sh.procs) {
        const m = /\bnc\b.*-l.*?(\d{2,5})/.exec(p.cmd);
        if (m) rows.push(`tcp   LISTEN ${('0.0.0.0:' + m[1]).padEnd(20)} nc (pid ${p.pid})`);
      }
      c.print(rows.join('\n'));
    },

    nslookup(a, c) {
      const h = a.find((x) => x[0] !== '-');
      if (!h) return c.fail('Uso: nslookup nombre. Ejemplo: nslookup ubuntu.com');
      const addr = resolve(h);
      c.print('Server:\t\t127.0.0.53\nAddress:\t127.0.0.53#53\n');
      if (!addr) {
        c.print(`** server can't find ${h}: NXDOMAIN`);
        c.code = 1;
        return;
      }
      c.print(`Non-authoritative answer:\nName:\t${h}\nAddress: ${addr}`);
    },

    nmap(a, c) {
      const h = a.find((x, i) => x[0] !== '-' && a[i - 1] !== '-p');
      if (!h) return c.fail('Uso: nmap [-sV] equipo. Ejemplo: nmap servidor');
      const addr = resolve(h);
      if (!addr || !(PORTS[addr] || x4(c.sh).ports[addr])) return c.fail(`Failed to resolve "${h}".\n(En este simulador solo existen: localhost, servidor y router)`);
      const ver = a.some((x) => /^-\w*sV/.test(x) || x === '-A');
      const ports = portsOf(c.sh, addr);
      const keys = Object.keys(ports).map(Number).sort((x, y) => x - y);
      c.print(`Starting Nmap 7.94 ( https://nmap.org )\nNmap scan report for ${h} (${addr})\nHost is up (0.00042s latency).\nNot shown: ${1000 - keys.length} closed tcp ports (conn-refused)`);
      c.print('PORT      STATE SERVICE' + (ver ? '      VERSION' : ''));
      for (const k of keys) c.print(`${(k + '/tcp').padEnd(9)} open  ${ver ? ports[k][0].padEnd(12) + ' ' + (ports[k][1] || '?') : ports[k][0]}`);
      c.print(`\nNmap done: 1 IP address (1 host up) scanned in 0.${ver ? '94' : '31'} seconds`);
    },

    nc(a, c) {
      const { flags, rest } = opts(a);
      if (flags.has('l')) return c.fail('nc: en este simulador no se pueden abrir puertos. Sirve para probarlos: nc -zv servidor 22');
      const [h, port] = rest;
      const addr = resolve(h);
      if (!h || !port) return c.fail('Uso: nc -zv equipo puerto. Ejemplo: nc -zv servidor 22');
      if (!addr) return c.fail(`nc: getaddrinfo for host "${h}" port ${port}: Name or service not known`);
      const p = portsOf(c.sh, addr)[port];
      if (!p) {
        c.fail(`nc: connect to ${h} (${addr}) port ${port} (tcp) failed: Connection refused`);
        c.code = 1;
        return;
      }
      if (flags.has('z')) return c.print(`Connection to ${h} (${addr}) ${port} port [tcp/${p[0]}] succeeded!`);
      const banner = x4(c.sh).banners[addr + ':' + port];
      c.print(banner || `(Conectado a ${h}:${port}. Este servicio no dice nada por sí solo.)`);
    },

    git(a, c) {
      const sub = a[0];
      const args = a.slice(1);
      const repos = x4(c.sh).repos;
      if (!sub) return c.fail('uso: git <orden>. Este simulador entiende: init, status, add, commit, log, diff, restore');
      if (sub === 'config') return;
      if (sub === 'init') {
        const root = c.sh.cwd;
        if (own(repos, root) && c.fs.find(root + '/.git')) return c.print(`Reinicializado el repositorio Git existente en ${root}/.git/`);
        if (!c.fs.find(root + '/.git')) c.fs.mkdir(root + '/.git', c.user);
        repos[root] = { index: {}, commits: [] };
        return c.print(`Inicializado repositorio Git vacío en ${root}/.git/`);
      }
      const found = repoOf(c);
      if (!found) {
        c.code = 128;
        return c.fail('fatal: no es un repositorio git (ni ninguno de los directorios superiores): .git');
      }
      const { root, r } = found;
      const work = workTree(c, root);
      const head = headTree(r);
      const changed = (x, y) => Object.keys(Object.assign({}, x, y)).filter((k) => x[k] !== y[k]).sort(cmp);

      if (sub === 'status') {
        const staged = changed(head, r.index);
        const dirty = Object.keys(r.index).filter((k) => work[k] !== r.index[k]).sort(cmp);
        const untracked = Object.keys(work).filter((k) => !own(r.index, k)).sort(cmp);
        c.print('En la rama main');
        if (!r.commits.length) c.print('\nNo hay commits todavía');
        const label = (k, x, y) => (!own(x, k) ? 'nuevo archivo' : !own(y, k) ? 'borrado' : 'modificado');
        if (staged.length) c.print('\nCambios a ser confirmados:\n' + staged.map((k) => `\t${label(k, head, r.index)}:  ${k}`).join('\n'));
        if (dirty.length) c.print('\nCambios no rastreados para el commit:\n' + dirty.map((k) => `\t${own(work, k) ? 'modificado' : 'borrado'}:  ${k}`).join('\n'));
        if (untracked.length) c.print('\nArchivos sin seguimiento:\n  (usa «git add <archivo>» para incluirlos)\n' + untracked.map((k) => '\t' + k).join('\n'));
        if (!staged.length && !dirty.length && !untracked.length) c.print('nada para hacer commit, el árbol de trabajo está limpio');
      } else if (sub === 'add') {
        if (!args.length) return c.fail('Nada especificado, nada agregado.\nPrueba: git add archivo   o   git add .');
        for (const t of args) {
          if (t === '-A' || t === '--all') {
            r.index = Object.assign({}, work);
            continue;
          }
          const rel = relOf(c, root, t);
          if (rel === null) {
            c.fail(`fatal: ${t}: está fuera del repositorio`);
            continue;
          }
          const hits = Object.keys(work).filter((k) => rel === '' || k === rel || k.startsWith(rel + '/'));
          const gone = Object.keys(r.index).filter((k) => !own(work, k) && (rel === '' || k === rel || k.startsWith(rel + '/')));
          if (!hits.length && !gone.length) {
            c.fail(`fatal: la ruta especificada '${t}' no concordó con ningún archivo`);
            continue;
          }
          for (const k of hits) r.index[k] = work[k];
          for (const k of gone) delete r.index[k];
        }
      } else if (sub === 'commit') {
        let msg = null;
        let all = false;
        for (let i = 0; i < args.length; i++) {
          if (/^-\w*m$/.test(args[i])) {
            if (args[i].includes('a')) all = true;
            msg = args[++i];
          } else if (args[i] === '-a') all = true;
        }
        if (!msg) return c.fail('git commit: falta el mensaje. Ejemplo: git commit -m "Qué he cambiado"');
        if (all)
          for (const k of Object.keys(r.index)) {
            if (own(work, k)) r.index[k] = work[k];
            else delete r.index[k];
          }
        const diff = changed(head, r.index);
        if (!diff.length) {
          c.code = 1;
          return c.print('En la rama main\nnada para hacer commit' + (Object.keys(work).some((k) => work[k] !== r.index[k]) ? ' (hay cambios sin añadir: usa «git add»)' : ', el árbol de trabajo está limpio'));
        }
        const tree = Object.assign({}, r.index);
        const id = sha256(msg + r.commits.length + JSON.stringify(tree)).slice(0, 7);
        c.print(`[main ${r.commits.length ? '' : '(commit-raíz) '}${id}] ${msg}\n ${diff.length} archivo${diff.length > 1 ? 's cambiados' : ' cambiado'}`);
        r.commits.push({ id, msg, tree });
      } else if (sub === 'log') {
        if (!r.commits.length) {
          c.code = 128;
          return c.fail("fatal: tu rama actual 'main' no tiene ningún commit todavía");
        }
        const one = args.includes('--oneline');
        r.commits
          .slice()
          .reverse()
          .forEach((cm, i) => c.print(one ? `${cm.id} ${cm.msg}` : `${i ? '\n' : ''}commit ${cm.id}${i ? '' : ' (HEAD -> main)'}\nAuthor: ${USER} <${USER}@ubuntu>\n\n    ${cm.msg}`));
      } else if (sub === 'diff') {
        const only = args.filter((x) => x[0] !== '-').map((x) => relOf(c, root, x));
        for (const k of Object.keys(r.index).sort(cmp)) {
          if (work[k] === r.index[k] || (only.length && !only.includes(k))) continue;
          const oldL = lines(r.index[k]);
          const newL = lines(work[k] || '');
          c.print(`diff --git a/${k} b/${k}\n--- a/${k}\n+++ b/${k}`);
          for (const l of oldL) if (!newL.includes(l)) c.print('-' + l);
          for (const l of newL) if (!oldL.includes(l)) c.print('+' + l);
        }
      } else if (sub === 'restore' || sub === 'checkout') {
        const files = args.filter((x) => x !== '--');
        if (!files.length) return c.fail(`git ${sub}: indica qué archivo quieres recuperar. Ejemplo: git restore index.html`);
        for (const t of files) {
          const rel = relOf(c, root, t);
          if (rel === null || !own(r.index, rel)) {
            c.fail(`error: la ruta especificada '${t}' no concordó con ningún archivo conocido por git`);
            continue;
          }
          guard(c, `git: ${t}`, () => c.fs.write(root + '/' + rel, c.user, r.index[rel]));
        }
      } else if (sub === 'branch') c.print('* main');
      else c.fail(`git: «${sub}» no está en este simulador. Tienes: init, status, add, commit, log, diff, restore`);
    },
  });

  G.SHELL.util.sha256 = sha256;
  G.SHELL.util.b64enc = b64enc;
  G.SHELL.x4 = x4;
  G.SHELL.makeRepo = makeRepo;

  DOCS.push(
    ...[
      ['Guiones', 'if', 'Hace una cosa u otra según salga una orden. $? guarda el resultado de la última (0 = bien).', 'if [ -f notas.txt ]; then echo sí; else echo no; fi'],
      ['Huellas y códigos', 'sha256sum', 'Calcula la huella de un archivo. Con -c comprueba una lista de huellas.', 'sha256sum -c SHA256SUMS'],
      ['Huellas y códigos', 'base64', 'Convierte a texto «seguro» y al revés (-d). No es cifrado.', 'echo hola | base64'],
      ['Permisos', 'stat', 'La ficha completa de un archivo: permisos en número, dueño, fecha.', 'stat notas.txt'],
      ['Red', 'nmap', 'Escanea qué puertos tiene abiertos un equipo (hay que instalarlo). Solo en equipos tuyos.', 'nmap -sV servidor'],
      ['Red', 'nc', 'Prueba si un puerto concreto responde.', 'nc -zv servidor 22'],
      ['Red', 'nslookup', 'Pregunta al DNS qué dirección tiene un nombre.', 'nslookup ubuntu.com'],
      ['Git', 'git', 'Guarda versiones de tu trabajo: init, status, add, commit, log, diff, restore (hay que instalarlo).', 'git commit -m "Primera versión"'],
    ].map(([cat, cmd, desc, ex]) => ({ cat, cmd, desc, ex }))
  );
})(typeof window !== 'undefined' ? window : globalThis);
