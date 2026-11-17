/* Órdenes del nivel 3: texto (tr, sed, awk), condiciones, búsqueda a fondo, servicios,
   cortafuegos, SSH y tareas programadas. Se añaden a las de js/shell.js sin cambiarlas. */
(function (G) {
  'use strict';

  const { FsError, fail, HOME, USER } = G.VFS;
  const { COMMANDS, DOCS } = G.SHELL;
  const { opts, guard, inputs, lines, bytes, base, cmp, escRe, mark } = G.SHELL.util;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /* Estado propio de este nivel, creado la primera vez que hace falta. */
  function st(sh) {
    if (!sh.x3)
      sh.x3 = {
        services: {
          ssh: { on: true, en: true, desc: 'OpenBSD Secure Shell server' },
          cron: { on: true, en: true, desc: 'Regular background program processing daemon' },
          cups: { on: true, en: true, desc: 'CUPS Scheduler (impresoras)' },
          bluetooth: { on: false, en: false, desc: 'Bluetooth service' },
        },
        journal: [],
        fw: { on: false, policy: 'allow', rules: [] },
        remote: { authorized: false, files: ['copias', 'notas-servidor.txt', 'web'] },
      };
    return sh.x3;
  }

  const CRON = '/var/spool/cron/' + USER;
  const REMOTE = { host: 'servidor', ip: '192.168.1.50', user: 'pix' };

  /* ---------- texto ---------- */

  function expandSet(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i + 1] === '-' && s[i + 2]) {
        for (let k = s.charCodeAt(i); k <= s.charCodeAt(i + 2); k++) out += String.fromCharCode(k);
        i += 2;
      } else if (s[i] === '\\' && s[i + 1] === 'n') {
        out += '\n';
        i++;
      } else out += s[i];
    }
    return out;
  }

  function splitTop(s) {
    const out = [];
    let cur = '';
    let q = false;
    for (const ch of s) {
      if (ch === '"') q = !q;
      if (ch === ',' && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  /* ---------- condiciones ---------- */

  function testExpr(a, c) {
    if (a[0] === '!') return !testExpr(a.slice(1), c);
    if (a.length === 1) return a[0] !== '';
    if (a.length === 2) {
      const [op, v] = a;
      const n = c.fs.find(c.path(v), c.user);
      switch (op) {
        case '-e':
          return !!n;
        case '-f':
          return !!n && n.type === 'file';
        case '-d':
          return !!n && n.type === 'dir';
        case '-r':
          return !!n && c.fs.can(n, c.user, 4);
        case '-w':
          return !!n && c.fs.can(n, c.user, 2);
        case '-x':
          return !!n && c.fs.can(n, c.user, 1);
        case '-z':
          return v === '';
        case '-n':
          return v !== '';
      }
    }
    if (a.length === 3) {
      const [x, op, y] = a;
      switch (op) {
        case '=':
        case '==':
          return x === y;
        case '!=':
          return x !== y;
        case '-eq':
          return +x === +y;
        case '-ne':
          return +x !== +y;
        case '-gt':
          return +x > +y;
        case '-lt':
          return +x < +y;
        case '-ge':
          return +x >= +y;
        case '-le':
          return +x <= +y;
      }
    }
    throw new Error('expr');
  }

  function runTest(a, c) {
    try {
      c.code = testExpr(a, c) ? 0 : 1;
    } catch (e) {
      if (e instanceof FsError) throw e;
      c.fail('bash: [: condición no válida. Ejemplos: [ -f archivo ]   [ -d carpeta ]   [ "$a" = "$b" ]');
      c.code = 2;
    }
  }

  /* ---------- búsqueda y tamaños ---------- */

  function walkFiles(c, shown, p, out) {
    const n = c.fs.node(p, c.user);
    if (n.type !== 'dir') return out.push([shown, p]);
    if (!c.fs.can(n, c.user, 4) || !c.fs.can(n, c.user, 1)) return c.fail(`grep: ${shown}: Permiso denegado`);
    for (const k of Object.keys(n.children).sort(cmp)) walkFiles(c, shown.replace(/\/$/, '') + '/' + k, (p === '/' ? '' : p) + '/' + k, out);
  }

  const kb = (n) => (n.type === 'dir' ? 4 + Object.values(n.children).reduce((t, ch) => t + kb(ch), 0) : Math.max(4, Math.ceil((n.size !== undefined ? n.size : bytes(n.content)) / 4096) * 4));
  const humanK = (k) => (k < 1024 ? k + 'K' : (k / 1024).toFixed(1).replace('.', ',') + 'M');

  /* ---------- red ---------- */

  function parseTarget(t) {
    const m = /^(?:([\w.-]+)@)?([\w.-]+)$/.exec(t || '');
    return m ? { user: m[1] || USER, host: m[2] } : null;
  }
  const knownHost = (h) => h === REMOTE.host || h === REMOTE.ip;

  function remoteRun(cmd, c) {
    const files = st(c.sh).remote.files;
    switch (cmd[0]) {
      case 'hostname':
        return c.print(REMOTE.host);
      case 'whoami':
        return c.print(REMOTE.user);
      case 'pwd':
        return c.print('/home/' + REMOTE.user);
      case 'ls':
        return c.print(files.slice().sort(cmp).join('  '));
      case 'uptime':
        return c.print(' 10:24:51 up 41 days,  3:02,  1 user,  load average: 0,08, 0,05, 0,01');
      case 'cat':
        if (st(c.sh).remote.content && own(st(c.sh).remote.content, cmd[1])) return c.print(st(c.sh).remote.content[cmd[1]].replace(/\n$/, ''));
        if (cmd[1] === 'notas-servidor.txt') return c.print('Recuerda: copia de seguridad cada noche a las 03:00.');
        return c.fail(`cat: ${cmd[1] || ''}: No existe el archivo o el directorio`);
      default:
        return c.fail(`bash: ${cmd[0]}: esta orden no está disponible en el servidor simulado (prueba hostname, whoami, ls, uptime)`);
    }
  }

  const grep0 = COMMANDS.grep;

  Object.assign(COMMANDS, {
    tr(a, c) {
      const del = a[0] === '-d';
      const sets = a.filter((x) => x !== '-d');
      if (!sets.length || (!del && sets.length < 2)) return c.fail('Uso: orden | tr a-z A-Z   (cambia letras)   |   orden | tr -d ","   (las quita)');
      const s1 = expandSet(sets[0]);
      const s2 = del ? '' : expandSet(sets[1]);
      let out = '';
      for (const ch of c.stdin || '') {
        const i = s1.indexOf(ch);
        out += i < 0 ? ch : del ? '' : s2[Math.min(i, s2.length - 1)];
      }
      c.out += out;
    },

    sed(a, c) {
      const inplace = a.includes('-i');
      const rest = a.filter((x) => !/^-[iEe]$/.test(x));
      const prog = rest.shift();
      const m = prog && /^s(.)((?:(?!\1).)*)\1((?:(?!\1).)*)\1([gi]*)$/.exec(prog);
      if (!m) return c.fail("sed: este simulador entiende sustituciones. Ejemplo: sed 's/busca/pon/g' archivo");
      const flags = (m[4].includes('g') ? 'g' : '') + (m[4].includes('i') ? 'i' : '');
      let re;
      try {
        re = new RegExp(m[2].replace(/\\([()])/g, '$1'), flags);
      } catch (e) {
        re = new RegExp(escRe(m[2]), flags);
      }
      const rep = m[3].replace(/\$/g, '$$$$').replace(/\\(\d)/g, '$$$1').replace(/&/g, '$$&');
      if (inplace && !rest.length) return c.fail('sed: con -i hay que indicar el archivo que se va a cambiar');
      for (const [name, text] of inputs(c, 'sed', rest)) {
        const done = lines(text).map((l) => l.replace(re, rep)).join('\n') + (text ? '\n' : '');
        if (inplace) guard(c, `sed: no se puede escribir ${name}`, () => c.fs.write(c.path(name), c.user, done));
        else c.out += done;
      }
    },

    awk(a, c) {
      let sep = null;
      const rest = [];
      for (let i = 0; i < a.length; i++) {
        if (a[i] === '-F') sep = a[++i];
        else if (a[i].startsWith('-F')) sep = a[i].slice(2);
        else rest.push(a[i]);
      }
      const prog = rest.shift();
      const m = prog && /^\s*\{\s*print\s*(.*?)\s*;?\s*\}\s*$/.exec(prog);
      if (!m) return c.fail("awk: este simulador entiende awk '{print $1}' (con -F para el separador). Ejemplo: awk -F';' '{print $2, $1}' archivo");
      const items = m[1] ? splitTop(m[1]) : ['$0'];
      for (const [, text] of inputs(c, 'awk', rest))
        lines(text).forEach((l, idx) => {
          const f = sep ? l.split(sep) : l.trim().split(/\s+/).filter(Boolean);
          const val = (t) => (t[0] === '$' ? (+t.slice(1) === 0 ? l : f[+t.slice(1) - 1] || '') : t === 'NR' ? String(idx + 1) : t === 'NF' ? String(f.length) : t.slice(1, -1));
          c.print(items.map((it) => (it.match(/\$\d+|"[^"]*"|NR|NF/g) || []).map(val).join('')).join(' '));
        });
    },

    '['(a, c) {
      if (a[a.length - 1] !== ']') {
        c.fail('bash: [: falta el «]» de cierre (con espacios alrededor)');
        c.code = 2;
        return;
      }
      runTest(a.slice(0, -1), c);
    },

    test(a, c) {
      runTest(a, c);
    },

    true() {},

    false(a, c) {
      c.code = 1;
    },

    for(a, c) {
      c.fail('bash: en este simulador el bucle va en una sola línea:\nfor f in *.txt; do echo $f; done');
    },

    grep(a, c) {
      const { flags, rest } = opts(a);
      const rec = flags.has('r') || flags.has('R');
      if (!rec && !flags.has('l')) return grep0(a, c);
      if (!rest.length) return c.fail('Modo de empleo: grep -r PATRÓN [CARPETA]');
      const pat = rest.shift();
      const f = flags.has('i') ? 'i' : '';
      let re;
      try {
        re = new RegExp(pat, f);
      } catch (e) {
        re = new RegExp(escRe(pat), f);
      }
      const reAll = new RegExp(re.source, f + 'g');
      const files = [];
      for (const t of rest.length ? rest : rec ? ['.'] : [])
        guard(c, `grep: ${t}`, () => {
          const n = c.fs.node(c.path(t), c.user);
          if (n.type === 'dir' && !rec) return c.fail(`grep: ${t}: Es un directorio`);
          walkFiles(c, t, c.path(t), files);
        });
      let found = false;
      for (const [shown, p] of files) {
        let text;
        try {
          text = c.fs.read(p, c.user);
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          c.fail(`grep: ${shown}: ${e.message}`);
          continue;
        }
        const hits = [];
        lines(text).forEach((l, i) => {
          if (re.test(l) !== flags.has('v')) hits.push([i + 1, l]);
        });
        if (!hits.length) continue;
        found = true;
        if (flags.has('l')) c.print(shown);
        else if (flags.has('c')) c.print(`${shown}:${hits.length}`);
        else
          for (const [n, l] of hits)
            c.print(shown + ':' + (flags.has('n') ? n + ':' : '') + (c.tty && !flags.has('v') ? l.replace(reAll, (x) => (x ? mark('M', x) : x)) : l));
      }
      if (!found) c.code = 1;
    },

    du(a, c) {
      const { flags, rest } = opts(a);
      const show = (k, name) => c.print((flags.has('h') ? humanK(k) : String(k)) + '\t' + name);
      for (const t of rest.length ? rest : ['.'])
        guard(c, `du: no se puede acceder a '${t}'`, () => {
          const walk = (shown, n) => {
            if (n.type === 'dir' && !(c.fs.can(n, c.user, 4) && c.fs.can(n, c.user, 1))) {
              c.fail(`du: no se puede leer el directorio '${shown}': Permiso denegado`);
              return 4;
            }
            if (n.type === 'dir' && !flags.has('s'))
              for (const k of Object.keys(n.children).sort(cmp)) if (n.children[k].type === 'dir') walk(shown.replace(/\/$/, '') + '/' + k, n.children[k]);
            if (n.type === 'dir' || shown === t) show(kb(n), shown);
          };
          walk(t, c.fs.node(c.path(t), c.user));
        });
    },

    /* ---------- servicios ---------- */

    systemctl(a, c) {
      const s = st(c.sh);
      const act = a[0];
      const name = (a.find((x, i) => i > 0 && x[0] !== '-') || '').replace(/\.service$/, '');
      if (!act || act === 'list-units') {
        c.print('  UNIT               LOAD   ACTIVE   SUB      DESCRIPTION');
        for (const k of Object.keys(s.services))
          c.print(`  ${(k + '.service').padEnd(18)} loaded ${s.services[k].on ? 'active   running' : 'inactive dead   '}  ${s.services[k].desc}`);
        return;
      }
      if (!['status', 'start', 'stop', 'restart', 'enable', 'disable', 'is-active', 'is-enabled'].includes(act))
        return c.fail(`systemctl: no conozco «${act}». Prueba: status, start, stop, restart, enable, disable`);
      if (!name) return c.fail('systemctl: falta el nombre del servicio. Ejemplo: systemctl status ssh');
      const sv = s.services[name];
      if (!sv || !own(s.services, name)) return c.fail(`Unit ${name}.service could not be found.`);
      if (act === 'status') {
        c.print(
          `${sv.on ? '●' : '○'} ${name}.service - ${sv.desc}\n` +
            `     Loaded: loaded (/usr/lib/systemd/system/${name}.service; ${sv.en ? 'enabled' : 'disabled'})\n` +
            `     Active: ${sv.on ? 'active (running)' : 'inactive (dead)'}`
        );
        if (!sv.on) c.code = 3;
        return;
      }
      if (act === 'is-active') {
        c.print(sv.on ? 'active' : 'inactive');
        if (!sv.on) c.code = 3;
        return;
      }
      if (act === 'is-enabled') {
        c.print(sv.en ? 'enabled' : 'disabled');
        if (!sv.en) c.code = 1;
        return;
      }
      if (c.user !== 'root') return c.fail(`Failed to ${act} ${name}.service: Access denied\n(Cambiar un servicio es cosa del administrador: usa sudo)`);
      if (act === 'enable' || act === 'disable') {
        sv.en = act === 'enable';
        c.print(`${sv.en ? 'Created symlink' : 'Removed'} /etc/systemd/system/multi-user.target.wants/${name}.service`);
        return;
      }
      sv.on = act !== 'stop';
      s.journal.push([name, `systemd[1]: ${act === 'stop' ? 'Stopped' : act === 'start' ? 'Started' : 'Restarted'} ${name}.service - ${sv.desc}.`]);
    },

    journalctl(a, c) {
      const s = st(c.sh);
      let unit = null;
      let n = 10;
      for (let i = 0; i < a.length; i++) {
        if (a[i] === '-u') unit = (a[++i] || '').replace(/\.service$/, '');
        else if (a[i] === '-n') n = parseInt(a[++i], 10) || 10;
      }
      const baseLog = [
        ['ssh', 'sshd[1210]: Server listening on 0.0.0.0 port 22.'],
        ['cron', 'cron[998]: (CRON) INFO (Running @reboot jobs)'],
        ['cups', 'cupsd[901]: Printer sharing is off.'],
        ['ssh', 'sshd[1543]: Accepted password for estudiante from 192.168.1.20 port 51122 ssh2'],
        ['ssh', 'sshd[1602]: Failed password for invalid user admin from 203.0.113.7 port 40022 ssh2'],
        ['ssh', 'sshd[1602]: Failed password for invalid user admin from 203.0.113.7 port 40022 ssh2'],
        ['cron', 'CRON[2140]: (root) CMD (run-parts /etc/cron.hourly)'],
      ];
      const all = baseLog.concat(s.journal).filter((e) => !unit || e[0] === unit);
      if (!all.length) return c.print('-- No entries --');
      all.slice(-n).forEach((e, i) => c.print(`nov 15 10:${String(10 + i * 2).padStart(2, '0')}:07 ubuntu ${e[1]}`));
    },

    /* ---------- cortafuegos ---------- */

    ufw(a, c) {
      const f = st(c.sh).fw;
      if (c.user !== 'root') return c.fail('ERROR: Necesita ser root para ejecutar este guion');
      const SERV = { ssh: '22/tcp', http: '80/tcp', https: '443/tcp' };
      const sub = a[0];
      const isIp = (x) => /^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(x || '');
      const parseRule = (act, args) => {
        if (args[0] === 'from') return isIp(args[1]) ? { act, to: 'Anywhere', from: args[1] } : null;
        const to = SERV[args[0]] || args[0];
        return /^\d+(\/(tcp|udp))?$/.test(to || '') ? { act, to, from: 'Anywhere' } : null;
      };
      const same = (x, y) => x.act === y.act && x.to === y.to && x.from === y.from;
      if (sub === 'status') {
        if (!f.on) return c.print('Estado: inactivo');
        c.print('Estado: activo');
        if (a[1] === 'verbose') c.print(`Predeterminado: ${f.policy} (entrantes), allow (salientes)`);
        if (!f.rules.length) return;
        const num = a[1] === 'numbered';
        const pad = num ? '     ' : '';
        c.print(`\n${pad}Hasta                      Acción      Desde\n${pad}-----                      ------      -----`);
        f.rules.forEach((r, i) => c.print((num ? `[${String(i + 1).padStart(2)}] ` : '') + r.to.padEnd(27) + (r.act === 'allow' ? 'ALLOW IN' : 'DENY IN').padEnd(12) + r.from));
      } else if (sub === 'enable') {
        f.on = true;
        c.print('El cortafuegos está activo y habilitado en el arranque del sistema');
      } else if (sub === 'disable') {
        f.on = false;
        c.print('El cortafuegos está detenido y deshabilitado en el arranque del sistema');
      } else if (sub === 'reset') {
        f.on = false;
        f.rules = [];
        f.policy = 'allow';
        c.print('Reglas borradas. El cortafuegos queda inactivo.');
      } else if (sub === 'default') {
        if (!['allow', 'deny'].includes(a[1]) || (a[2] && a[2] !== 'incoming')) return c.fail('Uso: ufw default deny incoming');
        f.policy = a[1];
        c.print(`La política incoming predeterminada cambió a «${a[1]}»\n(asegúrese de actualizar sus reglas consecuentemente)`);
      } else if (sub === 'allow' || sub === 'deny') {
        const r = parseRule(sub, a.slice(1));
        if (!r) return c.fail('ERROR: regla no válida. Ejemplos: ufw allow ssh   ufw allow 80/tcp   ufw deny from 203.0.113.7');
        if (f.rules.some((x) => same(x, r))) return c.print('Omitiendo adición de regla ya existente');
        f.rules.push(r);
        c.print(f.on ? 'Regla añadida' : 'Reglas actualizadas');
      } else if (sub === 'delete') {
        let i = -1;
        if (/^\d+$/.test(a[1] || '')) i = +a[1] - 1;
        else {
          const r = parseRule(a[1], a.slice(2));
          if (r) i = f.rules.findIndex((x) => same(x, r));
        }
        if (i < 0 || i >= f.rules.length) return c.fail('ERROR: No se encontró ninguna regla que coincida');
        f.rules.splice(i, 1);
        c.print('Regla eliminada');
      } else c.fail('Uso: ufw status [numbered] | enable | disable | default deny incoming | allow X | deny X | delete N');
    },

    /* ---------- SSH ---------- */

    'ssh-keygen'(a, c) {
      const dir = HOME + '/.ssh';
      if (!c.fs.find(dir)) {
        c.fs.mkdir(dir, c.user);
        c.fs.node(dir).mode = 0o700;
      }
      if (c.fs.find(dir + '/id_ed25519')) return c.fail('ssh-keygen: ya tienes una clave en ~/.ssh/id_ed25519. No la sobrescribo.');
      c.fs.write(dir + '/id_ed25519', c.user, '-----BEGIN OPENSSH PRIVATE KEY-----\n(clave privada simulada: la de verdad no se enseña jamás a nadie)\n-----END OPENSSH PRIVATE KEY-----\n');
      c.fs.node(dir + '/id_ed25519').mode = 0o600;
      c.fs.write(dir + '/id_ed25519.pub', c.user, `ssh-ed25519 AAAA-clave-publica-simulada-de-ejemplo ${USER}@ubuntu\n`);
      c.fs.node(dir + '/id_ed25519.pub').mode = 0o644;
      c.print(
        'Generating public/private ed25519 key pair.\n' +
          `Your identification has been saved in ${dir}/id_ed25519\n` +
          `Your public key has been saved in ${dir}/id_ed25519.pub\n` +
          "The key's randomart image is:\n+--[ED25519 256]--+\n|      .o+*=.     |\n|     . =o+..     |\n|      o.B = .    |\n|       S.* o     |\n|        .o.      |\n+----[SHA256]-----+"
      );
    },

    'ssh-copy-id'(a, c) {
      const t = parseTarget(a.find((x) => x[0] !== '-'));
      if (!t) return c.fail('Uso: ssh-copy-id usuario@equipo');
      if (!c.fs.find(HOME + '/.ssh/id_ed25519.pub')) return c.fail('/usr/bin/ssh-copy-id: ERROR: No identities found\n(Primero crea tu par de claves con ssh-keygen)');
      if (!knownHost(t.host)) return c.fail(`ssh: Could not resolve hostname ${t.host}: Name or service not known`);
      if (t.user !== REMOTE.user) return c.fail(`${t.user}@${t.host}: Permission denied (publickey,password).`);
      st(c.sh).remote.authorized = true;
      c.print(
        `${t.user}@${t.host}'s password: ********\n\nNumber of key(s) added: 1\n\n` +
          `Now try logging into the machine, with:   "ssh '${t.user}@${t.host}'"\nand check to make sure that only the key(s) you wanted were added.`
      );
    },

    ssh(a, c) {
      const i = a.findIndex((x) => x[0] !== '-');
      const t = parseTarget(a[i]);
      if (i < 0 || !t) return c.fail('Uso: ssh usuario@equipo [orden]');
      if (!knownHost(t.host)) return c.fail(`ssh: Could not resolve hostname ${t.host}: Name or service not known`);
      if (t.user !== REMOTE.user) return c.fail(`${t.user}@${t.host}: Permission denied (publickey,password).`);
      if (!st(c.sh).remote.authorized) c.print(`${t.user}@${t.host}'s password: ********`);
      const cmd = a.slice(i + 1);
      if (cmd.length) return remoteRun(cmd, c);
      c.print(
        `Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0-45-generic x86_64)\n\n${t.user}@${REMOTE.host}:~$ exit\nConnection to ${t.host} closed.\n` +
          `(En este simulador la sesión entra y sale. Para hacer algo en el servidor, pon la orden detrás: ssh ${t.user}@${t.host} ls)`
      );
    },

    scp(a, c) {
      const rest = a.filter((x) => x[0] !== '-');
      const m = /^([\w.-]+)@([\w.-]+):(.*)$/.exec(rest[1] || '');
      if (rest.length < 2 || !m) return c.fail('Uso: scp archivo usuario@equipo:');
      if (!knownHost(m[2])) return c.fail(`ssh: Could not resolve hostname ${m[2]}: Name or service not known`);
      if (m[1] !== REMOTE.user) return c.fail(`${m[1]}@${m[2]}: Permission denied (publickey,password).`);
      const text = c.fs.read(c.path(rest[0]), c.user);
      const r = st(c.sh).remote;
      if (!r.authorized) c.print(`${m[1]}@${m[2]}'s password: ********`);
      const name = base(c.path(rest[0]));
      if (!r.files.includes(name)) r.files.push(name);
      c.print(`${name.padEnd(40)} 100% ${String(bytes(text)).padStart(5)}     1.2KB/s   00:00`);
    },

    /* ---------- tareas programadas ---------- */

    crontab(a, c) {
      const cur = c.fs.find(CRON);
      const install = (text) => {
        const bad = lines(text).findIndex((l) => {
          const t = l.trim();
          if (!t || t[0] === '#') return false;
          const f = t.split(/\s+/);
          return f.length < 6 || !f.slice(0, 5).every((x) => /^[\d*/,-]+$/.test(x));
        });
        if (bad >= 0) return c.fail(`crontab: la línea ${bad + 1} no vale: hacen falta 5 campos de tiempo y una orden.\nEjemplo: 0 8 * * * /home/${USER}/copia.sh`);
        if (!c.fs.find('/var/spool')) c.fs.mkdir('/var/spool', 'root');
        if (!c.fs.find('/var/spool/cron')) c.fs.mkdir('/var/spool/cron', 'root');
        c.fs.write(CRON, 'root', text && !text.endsWith('\n') ? text + '\n' : text);
      };
      if (a[0] === '-l') {
        if (!cur || !cur.content.trim()) return c.fail(`no crontab for ${USER}`);
        c.out += cur.content;
      } else if (a[0] === '-r') {
        if (!cur) return c.fail(`no crontab for ${USER}`);
        c.fs.remove(CRON, 'root');
      } else if (a[0] === '-e') {
        install(cur ? cur.content : '# minuto hora día mes día-de-la-semana  orden\n');
        c.sh.editor = { path: CRON, name: 'crontab', content: c.fs.read(CRON, 'root'), user: 'root' };
      } else if (a[0] === '-' || (!a.length && c.stdin !== null)) install(c.stdin || '');
      else if (a[0]) install(c.fs.read(c.path(a[0]), c.user));
      else c.fail('Uso: crontab -l (ver) | crontab -e (editar) | crontab -r (borrar) | orden | crontab - (instalar)');
    },
  });

  DOCS.push(
    ...[
      ['Transformar texto', 'tr', 'Cambia o quita letras de lo que le llega por la tubería.', 'cat notas.txt | tr a-z A-Z'],
      ['Transformar texto', 'sed', 'Sustituye texto. Con g, todas las veces; con -i, guarda el cambio en el archivo.', "sed 's/viejo/nuevo/g' archivo.txt"],
      ['Transformar texto', 'awk', 'Trabaja por columnas: $1 es la primera. -F indica el separador.', "awk -F: '{print $1}' /etc/passwd"],
      ['Guiones', 'for', 'Repite una orden para cada elemento de una lista.', 'for f in *.txt; do echo $f; done'],
      ['Guiones', 'test', 'Comprueba una condición; también se escribe [ ... ]. -f archivo, -d carpeta.', '[ -d copias ] || mkdir copias'],
      ['Buscar y filtrar', 'du', 'Cuánto ocupa cada carpeta. -s solo el total, -h legible.', 'du -sh *'],
      ['Servicios', 'systemctl', 'Controla los servicios del sistema: status, start, stop, restart, enable, disable.', 'systemctl status ssh'],
      ['Servicios', 'journalctl', 'El registro del sistema. -u filtra por servicio, -n limita las líneas.', 'journalctl -u ssh -n 5'],
      ['Seguridad', 'ufw', 'El cortafuegos de Ubuntu: decide qué conexiones entran (necesita sudo).', 'sudo ufw allow ssh'],
      ['Seguridad', 'ssh-keygen', 'Crea tu par de claves: una privada (secreta) y una pública.', 'ssh-keygen'],
      ['Seguridad', 'ssh-copy-id', 'Instala tu clave pública en otro equipo para entrar sin contraseña.', 'ssh-copy-id pix@servidor'],
      ['Seguridad', 'ssh', 'Abre una terminal en otro equipo, o ejecuta allí una orden.', 'ssh pix@servidor hostname'],
      ['Seguridad', 'scp', 'Copia archivos a otro equipo por SSH.', 'scp notas.txt pix@servidor:'],
      ['Servicios', 'crontab', 'Tus tareas programadas: -l las lista, -e las edita, -r las borra.', 'crontab -l'],
    ].map(([cat, cmd, desc, ex]) => ({ cat, cmd, desc, ex }))
  );
})(typeof window !== 'undefined' ? window : globalThis);
