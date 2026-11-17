/* Motor del laboratorio de Red Team: una máquina simulada con fallos de configuración reales
   (sudo mal puesto, binarios SUID, cron con scripts escribibles, capabilities, PATH, /etc/passwd),
   y la lógica que hace que, al aplicar la técnica correcta, de verdad cambies de usuario o te hagas root.
   Todo es simulado: no hay exploits que funcionen fuera de esta página. */
(function (G) {
  'use strict';

  const { FsError } = G.VFS;
  const { Shell, COMMANDS, DOCS, PACKAGES } = G.SHELL;
  const { lines, base } = G.SHELL.util;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  PACKAGES.python3 = 'intérprete de Python';

  /* ---------- construir la máquina ---------- */

  /* Directorios de sistema mínimos para que la caja parezca real. */
  function skeleton(fs) {
    for (const d of ['/etc', '/bin', '/usr', '/usr/bin', '/usr/local', '/usr/local/bin', '/sbin', '/var', '/var/www', '/var/log', '/opt', '/tmp', '/home', '/root', '/dev']) if (!fs.find(d)) fs.mkdir(d, 'root');
    fs.node('/tmp').mode = 0o1777;
    fs.node('/root').mode = 0o700;
  }
  function putFile(fs, path, content, owner, mode) {
    let cur = '';
    for (const s of fs.split(path)[0].split('/').filter(Boolean)) {
      cur += '/' + s;
      if (!fs.find(cur)) {
        fs.mkdir(cur, 'root');
        fs.node(cur).owner = fs.node(cur).group = owner || 'root';
      }
    }
    if (fs.find(path)) fs.remove(path, 'root');
    fs.write(path, 'root', content);
    const n = fs.node(path);
    n.owner = n.group = owner || 'root';
    if (mode !== undefined) n.mode = mode;
    return n;
  }
  const bin = (fs, path, mode) => putFile(fs, path, '\x7fELF (binario del sistema)\n', 'root', mode === undefined ? 0o755 : mode);

  const PASSWD_BASE = [
    'root:x:0:0:root:/root:/bin/bash',
    'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
    'bin:x:2:2:bin:/bin:/usr/sbin/nologin',
    'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin',
    'sshd:x:104:65534::/run/sshd:/usr/sbin/nologin',
  ];

  /* Monta la máquina según un guion. Deja la sesión como el usuario `foothold`. */
  function buildBox(sh, fs, spec) {
    spec = spec || {};
    /* vaciar el home de prácticas de Linux Games para no confundir */
    for (const k of Object.keys(fs.root.children)) if (!['etc', 'bin', 'usr', 'var', 'opt', 'tmp', 'home', 'root', 'sbin', 'dev', 'proc'].includes(k)) delete fs.root.children[k];
    if (fs.find('/home')) fs.node('/home').children = {};
    skeleton(fs);
    for (const b of ['bash', 'sh', 'cat', 'ls', 'id', 'find', 'grep', 'sudo', 'su', 'ping', 'cp', 'mv', 'chmod', 'python3', 'vi', 'vim', 'awk', 'less', 'nano', 'tar', 'env']) bin(fs, '/usr/bin/' + b);

    const host = spec.host || 'la-fragua';
    const users = {
      root: { uid: 0, home: '/root', pass: spec.rootPass || null, groups: [] },
      'www-data': { uid: 33, home: '/var/www', pass: null, groups: ['www-data'], nologin: true },
    };
    const passwd = PASSWD_BASE.slice();
    for (const u of spec.users || []) {
      users[u.name] = { uid: u.uid, home: u.home || '/home/' + u.name, pass: u.pass || null, groups: u.groups || [] };
      passwd.push(`${u.name}:x:${u.uid}:${u.uid}:${u.name}:${u.home || '/home/' + u.name}:${u.shell || '/bin/bash'}`);
      if (!fs.find(users[u.name].home)) {
        fs.mkdir(users[u.name].home, 'root');
        Object.assign(fs.node(users[u.name].home), { owner: u.name, group: u.name, mode: u.homeMode === undefined ? 0o750 : u.homeMode });
      }
    }
    putFile(fs, '/etc/passwd', passwd.join('\n') + '\n', 'root', spec.passwdMode === undefined ? 0o644 : spec.passwdMode);
    putFile(fs, '/etc/shadow', 'root:$6$simulado$xxx:19800:0:99999:7:::\n', 'root', 0o640);
    putFile(fs, '/etc/hostname', host + '\n', 'root');
    putFile(fs, '/etc/os-release', 'PRETTY_NAME="Ubuntu 22.04.3 LTS"\nVERSION_ID="22.04"\nID=ubuntu\n', 'root');
    putFile(fs, '/etc/crontab', '# m h dom mon dow user\tcommand\n17 *\t* * *\troot\tcd / && run-parts --report /etc/cron.hourly\n', 'root');

    sh.rt = {
      host,
      users,
      me: spec.foothold || 'www-data',
      owned: new Set([spec.foothold || 'www-data']),
      sudoers: spec.sudoers || {}, // { usuario: [ {bin, runas, nopasswd, args} ] }
      suid: new Set(spec.suid || []), // rutas de binarios SUID root presentes
      caps: spec.caps || {}, // { ruta: 'cap_setuid+ep' }
      cron: spec.cron ? Object.assign({}, spec.cron) : null, // { script, owner, every }
      cronFired: false,
      pathTrap: spec.pathTrap || null, // { bin, needs:'cat'|'tar', runas:'root' }
      procs: spec.procs || [],
      suPrompt: null,
      log: [],
    };
    /* marca los binarios SUID en el sistema de archivos (bit setuid) */
    for (const p of sh.rt.suid) {
      if (!fs.find(p)) bin(fs, p);
      fs.node(p).mode = 0o4755;
    }
    for (const p of Object.keys(sh.rt.caps)) if (!fs.find(p)) bin(fs, p);
    for (const f of spec.files || []) putFile(fs, f.path, f.content, f.owner || 'root', f.mode);
    if (sh.rt.cron && fs.find(sh.rt.cron.script)) sh.rt.cron.original = fs.find(sh.rt.cron.script).content;

    sh.user = sh.rt.me;
    sh.cwd = users[sh.rt.me].home;
    sh.env.HOME = users[sh.rt.me].home;
    sh.env.USER = sh.rt.me;
    sh.env.PATH = '/usr/local/bin:/usr/bin:/bin';
    sh.repl = null;
    return sh.rt;
  }

  const rt = (sh) => sh.rt;
  const homeOf = (sh, u) => (sh.rt.users[u] ? sh.rt.users[u].home : '/home/' + u);

  /* ---------- resultados ---------- */

  function result(parts) {
    const r = { parts, clear: false, editor: null };
    r.out = parts.filter((p) => p[0] === 'out').map((p) => p[1]).join('');
    r.err = parts.filter((p) => p[0] === 'err').map((p) => p[1]).join('');
    r.code = parts.some((p) => p[0] === 'err') ? 1 : 0;
    return r;
  }
  const line = (s) => ['out', s + '\n'];
  const errline = (s) => ['err', s + '\n'];

  /* Cambia de usuario de verdad: a partir de aquí la terminal actúa como él. */
  function become(sh, user, parts, note) {
    sh.user = user;
    sh.cwd = sh.rt.users[user] ? sh.rt.users[user].home : sh.cwd;
    sh.env.HOME = homeOf(sh, user);
    sh.env.USER = user;
    sh.rt.owned.add(user);
    if (note !== false) parts.push(line(user === 'root' ? '# id' : '$ id'), line(idString(sh, user)), note ? line(note) : ['out', '']);
    return parts;
  }

  function idString(sh, user) {
    const u = sh.rt.users[user];
    if (!u) return `uid=1000(${user}) gid=1000(${user}) grupos=1000(${user})`;
    const extra = (u.groups || []).filter((g) => g !== user).map((g) => `,${groupId(g)}(${g})`).join('');
    return `uid=${u.uid}(${user}) gid=${u.uid}(${user}) grupos=${u.uid}(${user})${extra}`;
  }
  const groupId = (g) => ({ sudo: 27, adm: 4, 'www-data': 33, docker: 998, lxd: 110 }[g] || 1001);

  /* Ejecuta un texto de payload como root (lo usa el cron). */
  function runAsRoot(sh, text) {
    for (const l of lines(text)) {
      const t = l.trim();
      if (!t || t[0] === '#') continue;
      try {
        sh.execLine(t, 'root');
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
      }
    }
  }

  /* ---------- su ---------- */

  function suAuth(sh, target, password) {
    const parts = [];
    const u = sh.rt.users[target];
    /* una línea uid=0 en /etc/passwd convierte a cualquiera en root */
    const passwdRow = passwdEntry(sh, target);
    const isRoot = u ? u.uid === 0 : passwdRow && passwdRow.uid === 0;
    const realPass = u ? u.pass : passwdRow ? passwdRow.pass : null;
    /* contraseña correcta, o cuenta sin contraseña que tú mismo creaste en /etc/passwd */
    const ok = (realPass !== null && password === realPass) || (passwdRow && passwdRow.pass === '' && (password === '' || password === undefined)) || (u && u.pass === '' && !password);
    if (!u && !passwdRow) {
      parts.push(errline(`su: el usuario ${target} no existe`));
      return result(parts);
    }
    if (!ok) {
      parts.push(errline('su: Fallo de autenticación'));
      return result(parts);
    }
    become(sh, isRoot ? 'root' : target, parts, isRoot && target !== 'root' ? '(la cuenta ' + target + ' tiene UID 0: eres root)' : null);
    return parts.length ? result(parts) : result([['out', '']]);
  }

  /* Busca a un usuario en el /etc/passwd actual (por si se ha añadido una fila nueva). */
  function passwdEntry(sh, name) {
    const n = sh.fs.find('/etc/passwd');
    if (!n) return null;
    for (const l of lines(n.content)) {
      const f = l.split(':');
      if (f[0] === name) return { name: f[0], pass: f[1] === 'x' ? null : f[1], uid: +f[2], shell: f[6] };
    }
    return null;
  }

  /* ---------- sudo ---------- */

  const SHELLY = /(^|\/)(bash|sh|zsh|dash)$/;
  /* ¿Este uso de un binario abre una shell? (estilo GTFOBins) */
  function gtfobinsEscape(binName, rest) {
    const b = base(binName);
    const s = rest.join(' ');
    if (SHELLY.test(b)) return true;
    if (b === 'find') return /-exec\s+(\/\S*\/)?(bash|sh|dash|awk)\b/.test(s) || /-exec\s+.*\bsh\b/.test(s);
    if (b === 'vim' || b === 'vi' || b === 'nvim') return /-c\s*['"]?\s*:?(!|shell|py|lua|norm)/i.test(s) || /:!\s*\/?\w*sh/.test(s);
    if (b === 'awk' || b === 'gawk') return /BEGIN\s*\{\s*system\(/.test(s);
    if (b === 'env') return /\/?\w*sh\b/.test(s);
    if (b === 'python' || b === 'python3') return /system\(|pty\.spawn\(|os\.exec|setuid\(/.test(s);
    if (b === 'perl') return /system\(|exec\(/.test(s);
    if (b === 'less' || b === 'more' || b === 'man') return /!\s*\/?\w*sh/.test(s);
    if (b === 'tar') return /checkpoint-action=exec/.test(s);
    if (b === 'nmap') return /--interactive/.test(s);
    if (b === 'cp' || b === 'tee' || b === 'dd') return false; // sirven para otra cosa (escribir), no shell
    return false;
  }

  function sudoCmd(sh, argv) {
    const parts = [];
    const me = sh.user;
    const rules = sh.rt.sudoers[me] || [];
    const full = rules.some((r) => r.bin === 'ALL');

    if (argv[0] === '-l' || argv[0] === '-ll') {
      parts.push(line(`Matching Defaults entries for ${me} on ${sh.rt.host}:`), line('    env_reset, mail_badpass,'), line('    secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin'), ['out', '\n']);
      if (!rules.length) {
        parts.push(errline(`Sorry, user ${me} may not run sudo on ${sh.rt.host}.`));
        return result(parts);
      }
      parts.push(line(`User ${me} may run the following commands on ${sh.rt.host}:`));
      for (const r of rules) parts.push(line(`    (${r.runas || 'root'}${r.runasg ? ':' + r.runasg : ''})${r.nopasswd ? ' NOPASSWD:' : ''} ${r.bin === 'ALL' ? 'ALL' : r.bin}${r.args ? ' ' + r.args : ''}`));
      return result(parts);
    }

    let runas = 'root';
    while (argv[0] && argv[0][0] === '-') {
      if (argv[0] === '-u') {
        runas = argv[1] || '';
        argv = argv.slice(2);
      } else argv = argv.slice(1);
    }
    if (!argv.length) {
      parts.push(errline('uso: sudo <orden>   o   sudo -l   para ver qué tienes permitido'));
      return result(parts);
    }
    const cmd = argv[0];
    const path = cmd[0] === '/' ? cmd : '/usr/bin/' + cmd;

    if (full) {
      /* sudo sin restricciones: haz lo que sea como el objetivo */
      if (!sh.rt.users[runas]) {
        parts.push(errline(`sudo: usuario desconocido: ${runas}`));
        return result(parts);
      }
      if (gtfobinsEscape(cmd, argv.slice(1)) || runas === 'root') {
        return runSudoAs(sh, runas, cmd, argv.slice(1), parts, true);
      }
      return runSudoAs(sh, runas, cmd, argv.slice(1), parts, false);
    }

    const rule = rules.find((r) => r.bin === path || r.bin === cmd || base(r.bin) === base(cmd));
    if (!rule) {
      const whole = (cmd + ' ' + argv.slice(1).join(' ')).trim();
      parts.push(errline(`Sorry, user ${me} is not allowed to execute '${whole}' as ${runas} on ${sh.rt.host}.`));
      return result(parts);
    }
    if ((rule.runas || 'root') !== runas && !(runas === 'root' && !rule.runas)) {
      /* la regla es para otro usuario distinto del -u pedido */
      if (!(rule.runas === runas)) {
        parts.push(errline(`Sorry, user ${me} is not allowed to execute that command as ${runas}.`));
        return result(parts);
      }
    }
    return runSudoAs(sh, rule.runas || 'root', cmd, argv.slice(1), parts, gtfobinsEscape(cmd, argv.slice(1)));
  }

  /* Ejecuta la orden permitida como `target`. Si es una fuga de shell, te quedas dentro como él. */
  function runSudoAs(sh, target, cmd, rest, parts, escape) {
    if (escape) {
      become(sh, target, parts, null);
      return result(parts.length ? parts : [['out', '']]);
    }
    /* no es una fuga: ejecuta la orden con los privilegios del objetivo y vuelve */
    const r = sh.execLine([cmd].concat(rest).join(' '), target);
    for (const p of r.parts) parts.push(p);
    return result(parts.length ? parts : [['out', '']]);
  }

  /* ---------- detección de escaladas a nivel de línea ---------- */

  /* Devuelve un resultado si la línea es una técnica de escalada que funciona; si no, null. */
  function tryExploit(sh, raw) {
    const s = raw.trim();
    const parts = [];
    const suidHas = (name) => Array.from(sh.rt.suid).some((p) => base(p) === name);

    /* SUID bash: bash -p mantiene el euid de root */
    if (/(^|\s)(\/\S*\/)?bash\s+(-\w*p|--?p)\b/.test(s) || /(^|\s)(\/tmp\/\S+|\/\S+)\s+-p\b/.test(s)) {
      const m = /(\S+)\s+-\w*p\b/.exec(s);
      const prog = m ? m[1] : 'bash';
      const node = sh.fs.find(prog[0] === '/' ? prog : '/usr/bin/' + base(prog));
      const shelly = SHELLY.test(base(prog)) || /bash/.test(base(prog));
      if ((suidHas(base(prog)) && shelly) || (node && node.mode & 0o4000 && shelly)) {
        become(sh, 'root', parts, null);
        return result(parts.length ? parts : [['out', '']]);
      }
    }
    /* SUID find: find ... -exec una shell */
    if (/^find\b/.test(s) && /-exec\b/.test(s) && /\b(bash|sh|dash)\b/.test(s)) {
      if (suidHas('find')) {
        become(sh, 'root', parts, null);
        return result(parts.length ? parts : [['out', '']]);
      }
    }
    /* capabilities: python con cap_setuid y os.setuid(0) */
    if (/python3?\b/.test(s) && /setuid\(0\)/.test(s)) {
      const cap = Object.keys(sh.rt.caps).find((p) => /python/.test(p));
      if (cap && /cap_setuid/.test(sh.rt.caps[cap])) {
        become(sh, 'root', parts, null);
        return result(parts.length ? parts : [['out', '']]);
      }
    }
    return null;
  }

  /* ---------- enganche en la terminal ---------- */

  const run0 = Shell.prototype.run;
  Shell.prototype.run = function (raw) {
    if (!this.rt) return run0.call(this, raw);
    const line0 = raw;
    /* contraseña pendiente de su */
    if (this.rt.suPrompt) {
      const target = this.rt.suPrompt;
      this.rt.suPrompt = null;
      this.history.push(raw);
      const r = suAuth(this, target, raw);
      afterRun(this);
      return r;
    }
    const s = raw.trim();
    if (!s) return run0.call(this, raw);

    /* su: pide contraseña (salvo que ya seas root) */
    let r = null;
    const suM = /^su\s*(?:-\s+|--login\s+|-l\s+|-\s+)?([\w.-]+)?$/.exec(s) || (/^su$/.test(s) ? [s, 'root'] : null);
    if (suM) {
      const target = suM[1] || 'root';
      const u = this.rt.users[target];
      const row = passwdEntry(this, target);
      const noPass = (u && u.pass === '') || (row && row.pass === '');
      if (!u && !row) {
        r = result([errline(`su: el usuario ${target} no existe`)]);
      } else if (this.user === 'root' || noPass) {
        /* root no necesita contraseña; una cuenta sin contraseña tampoco pide nada */
        r = suAuth(this, target, u ? u.pass : row ? row.pass : null);
      } else {
        this.rt.suPrompt = target;
        r = result([['out', 'Contraseña: ']]);
        r.suPrompt = true;
      }
    } else if (/^sudo\b/.test(s)) {
      r = sudoCmd(this, s.replace(/^sudo\s*/, '').split(/\s+/).filter(Boolean));
    } else {
      r = tryExploit(this, s);
    }

    if (r) {
      this.history.push(s);
      afterRun(this);
      return r;
    }
    /* orden normal: la ejecuta la terminal base con el usuario actual */
    const res = run0.call(this, raw);
    afterRun(this);
    return res;
  };

  /* Después de cada orden: si el script del cron se ha modificado con un payload, "pasa un minuto"
     y root lo ejecuta, como ocurriría de verdad. */
  function afterRun(sh) {
    const cron = sh.rt.cron;
    if (!cron || sh.rt.cronFired) return;
    const n = sh.fs.find(cron.script);
    if (!n || n.type !== 'file') return;
    const payload = n.content.replace(cron.original || '', '');
    if (/chmod\s+\+?s|chmod\s+[0-7]*4[0-7]{3}|cp\s+\S*bash|>>\s*\/etc\/passwd|bash\s+-i|nc\b|mkfifo|\/dev\/tcp/.test(payload) && payload.trim()) {
      sh.rt.cronFired = true;
      sh.rt.cronOutput = true;
      runAsRoot(sh, n.content);
    }
  }

  /* ---------- órdenes que cambian de comportamiento ---------- */

  COMMANDS.id = function (a, c) {
    const who = a.find((x) => x[0] !== '-') || c.user;
    if (c.sh.rt && (c.sh.rt.users[who] || passwdEntry(c.sh, who))) return c.print(idString(c.sh, who));
    c.print(idString(c.sh, who));
  };
  COMMANDS.whoami = function (a, c) {
    c.print(c.user);
  };
  COMMANDS.groups = function (a, c) {
    if (!c.sh.rt) return c.print(c.user);
    const u = c.sh.rt.users[c.user];
    c.print((c.user === 'root' ? 'root' : c.user + ' ' + (u && u.groups ? u.groups.join(' ') : '')).trim());
  };
  COMMANDS.hostname = function (a, c) {
    c.print(c.sh.rt ? c.sh.rt.host : 'ubuntu');
  };
  /* su como orden (para cuando va encadenado con ; y la cuenta no tiene contraseña) */
  COMMANDS.su = function (a, c) {
    if (!c.sh.rt) return c.fail('su: no disponible');
    const target = a.find((x) => x[0] !== '-') || 'root';
    const u = c.sh.rt.users[target];
    const row = passwdEntry(c.sh, target);
    if (!u && !row) return c.fail(`su: el usuario ${target} no existe`);
    const isRoot = u ? u.uid === 0 : row && row.uid === 0;
    const noPass = (u && u.pass === '') || (row && row.pass === '');
    if (c.user === 'root' || noPass) {
      const dest = isRoot ? 'root' : target;
      c.sh.user = dest;
      c.sh.cwd = homeOf(c.sh, dest);
      c.sh.env.HOME = homeOf(c.sh, dest);
      c.sh.env.USER = dest;
      c.sh.rt.owned.add(dest);
      return;
    }
    c.sh.rt.suPrompt = target;
    c.print('Contraseña: ');
  };

  COMMANDS.getcap = function (a, c) {
    if (!c.sh.rt) return c.print('');
    const caps = c.sh.rt.caps;
    const start = a.find((x) => x[0] !== '-') || '/';
    const hits = Object.keys(caps).filter((p) => p.startsWith(start === '/' ? '' : start));
    if (!hits.length && !a.includes('-r')) return;
    for (const p of hits) c.print(`${p} ${caps[p]}`);
  };
  /* python en modo "una orden": lo justo para enseñar la estabilización de la shell y la técnica de caps */
  COMMANDS.python3 = COMMANDS.python = function (a, c) {
    const code = a.join(' ');
    if (/pty\.spawn/.test(code)) return; // estabilizar la shell: no cambia nada visible
    if (/setuid\(0\)/.test(code)) return; // lo gestiona tryExploit
    const m = /print\(([^)]*)\)/.exec(code);
    if (m) return c.print(m[1].replace(/['"]/g, ''));
  };

  /* ---------- la chuleta ---------- */

  DOCS.length = 0;
  DOCS.push(
    ...[
      ['Orientarte', 'whoami', 'Dice con qué usuario estás ahora mismo.', 'whoami'],
      ['Orientarte', 'id', 'Tu usuario y, sobre todo, tus grupos (sudo, docker… son oro).', 'id'],
      ['Orientarte', 'hostname', 'El nombre de la máquina en la que estás.', 'hostname'],
      ['Orientarte', 'uname -a', 'Versión del núcleo: pista para buscar exploits del sistema.', 'uname -a'],
      ['Orientarte', 'pwd', 'En qué carpeta estás.', 'pwd'],
      ['Orientarte', 'cat /etc/os-release', 'Qué sistema operativo y versión es.', 'cat /etc/os-release'],
      ['Reconocer', 'cat /etc/passwd', 'Lista de usuarios: quién más vive en esta máquina.', 'cat /etc/passwd'],
      ['Reconocer', 'ls -la', 'Lista con permisos y archivos ocultos. Mira los dueños.', 'ls -la'],
      ['Reconocer', 'ps aux', 'Procesos en marcha: servicios y quién los ejecuta.', 'ps aux'],
      ['Reconocer', 'ss -tulnp', 'Puertos abiertos: servicios internos que no se ven desde fuera.', 'ss -tulnp'],
      ['Reconocer', 'env', 'Variables de entorno: a veces guardan contraseñas.', 'env'],
      ['Estabilizar', 'python3 pty', 'Convierte una shell tonta en una terminal completa.', 'python3 -c \'import pty; pty.spawn("/bin/bash")\''],
      ['Enumerar', 'sudo -l', 'Qué puedes ejecutar con sudo. La primera orden que se mira.', 'sudo -l'],
      ['Enumerar', 'find SUID', 'Busca binarios con el bit SUID (se ejecutan como su dueño).', 'find / -perm -4000 -type f 2>/dev/null'],
      ['Enumerar', 'getcap', 'Busca binarios con capabilities (permisos de root a trozos).', 'getcap -r / 2>/dev/null'],
      ['Enumerar', 'cat /etc/crontab', 'Tareas programadas: scripts que root ejecuta solo.', 'cat /etc/crontab'],
      ['Enumerar', 'find escribibles', 'Archivos que puedes modificar y no deberías.', 'find / -writable -type f 2>/dev/null'],
      ['Enumerar', 'grep contraseñas', 'Busca credenciales olvidadas en archivos de configuración.', 'grep -ri password /var/www 2>/dev/null'],
      ['Pivotar', 'su', 'Cambia a otro usuario (te pedirá su contraseña).', 'su developer'],
      ['Pivotar', 'sudo -u', 'Ejecuta una orden como otro usuario.', 'sudo -u developer id'],
      ['Pivotar', 'ssh', 'Entra a otra cuenta con una clave privada que hayas encontrado.', 'ssh developer@localhost'],
      ['Pivotar', 'cat ~/.ssh/id_rsa', 'Una clave privada SSH es una llave para entrar sin contraseña.', 'cat /home/user/.ssh/id_rsa'],
      ['Escalar', 'sudo GTFOBins', 'Si sudo te deja un programa que abre shells, abres una como root.', 'sudo find . -exec /bin/sh \\; -quit'],
      ['Escalar', 'SUID shell', 'Un bash SUID con -p mantiene los privilegios de root.', '/usr/bin/bash -p'],
      ['Escalar', 'cron writable', 'Si puedes editar un script que root ejecuta, metes tu payload.', 'echo "chmod +s /bin/bash" >> /opt/limpiar.sh'],
      ['Escalar', 'PATH hijack', 'Si un SUID llama a una orden por su nombre, le cuelas la tuya.', 'export PATH=/tmp:$PATH'],
      ['Escalar', 'capabilities', 'python con cap_setuid puede ponerse como root él solo.', 'python3 -c \'import os; os.setuid(0); os.system("/bin/bash")\''],
      ['Escalar', '/etc/passwd', 'Si es escribible, añades un usuario con UID 0 (otro root).', 'echo "hax:...:0:0::/root:/bin/bash" >> /etc/passwd'],
      ['Botín', 'cat flag', 'La prueba de que lo has conseguido: user.txt y root.txt.', 'cat /root/root.txt'],
      ['Botín', 'grep -r', 'Rebusca por todo un árbol de carpetas a la vez.', 'grep -r clave /home 2>/dev/null'],
    ].map(([cat, cmd, desc, ex]) => ({ cat, cmd, desc, ex }))
  );

  /* ssh con una clave privada encontrada: entra en la cuenta del objetivo (pivoting lateral). */
  COMMANDS.ssh = function (a, c) {
    const rt = c.sh.rt;
    const target = a.find((x) => /@/.test(x));
    if (!target) return c.fail('uso: ssh usuario@localhost   (con una clave que hayas encontrado)');
    const [user, host] = target.split('@');
    if (!/^(localhost|127\.0\.0\.1|la-fragua|victima)$/.test(host) && rt && host !== rt.host) return c.fail(`ssh: Could not resolve hostname ${host}: Name or service not known`);
    if (!rt || !rt.users[user]) return c.fail(`${user}@${host}: Permission denied (publickey,password).`);
    const keyed = rt.sshKeys && Object.values(rt.sshKeys).includes(user);
    if (!keyed) return c.fail(`${user}@${host}: Permission denied (publickey,password).\n(Necesitas la clave privada de ${user}, o su contraseña con su ${user})`);
    become(c.sh, user, []);
    c.print(`Welcome to Ubuntu 22.04.3 LTS\n` + idString(c.sh, user));
  };

  /* chmod que sí entiende el bit SUID/SGID/sticky (el base lo descartaba) */
  COMMANDS.chmod = function (a, c) {
    const rest = a.filter((x) => x !== '-R' && x !== '-v');
    if (rest.length < 2) return c.fail('chmod: falta un operando\nEjemplo: chmod +x script.sh');
    const spec = rest.shift();
    for (const t of rest) {
      const p = c.path(t);
      let n;
      try {
        n = c.fs.node(p, c.user);
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        c.fail(`chmod: no se puede acceder a '${t}': ${e.message}`);
        continue;
      }
      if (c.user !== 'root' && n.owner !== c.user) {
        c.fail(`chmod: cambiando los permisos de '${t}': Operación no permitida`);
        continue;
      }
      let m = applyModeFull(n.mode, spec);
      if (m === null) {
        c.fail(`chmod: modo inválido: «${spec}»`);
        continue;
      }
      n.mode = m;
    }
  };
  function applyModeFull(mode, spec) {
    if (/^[0-7]{3,4}$/.test(spec)) return parseInt(spec, 8) & 0o7777;
    let m = mode;
    for (const part of spec.split(',')) {
      const r = /^([ugoa]*)([+\-=])([rwxsStT]*)$/.exec(part);
      if (!r) return null;
      const who = !r[1] || r[1].includes('a') ? 'ugo' : r[1];
      let base = 0;
      for (const ch of r[3]) if ('rwx'.includes(ch)) base |= { r: 4, w: 2, x: 1 }[ch];
      for (const w of who) {
        const sh = { u: 6, g: 3, o: 0 }[w];
        if (r[2] === '+') m |= base << sh;
        else if (r[2] === '-') m &= ~(base << sh);
        else m = (m & ~(7 << sh)) | (base << sh);
      }
      if (r[3].includes('s')) {
        if (!r[1] || r[1].includes('u') || r[1].includes('a')) m = r[2] === '-' ? m & ~0o4000 : m | 0o4000;
        if (!r[1] || r[1].includes('g') || r[1].includes('a')) m = r[2] === '-' ? m & ~0o2000 : m | 0o2000;
      }
      if (r[3].includes('t')) m = r[2] === '-' ? m & ~0o1000 : m | 0o1000;
    }
    return m;
  }

  /* lista de procesos propia de un servidor: útil para ver servicios y quién los lanza */
  COMMANDS.ps = function (a, c) {
    const rt = c.sh.rt;
    const svc = rt && rt.procs ? rt.procs : [];
    const rows = [
      'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
      'root           1  0.0  0.1 168120 11300 ?        Ss   09:10   0:02 /sbin/init',
      'root         540  0.0  0.1  99180  9100 ?        Ss   09:10   0:00 /usr/sbin/sshd -D',
      'root         602  0.0  0.0  81320  3200 ?        Ss   09:10   0:00 /usr/sbin/cron -f',
      'www-data     910  0.0  0.3 210400 28400 ?        S    09:11   0:01 /usr/sbin/apache2 -k start',
    ];
    for (const p of svc) rows.push(`${(p.user + '           ').slice(0, 12)}${String(p.pid).padStart(4)}  0.0  0.2 120400 15200 ?        Ss   09:11   0:00 ${p.cmd}`);
    rows.push(`${(c.user + '           ').slice(0, 12)}${String(2200).padStart(4)}  0.0  0.0  12140  3400 pts/0    S    10:20   0:00 bash`);
    if (!a.join('').replace(/-/g, '').match(/aux|ef/)) {
      c.print('    PID TTY          TIME CMD\n   2200 pts/0    00:00:00 bash\n   2250 pts/0    00:00:00 ps');
      return;
    }
    c.print(rows.join('\n'));
  };

  G.REDTEAM = { buildBox, putFile, bin, result, idString, homeOf, passwdEntry };
})(typeof window !== 'undefined' ? window : globalThis);
