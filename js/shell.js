/* Intérprete de órdenes simulado: tuberías, redirecciones, sudo y las órdenes básicas de Ubuntu. */
(function (G) {
  'use strict';

  const { FsError, fail, modeStr, USER, HOME } = G.VFS;
  const HOST = 'ubuntu';
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  /* Marcas de color: \x01 + tipo + texto + \x02 (D carpeta, X ejecutable, M coincidencia). */
  const mark = (t, s) => '\x01' + t + s + '\x02';

  /* Órdenes que hay que instalar antes con apt. */
  const PACKAGES = {
    tree: 'muestra carpetas en forma de árbol',
    cowsay: 'una vaca que dice cosas',
    neofetch: 'resumen del sistema con logotipo',
    htop: 'monitor de procesos interactivo',
    git: 'control de versiones',
    curl: 'descargas desde la terminal',
    vim: 'editor de texto avanzado',
  };

  /* Documentación: la usan `man`, `help` y la chuleta de la web. */
  const DOCS = [
    ['Navegar', 'pwd', 'Muestra en qué carpeta estás.', 'pwd'],
    ['Navegar', 'ls', 'Lista el contenido de una carpeta. -l detalles, -a ocultos, -h tamaños legibles.', 'ls -la'],
    ['Navegar', 'cd', 'Cambia de carpeta. Sin nada vuelve a tu casa; «..» sube un nivel; «-» vuelve a la anterior.', 'cd Documentos'],
    ['Navegar', 'tree', 'Dibuja las carpetas como un árbol (hay que instalarlo).', 'tree Documentos'],
    ['Archivos', 'mkdir', 'Crea carpetas. -p crea también las intermedias.', 'mkdir -p proyectos/web'],
    ['Archivos', 'touch', 'Crea un archivo vacío.', 'touch ideas.txt'],
    ['Archivos', 'cp', 'Copia archivos. -r para carpetas enteras.', 'cp notas.txt copia.txt'],
    ['Archivos', 'mv', 'Mueve o cambia el nombre.', 'mv viejo.txt nuevo.txt'],
    ['Archivos', 'rm', 'Borra archivos. -r borra carpetas con todo dentro. No hay papelera.', 'rm -r carpeta'],
    ['Archivos', 'rmdir', 'Borra una carpeta vacía.', 'rmdir carpeta'],
    ['Leer y escribir', 'cat', 'Muestra el contenido de un archivo.', 'cat notas.txt'],
    ['Leer y escribir', 'echo', 'Escribe un texto. Con > lo guarda en un archivo; con >> lo añade al final.', 'echo "hola" > saludo.txt'],
    ['Leer y escribir', 'head', 'Primeras líneas de un archivo.', 'head -n 3 /var/log/syslog'],
    ['Leer y escribir', 'tail', 'Últimas líneas de un archivo.', 'tail -n 5 /var/log/syslog'],
    ['Leer y escribir', 'nano', 'Editor de texto sencillo. Ctrl+O guarda, Ctrl+X sale.', 'nano saludo.txt'],
    ['Buscar y filtrar', 'grep', 'Busca líneas que contengan un texto. -i sin distinguir mayúsculas, -n número de línea, -v las que no, -c cuenta.', 'grep -i error /var/log/syslog'],
    ['Buscar y filtrar', 'find', 'Busca archivos por nombre o tipo.', 'find . -name "*.txt"'],
    ['Buscar y filtrar', 'wc', 'Cuenta líneas (-l), palabras (-w) y bytes (-c).', 'ls /etc | wc -l'],
    ['Buscar y filtrar', 'sort', 'Ordena líneas. -r al revés, -n numérico, -u sin repetidos.', 'sort lista-compra.txt'],
    ['Buscar y filtrar', 'uniq', 'Quita líneas repetidas seguidas. -c las cuenta.', 'sort lista.txt | uniq -c'],
    ['Permisos', 'chmod', 'Cambia permisos: con letras (u+x, go-w) o con números (755).', 'chmod +x script.sh'],
    ['Permisos', 'chown', 'Cambia el dueño de un archivo (necesita sudo).', 'sudo chown root archivo'],
    ['Permisos', 'sudo', 'Ejecuta una orden como administrador (root).', 'sudo cat /etc/shadow'],
    ['Permisos', 'whoami', 'Dice con qué usuario estás.', 'whoami'],
    ['Permisos', 'id', 'Muestra tu usuario y tus grupos.', 'id'],
    ['Paquetes', 'apt', 'Instala y actualiza programas: update, upgrade, install, remove, list.', 'sudo apt install tree'],
    ['Sistema', 'uname', 'Información del núcleo. -a lo muestra todo.', 'uname -a'],
    ['Sistema', 'df', 'Espacio en disco. -h en unidades legibles.', 'df -h'],
    ['Sistema', 'free', 'Memoria RAM usada y libre.', 'free -h'],
    ['Sistema', 'ps', 'Procesos en marcha. «ps aux» los muestra todos.', 'ps aux'],
    ['Sistema', 'date', 'Fecha y hora.', 'date'],
    ['Sistema', 'uptime', 'Cuánto lleva encendido el equipo.', 'uptime'],
    ['Sistema', 'hostname', 'Nombre del equipo.', 'hostname'],
    ['Sistema', 'which', 'Dónde está el programa de una orden.', 'which ls'],
    ['Ayuda', 'man', 'Manual de una orden.', 'man ls'],
    ['Ayuda', 'help', 'Lista las órdenes de este simulador.', 'help'],
    ['Ayuda', 'history', 'Órdenes que has escrito.', 'history'],
    ['Ayuda', 'clear', 'Limpia la pantalla (también Ctrl+L).', 'clear'],
  ].map(([cat, cmd, desc, ex]) => ({ cat, cmd, desc, ex }));

  /* ---------- utilidades ---------- */

  const lines = (t) => (t === '' ? [] : t.replace(/\n$/, '').split('\n'));
  const bytes = (s) => new TextEncoder().encode(s).length;
  const base = (p) => p.slice(p.lastIndexOf('/') + 1);
  const cmp = (a, b) => a.localeCompare(b, 'es');
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function globRe(pat, insensitive) {
    const src = pat.split('').map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : escRe(ch))).join('');
    return new RegExp('^' + src + '$', insensitive ? 'i' : '');
  }

  /* Separa las opciones cortas (-la) del resto de argumentos. */
  function opts(args) {
    const flags = new Set();
    const rest = [];
    let end = false;
    for (const a of args) {
      if (!end && a === '--') end = true;
      else if (!end && /^-[A-Za-z]+$/.test(a)) for (const ch of a.slice(1)) flags.add(ch);
      else if (!end && /^--[a-z-]+$/.test(a)) flags.add(a);
      else rest.push(a);
    }
    return { flags, rest };
  }

  /* Ejecuta fn y convierte un error del sistema de archivos en un mensaje de la orden. */
  function guard(c, label, fn) {
    try {
      fn();
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      c.fail(label + ': ' + e.message);
    }
  }

  /* Texto de entrada de una orden: los archivos indicados o, si no hay, lo que llega por la tubería. */
  function inputs(c, cmd, files) {
    if (!files.length) return [['', c.stdin || '']];
    const out = [];
    for (const f of files) guard(c, cmd + ': ' + f, () => out.push([f, c.fs.read(c.path(f), c.user)]));
    return out;
  }

  function size(n) {
    return n.type === 'dir' ? 4096 : n.size !== undefined ? n.size : bytes(n.content);
  }
  function human(n) {
    if (n < 1024) return String(n);
    if (n < 1048576) return (n / 1024).toFixed(1).replace('.', ',') + 'K';
    return (n / 1048576).toFixed(1).replace('.', ',') + 'M';
  }
  function paint(name, n, tty) {
    if (!tty) return name;
    if (n.type === 'dir') return mark('D', name);
    if (n.mode & 0o111) return mark('X', name);
    return name;
  }
  function stamp(ms) {
    const d = new Date(ms);
    const p = (x) => String(x).padStart(2, '0');
    return MONTHS[d.getMonth()] + ' ' + String(d.getDate()).padStart(2, ' ') + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function applyMode(mode, spec) {
    if (/^[0-7]{3,4}$/.test(spec)) return parseInt(spec, 8) & 0o777;
    let m = mode;
    for (const part of spec.split(',')) {
      const r = /^([ugoa]*)([+\-=])([rwx]*)$/.exec(part);
      if (!r) return null;
      let bits = 0;
      for (const ch of r[3]) bits |= { r: 4, w: 2, x: 1 }[ch];
      const who = !r[1] || r[1].includes('a') ? 'ugo' : r[1];
      for (const w of who) {
        const sh = { u: 6, g: 3, o: 0 }[w];
        if (r[2] === '+') m |= bits << sh;
        else if (r[2] === '-') m &= ~(bits << sh);
        else m = (m & ~(7 << sh)) | (bits << sh);
      }
    }
    return m;
  }

  /* ---------- órdenes ---------- */

  const COMMANDS = {
    pwd(a, c) {
      c.print(c.sh.cwd);
    },

    ls(a, c) {
      const { flags, rest } = opts(a);
      const long = flags.has('l');
      const targets = rest.length ? rest : ['.'];
      const files = [];
      const dirs = [];
      for (const t of targets)
        guard(c, `ls: no se puede acceder a '${t}'`, () => {
          const n = c.fs.node(c.path(t), c.user);
          (n.type === 'dir' && !flags.has('d') ? dirs : files).push([t, n]);
        });
      const block = (ents) => {
        /* Como el ls de verdad: en pantalla van en fila; hacia una tubería o un archivo, uno por línea. */
        if (!long) return ents.map(([name, n]) => paint(name, n, c.tty)).join(c.tty ? '  ' : '\n');
        const w = Math.max(...ents.map(([, n]) => (flags.has('h') ? human(size(n)) : String(size(n))).length));
        return ents
          .map(([name, n]) => {
            const sz = flags.has('h') ? human(size(n)) : String(size(n));
            const links = n.type === 'dir' ? 2 + Object.values(n.children).filter((x) => x.type === 'dir').length : 1;
            return `${modeStr(n)} ${links} ${n.owner} ${n.group} ${sz.padStart(w)} ${stamp(n.mtime)} ${paint(name, n, c.tty)}`;
          })
          .join('\n');
      };
      if (files.length) c.print(block(files));
      dirs.forEach(([t, n], i) => {
        guard(c, `ls: no se puede abrir el directorio '${t}'`, () => {
          const p = c.path(t);
          const ch = c.fs.list(p, c.user);
          let ents = Object.keys(ch).sort(cmp).map((k) => [k, ch[k]]);
          if (flags.has('a')) ents = [['.', n], ['..', c.fs.find(c.fs.abs(p, '..')) || n], ...ents];
          else ents = ents.filter(([k]) => k[0] !== '.');
          if (targets.length > 1) c.print((i || files.length ? '\n' : '') + t + ':');
          if (long) c.print('total ' + ents.length * 4);
          if (ents.length) c.print(block(ents));
        });
      });
    },

    cd(a, c) {
      if (a.length > 1) return c.fail('bash: cd: demasiados argumentos');
      let t = a.length ? a[0] : HOME;
      if (t === '-') {
        t = c.sh.prev;
        c.print(t);
      }
      const p = c.path(t);
      try {
        const n = c.fs.node(p, c.user);
        if (n.type !== 'dir') return c.fail(`bash: cd: ${t}: No es un directorio`);
        if (!c.fs.can(n, c.user, 1)) return c.fail(`bash: cd: ${t}: Permiso denegado`);
        c.sh.prev = c.sh.cwd;
        c.sh.cwd = p;
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        c.fail(`bash: cd: ${t}: ${e.message}`);
      }
    },

    mkdir(a, c) {
      const { flags, rest } = opts(a);
      if (!rest.length) return c.fail('mkdir: falta un operando');
      for (const t of rest) {
        const p = c.path(t);
        if (flags.has('p')) {
          guard(c, `mkdir: no se puede crear el directorio «${t}»`, () => {
            let cur = '';
            for (const s of p.split('/').filter(Boolean)) {
              cur += '/' + s;
              const n = c.fs.find(cur);
              if (!n) c.fs.mkdir(cur, c.user);
              else if (n.type !== 'dir') fail('EEXIST');
            }
          });
        } else guard(c, `mkdir: no se puede crear el directorio «${t}»`, () => c.fs.mkdir(p, c.user));
      }
    },

    touch(a, c) {
      if (!a.length) return c.fail('touch: falta un fichero como argumento');
      for (const t of a)
        guard(c, `touch: no se puede efectuar «touch» sobre '${t}'`, () => {
          const p = c.path(t);
          const n = c.fs.find(p, c.user);
          if (n) n.mtime = Date.now();
          else c.fs.write(p, c.user, '');
        });
    },

    cat(a, c) {
      const { flags, rest } = opts(a);
      let i = 0;
      for (const [, text] of inputs(c, 'cat', rest)) {
        if (flags.has('n')) for (const l of lines(text)) c.print(String(++i).padStart(6) + '  ' + l);
        else c.out += text;
      }
    },

    echo(a, c) {
      let nl = true;
      if (a[0] === '-n') {
        nl = false;
        a = a.slice(1);
      }
      c.out += a.join(' ') + (nl ? '\n' : '');
    },

    rm(a, c) {
      const { flags, rest } = opts(a);
      const rec = flags.has('r') || flags.has('R');
      const force = flags.has('f');
      if (!rest.length && !force) return c.fail('rm: falta un operando');
      for (const t of rest) {
        const p = c.path(t);
        if (p === '/') {
          c.fail("rm: es peligroso operar recursivamente sobre '/'\n(En un Ubuntu real, forzar esto borraría el sistema entero. No lo hagas nunca.)");
          continue;
        }
        try {
          const n = c.fs.node(p, c.user);
          if (n.type === 'dir' && !rec) {
            c.fail(`rm: no se puede borrar '${t}': Es un directorio`);
            continue;
          }
          c.fs.remove(p, c.user);
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          if (!(force && e.code === 'ENOENT')) c.fail(`rm: no se puede borrar '${t}': ${e.message}`);
        }
      }
    },

    rmdir(a, c) {
      if (!a.length) return c.fail('rmdir: falta un operando');
      for (const t of a)
        guard(c, `rmdir: fallo al borrar '${t}'`, () => {
          const p = c.path(t);
          const n = c.fs.node(p, c.user);
          if (n.type !== 'dir') fail('ENOTDIR');
          if (Object.keys(n.children).length) fail('ENOTEMPTY');
          c.fs.remove(p, c.user);
        });
    },

    cp(a, c) {
      const { flags, rest } = opts(a);
      if (rest.length < 2) return c.fail('cp: falta el fichero de destino');
      const dest = rest.pop();
      const dp = c.path(dest);
      const dn = c.fs.find(dp, c.user);
      const intoDir = dn && dn.type === 'dir';
      if (rest.length > 1 && !intoDir) return c.fail(`cp: el destino '${dest}' no es un directorio`);
      for (const s of rest)
        guard(c, `cp: no se puede copiar '${s}'`, () => {
          const sp = c.path(s);
          const n = c.fs.node(sp, c.user);
          if (n.type === 'dir' && !flags.has('r') && !flags.has('R'))
            return c.fail(`cp: -r no especificado; se omite el directorio '${s}'`);
          if (!c.fs.can(n, c.user, 4)) fail('EACCES');
          const target = intoDir ? (dp === '/' ? '' : dp) + '/' + base(sp) : dp;
          if (target === sp) return c.fail(`cp: '${s}' y '${dest}' son el mismo fichero`);
          if (n.type === 'dir' && (target + '/').startsWith(sp + '/'))
            return c.fail(`cp: no se puede copiar un directorio, '${s}', dentro de sí mismo`);
          c.fs.put(target, c.user, c.fs.clone(n, c.user));
        });
    },

    mv(a, c) {
      const { rest } = opts(a);
      if (rest.length < 2) return c.fail('mv: falta el fichero de destino');
      const dest = rest.pop();
      const dp = c.path(dest);
      const dn = c.fs.find(dp, c.user);
      const intoDir = dn && dn.type === 'dir';
      if (rest.length > 1 && !intoDir) return c.fail(`mv: el destino '${dest}' no es un directorio`);
      for (const s of rest)
        guard(c, `mv: no se puede mover '${s}'`, () => {
          const sp = c.path(s);
          const n = c.fs.node(sp, c.user);
          const [sparent, sname] = c.fs.parent(sp, c.user);
          if (!c.fs.can(sparent, c.user, 2)) fail('EACCES');
          const target = intoDir ? (dp === '/' ? '' : dp) + '/' + base(sp) : dp;
          if (target === sp) return c.fail(`mv: '${s}' y '${dest}' son el mismo fichero`);
          if (n.type === 'dir' && (target + '/').startsWith(sp + '/'))
            return c.fail(`mv: no se puede mover '${s}' a un subdirectorio de sí mismo`);
          c.fs.put(target, c.user, n);
          delete sparent.children[sname];
        });
    },

    head(a, c) {
      headTail(a, c, 'head');
    },
    tail(a, c) {
      headTail(a, c, 'tail');
    },

    wc(a, c) {
      const { flags, rest } = opts(a);
      const all = !flags.has('l') && !flags.has('w') && !flags.has('c');
      for (const [name, text] of inputs(c, 'wc', rest)) {
        const cols = [];
        if (all || flags.has('l')) cols.push((text.match(/\n/g) || []).length);
        if (all || flags.has('w')) cols.push(text.split(/\s+/).filter(Boolean).length);
        if (all || flags.has('c')) cols.push(bytes(text));
        c.print(cols.join(' ') + (name ? ' ' + name : ''));
      }
    },

    grep(a, c) {
      const { flags, rest } = opts(a);
      if (!rest.length) return c.fail('Modo de empleo: grep [OPCIÓN]... PATRÓN [FICHERO]...');
      const pat = rest.shift();
      const f = flags.has('i') ? 'i' : '';
      let re;
      try {
        re = new RegExp(pat, f);
      } catch (e) {
        re = new RegExp(escRe(pat), f);
      }
      const reAll = new RegExp(re.source, f + 'g');
      const ins = inputs(c, 'grep', rest);
      let found = false;
      for (const [name, text] of ins) {
        const pre = ins.length > 1 ? name + ':' : '';
        let count = 0;
        lines(text).forEach((l, i) => {
          if (re.test(l) === flags.has('v')) return;
          count++;
          found = true;
          if (flags.has('c')) return;
          const shown = c.tty && !flags.has('v') ? l.replace(reAll, (m) => (m ? mark('M', m) : m)) : l;
          c.print(pre + (flags.has('n') ? i + 1 + ':' : '') + shown);
        });
        if (flags.has('c')) c.print(pre + count);
      }
      if (!found) c.code = 1;
    },

    sort(a, c) {
      const { flags, rest } = opts(a);
      let all = [];
      for (const [, text] of inputs(c, 'sort', rest)) all = all.concat(lines(text));
      all.sort(flags.has('n') ? (x, y) => (parseFloat(x) || 0) - (parseFloat(y) || 0) : cmp);
      if (flags.has('r')) all.reverse();
      if (flags.has('u')) all = all.filter((l, i) => i === 0 || l !== all[i - 1]);
      for (const l of all) c.print(l);
    },

    uniq(a, c) {
      const { flags, rest } = opts(a);
      const groups = [];
      for (const [, text] of inputs(c, 'uniq', rest))
        for (const l of lines(text)) {
          const last = groups[groups.length - 1];
          if (last && last[0] === l) last[1]++;
          else groups.push([l, 1]);
        }
      for (const [l, n] of groups) c.print(flags.has('c') ? String(n).padStart(7) + ' ' + l : l);
    },

    find(a, c) {
      const start = [];
      let name = null;
      let type = null;
      for (let i = 0; i < a.length; i++) {
        if (a[i] === '-name' || a[i] === '-iname') name = globRe(a[i + 1] || '*', a[i++] === '-iname');
        else if (a[i] === '-type') type = a[++i];
        else if (a[i][0] === '-') return c.fail(`find: predicado desconocido '${a[i]}'`);
        else start.push(a[i]);
      }
      if (!start.length) start.push('.');
      for (const s of start)
        guard(c, `find: '${s}'`, () => {
          const walk = (shown, p, n) => {
            const okName = !name || name.test(p === '/' ? '/' : base(p));
            const okType = !type || (type === 'd') === (n.type === 'dir');
            if (okName && okType) c.print(shown);
            if (n.type !== 'dir') return;
            if (!c.fs.can(n, c.user, 4) || !c.fs.can(n, c.user, 1)) return c.fail(`find: '${shown}': Permiso denegado`);
            for (const k of Object.keys(n.children).sort(cmp))
              walk(shown.replace(/\/$/, '') + '/' + k, (p === '/' ? '' : p) + '/' + k, n.children[k]);
          };
          walk(s, c.path(s), c.fs.node(c.path(s), c.user));
        });
    },

    tree(a, c) {
      const { flags, rest } = opts(a);
      const t = rest[0] || '.';
      guard(c, `tree: ${t}`, () => {
        const root = c.fs.node(c.path(t), c.user);
        if (root.type !== 'dir') fail('ENOTDIR');
        let nd = 0;
        let nf = 0;
        c.print(paint(t, root, c.tty));
        const walk = (n, prefix) => {
          if (!c.fs.can(n, c.user, 4) || !c.fs.can(n, c.user, 1)) return;
          const keys = Object.keys(n.children).sort(cmp).filter((k) => flags.has('a') || k[0] !== '.');
          keys.forEach((k, i) => {
            const ch = n.children[k];
            const last = i === keys.length - 1;
            c.print(prefix + (last ? '└── ' : '├── ') + paint(k, ch, c.tty));
            if (ch.type === 'dir') {
              nd++;
              walk(ch, prefix + (last ? '    ' : '│   '));
            } else nf++;
          });
        };
        walk(root, '');
        c.print(`\n${nd} directorios, ${nf} archivos`);
      });
    },

    chmod(a, c) {
      const rest = a.filter((x) => x !== '-R');
      if (rest.length < 2) return c.fail('chmod: falta un operando\nEjemplo: chmod +x script.sh');
      const spec = rest.shift();
      for (const t of rest)
        guard(c, `chmod: no se puede acceder a '${t}'`, () => {
          const n = c.fs.node(c.path(t), c.user);
          if (c.user !== 'root' && n.owner !== c.user)
            return c.fail(`chmod: cambiando los permisos de '${t}': Operación no permitida`);
          const m = applyMode(n.mode, spec);
          if (m === null) return c.fail(`chmod: modo inválido: «${spec}»`);
          n.mode = m;
        });
    },

    chown(a, c) {
      if (a.length < 2) return c.fail('chown: falta un operando');
      const [owner, group] = a[0].split(':');
      for (const t of a.slice(1))
        guard(c, `chown: no se puede acceder a '${t}'`, () => {
          const n = c.fs.node(c.path(t), c.user);
          if (c.user !== 'root') return c.fail(`chown: cambiando el propietario de '${t}': Operación no permitida`);
          if (owner) n.owner = owner;
          if (group) n.group = group;
          else if (owner && a[0].includes(':')) n.group = owner;
        });
    },

    whoami(a, c) {
      c.print(c.user);
    },

    id(a, c) {
      if (c.user === 'root') c.print('uid=0(root) gid=0(root) grupos=0(root)');
      else c.print('uid=1000(estudiante) gid=1000(estudiante) grupos=1000(estudiante),4(adm),27(sudo)');
    },

    hostname(a, c) {
      c.print(HOST);
    },

    date(a, c) {
      const d = new Date();
      const p = (x) => String(x).padStart(2, '0');
      c.print(
        `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ` +
          `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
      );
    },

    uname(a, c) {
      const { flags } = opts(a);
      if (flags.has('a')) c.print('Linux ubuntu 6.8.0-45-generic #45-Ubuntu SMP PREEMPT_DYNAMIC x86_64 GNU/Linux');
      else if (flags.has('r')) c.print('6.8.0-45-generic');
      else if (flags.has('m')) c.print('x86_64');
      else c.print('Linux');
    },

    uptime(a, c) {
      const d = new Date();
      const p = (x) => String(x).padStart(2, '0');
      c.print(` ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} up  2:14,  1 user,  load average: 0,42, 0,36, 0,30`);
    },

    df(a, c) {
      const { flags } = opts(a);
      if (flags.has('h'))
        c.print(
          'S.ficheros     Tamaño Usados  Disp Uso% Montado en\n' +
            'tmpfs            1,6G   2,1M  1,6G   1% /run\n' +
            '/dev/nvme0n1p2   234G    41G  181G  19% /\n' +
            'tmpfs            7,8G    84M  7,7G   2% /dev/shm\n' +
            '/dev/nvme0n1p1   1,1G   6,2M  1,1G   1% /boot/efi'
        );
      else
        c.print(
          'S.ficheros     bloques de 1K   Usados Disponibles Uso% Montado en\n' +
            'tmpfs                1630284     2148     1628136   1% /run\n' +
            '/dev/nvme0n1p2     244506940 42881032   189132484  19% /\n' +
            'tmpfs                8151412    85996     8065416   2% /dev/shm\n' +
            '/dev/nvme0n1p1       1098632     6284     1092348   1% /boot/efi'
        );
    },

    free(a, c) {
      const { flags } = opts(a);
      if (flags.has('h'))
        c.print(
          '               total       usado       libre  compartido   búf/caché  disponible\n' +
            'Mem:            15Gi       4,2Gi       7,9Gi       412Mi       3,8Gi        11Gi\n' +
            'Inter:         4,0Gi          0B       4,0Gi'
        );
      else
        c.print(
          '               total       usado       libre  compartido   búf/caché  disponible\n' +
            'Mem:        16302824     4403912     8283340      421888     3983572    11898912\n' +
            'Inter:       4194300           0     4194300'
        );
    },

    ps(a, c) {
      if (a.join('').replace('-', '').includes('aux') || a.includes('-ef'))
        c.print(
          'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n' +
            'root           1  0.0  0.0 168532 13104 ?        Ss   09:41   0:01 /sbin/init\n' +
            'root         733  0.0  0.2 1984320 38112 ?       Ssl  09:41   0:03 /usr/lib/snapd/snapd\n' +
            'root         812  0.0  0.1 338144 19004 ?        Ssl  09:41   0:01 /usr/sbin/NetworkManager\n' +
            'estudia+    2011  1.2  2.4 4812344 392120 ?      Ssl  09:42   1:07 /usr/bin/gnome-shell\n' +
            'estudia+    2950  0.0  0.0  11320  5376 pts/0    Ss   10:20   0:00 bash\n' +
            'estudia+    3104  0.0  0.0  12672  3456 pts/0    R+   10:24   0:00 ps aux'
        );
      else c.print('    PID TTY          TIME CMD\n   2950 pts/0    00:00:00 bash\n   3104 pts/0    00:00:00 ps');
    },

    top(a, c) {
      c.fail('top es interactivo y no cabe en este simulador. Prueba: ps aux');
    },

    which(a, c) {
      for (const n of a) {
        if (n === 'cd' || n === 'history' || n === 'help') continue;
        if (COMMANDS[n] && c.sh.available(n)) c.print('/usr/bin/' + n);
        else c.code = 1;
      }
    },

    history(a, c) {
      c.sh.history.forEach((h, i) => c.print(String(i + 1).padStart(5) + '  ' + h));
    },

    clear(a, c) {
      c.sh.clearScreen = true;
    },

    help(a, c) {
      const cats = {};
      for (const d of DOCS) (cats[d.cat] = cats[d.cat] || []).push(d.cmd);
      c.print('Órdenes disponibles en este simulador:\n');
      for (const k of Object.keys(cats)) c.print('  ' + (k + ':').padEnd(24) + cats[k].join('  '));
      c.print('\nEscribe «man orden» para ver qué hace cada una. Tab autocompleta; ↑ y ↓ recorren el historial.');
    },

    man(a, c) {
      if (!a.length) return c.fail('¿Qué página de manual desea?\nPor ejemplo: man ls');
      const d = DOCS.find((x) => x.cmd === a[0]);
      if (!d) return c.fail(`No hay ninguna página del manual para ${a[0]}`);
      c.print(`NOMBRE\n    ${d.cmd} — ${d.desc}\n\nEJEMPLO\n    ${d.ex}`);
    },

    nano(a, c) {
      const t = a.find((x) => x[0] !== '-');
      if (!t) return c.fail('nano: indica el archivo que quieres editar. Ejemplo: nano notas.txt');
      const p = c.path(t);
      let content = '';
      try {
        const n = c.fs.node(p, c.user);
        if (n.type === 'dir') return c.fail(`nano: ${t}: Es un directorio`);
        content = c.fs.read(p, c.user);
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        if (e.code !== 'ENOENT') return c.fail(`nano: ${t}: ${e.message}`);
      }
      c.sh.editor = { path: p, name: t, content, user: c.user };
    },

    apt(a, c) {
      const sub = a[0];
      const pk = a.slice(1).filter((x) => x[0] !== '-');
      const locked = () => {
        if (c.user === 'root') return false;
        c.fail(
          'E: No se pudo abrir el fichero de bloqueo «/var/lib/dpkg/lock-frontend» - open (13: Permiso denegado)\n' +
            'E: No se pudo obtener el bloqueo de dpkg, ¿es usted superusuario?'
        );
        return true;
      };
      const inst = c.sh.installed;
      if (sub === 'update') {
        if (locked()) return;
        c.print(
          'Obj:1 http://archive.ubuntu.com/ubuntu noble InRelease\n' +
            'Des:2 http://archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]\n' +
            'Des:3 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]\n' +
            'Descargados 252 kB en 1s (213 kB/s)\n' +
            'Leyendo lista de paquetes... Hecho\n' +
            'Se pueden actualizar 3 paquetes. Ejecute «apt list --upgradable» para verlos.'
        );
        c.sh.aptUpdated = true;
      } else if (sub === 'upgrade') {
        if (locked()) return;
        c.print(
          'Leyendo lista de paquetes... Hecho\nCalculando la actualización... Hecho\n' +
            (c.sh.aptUpdated && !c.sh.aptUpgraded
              ? 'Se actualizarán los siguientes paquetes:\n  libc6 openssl tzdata\n3 actualizados, 0 nuevos se instalarán, 0 para eliminar.\nConfigurando libc6... openssl... tzdata... Hecho'
              : '0 actualizados, 0 nuevos se instalarán, 0 para eliminar y 0 no actualizados.')
        );
        if (c.sh.aptUpdated) c.sh.aptUpgraded = true;
      } else if (sub === 'install') {
        if (!pk.length) return c.fail('E: Indica qué paquete quieres instalar. Ejemplo: sudo apt install tree');
        if (locked()) return;
        for (const p of pk) {
          if (!PACKAGES[p]) {
            c.fail(`E: No se ha podido localizar el paquete ${p}`);
            continue;
          }
          if (inst.has(p)) {
            c.print(`${p} ya está en su versión más reciente.`);
            continue;
          }
          inst.add(p);
          c.fs.write('/usr/bin/' + p, 'root', '');
          c.fs.node('/usr/bin/' + p).mode = 0o755;
          c.print(
            `Leyendo lista de paquetes... Hecho\nCreando árbol de dependencias... Hecho\n` +
              `Se instalarán los siguientes paquetes NUEVOS:\n  ${p}\n` +
              `0 actualizados, 1 nuevos se instalarán, 0 para eliminar.\n` +
              `Des:1 http://archive.ubuntu.com/ubuntu noble/universe amd64 ${p}\n` +
              `Desempaquetando ${p}...\nConfigurando ${p}...\nHecho.`
          );
        }
      } else if (sub === 'remove' || sub === 'purge') {
        if (!pk.length) return c.fail('E: Indica qué paquete quieres quitar.');
        if (locked()) return;
        for (const p of pk) {
          if (!inst.has(p)) {
            c.print(`El paquete «${p}» no está instalado, no se elimina.`);
            continue;
          }
          inst.delete(p);
          c.fs.remove('/usr/bin/' + p, 'root');
          c.print(`Desinstalando ${p}...\nHecho.`);
        }
      } else if (sub === 'list') {
        c.print('Listando... Hecho');
        for (const p of Object.keys(PACKAGES).sort())
          if (!a.includes('--installed') || inst.has(p))
            c.print(`${p}/noble ${inst.has(p) ? '[instalado]' : ''}  — ${PACKAGES[p]}`);
      } else if (sub === 'search') {
        for (const p of Object.keys(PACKAGES).sort())
          if (!pk[0] || p.includes(pk[0]) || PACKAGES[p].includes(pk[0])) c.print(`${p} — ${PACKAGES[p]}`);
      } else c.fail('Uso: apt update | upgrade | install PAQUETE | remove PAQUETE | list [--installed] | search TEXTO');
    },

    cowsay(a, c) {
      const text = a.join(' ') || (c.stdin || '').trim() || 'Muuu';
      const bar = '-'.repeat(text.length + 2);
      c.print(` ${bar.replace(/-/g, '_')}\n< ${text} >\n ${bar}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||`);
    },

    neofetch(a, c) {
      c.print(
        [
          '         _nnnn_          ' + c.user + '@' + HOST,
          '        dGGGGMMb         ------------------',
          '       @p~qp~~qMb        SO: Ubuntu 24.04 LTS x86_64',
          '       M|@||@) M|        Núcleo: 6.8.0-45-generic',
          '       @,----.JM|        Encendido: 2 horas, 14 min',
          '      JS^\\__/  qKL       Paquetes: 1842 (dpkg)',
          '     dZP        qKRb     Intérprete: bash 5.2.21',
          '    dZP          qKKb    Terminal: simulador web',
          '   fZP            SMMb   Memoria: 4,2 GiB / 15 GiB',
        ].join('\n')
      );
    },

    htop(a, c) {
      c.fail('htop está instalado, pero es interactivo y no cabe en este simulador. Prueba: ps aux');
    },
    git(a, c) {
      c.print('git versión 2.43.0 (instalado; sus órdenes quedan fuera de este simulador)');
    },
    curl(a, c) {
      c.fail('curl: este simulador no tiene red');
    },
    vim(a, c) {
      c.fail('vim está instalado, pero aquí el editor disponible es nano. Prueba: nano archivo.txt');
    },
    exit(a, c) {
      c.print('En una terminal real, exit la cierra. Aquí puedes seguir practicando.');
    },
  };
  COMMANDS['apt-get'] = COMMANDS.apt;

  /* ---------- órdenes del nivel 2 ---------- */

  const NET_IP = '192.168.1.42';
  const HOSTS = {
    localhost: '127.0.0.1',
    'ubuntu.com': '185.125.190.20',
    'ifconfig.me': '34.160.111.145',
    'wttr.in': '5.9.243.187',
    'ejemplo.org': '93.184.215.14',
  };

  /* Internet de mentira: unas pocas direcciones que responden siempre lo mismo. */
  function fetchSim(url) {
    const m = /^(?:https?:\/\/)?([^/]+)(\/.*)?$/.exec(url);
    if (!m || !HOSTS[m[1]] || m[1] === 'localhost') return null;
    const host = m[1];
    const path = m[2] || '/';
    let body = '<!doctype html>\n<html>\n  <head><title>' + host + '</title></head>\n  <body>Así ve un programa una página web: solo texto.</body>\n</html>\n';
    if (host === 'ifconfig.me') body = '203.0.113.25\n';
    else if (host === 'wttr.in') body = `Tiempo en ${decodeURIComponent(path.slice(1)) || 'tu ciudad'}: ☀️  +21 °C, viento 9 km/h\n`;
    else if (host === 'ejemplo.org' && path === '/mensaje.txt') body = 'Si lees esto, has descargado tu primer archivo desde la terminal.\n';
    else if (G.SHELL.net && Object.prototype.hasOwnProperty.call(G.SHELL.net, host + path)) body = G.SHELL.net[host + path];
    return { host, path, body };
  }

  function fieldList(spec) {
    const ranges = [];
    for (const part of String(spec).split(',')) {
      const r = /^(\d*)(-?)(\d*)$/.exec(part);
      if (!r || (!r[1] && !r[3])) return null;
      const lo = r[1] ? +r[1] : 1;
      const hi = r[2] ? (r[3] ? +r[3] : Infinity) : lo;
      ranges.push([lo, hi]);
    }
    return (i) => ranges.some(([lo, hi]) => i >= lo && i <= hi);
  }

  function tarNames(items) {
    const out = [];
    const walk = (name, n) => {
      out.push(name + (n.type === 'dir' ? '/' : ''));
      if (n.type === 'dir') for (const k of Object.keys(n.children).sort(cmp)) walk(name + '/' + k, n.children[k]);
    };
    for (const it of items) walk(it.name, it.node);
    return out;
  }

  Object.assign(COMMANDS, {
    bash(a, c) {
      if (!a.length) return c.fail('Ya estás dentro de bash. Para ejecutar un guion: bash guion.sh');
      c.sh.runFile(a, c, true);
    },

    source(a, c) {
      if (!a.length) return c.fail('source: indica el archivo. Ejemplo: source .bashrc');
      for (const l of lines(c.fs.read(c.path(a[0]), c.user))) {
        if (!l.trim() || l.trim()[0] === '#') continue;
        const r = c.sh.execLine(l, c.user);
        for (const [kind, text] of r.parts) c[kind] += text;
      }
    },

    export(a, c) {
      for (const w of a) if (/^[A-Za-z_]\w*=/.test(w)) c.sh.env[w.slice(0, w.indexOf('='))] = w.slice(w.indexOf('=') + 1);
    },

    env(a, c) {
      for (const k of Object.keys(c.sh.env)) if (!/^\d$/.test(k)) c.print(k + '=' + c.sh.env[k]);
      c.print('PWD=' + c.sh.cwd);
    },

    unset(a, c) {
      for (const k of a) delete c.sh.env[k];
    },

    alias(a, c) {
      const al = c.sh.aliases;
      if (!a.length) return Object.keys(al).sort().forEach((k) => c.print(`alias ${k}='${al[k]}'`));
      for (const w of a) {
        const i = w.indexOf('=');
        if (i > 0) al[w.slice(0, i)] = w.slice(i + 1);
        else if (Object.prototype.hasOwnProperty.call(al, w)) c.print(`alias ${w}='${al[w]}'`);
        else c.fail(`bash: alias: ${w}: no encontrado`);
      }
    },

    unalias(a, c) {
      for (const k of a) delete c.sh.aliases[k];
    },

    sleep() {},

    jobs(a, c) {
      for (const p of c.sh.procs) c.print(`[${p.job}]+  Ejecutando              ${p.cmd} &`);
    },

    kill(a, c) {
      const targets = a.filter((x) => x[0] !== '-');
      if (!targets.length) return c.fail('kill: modo de empleo: kill [-9] PID');
      const ps = c.sh.procs;
      for (const t of targets) {
        const i = t[0] === '%' ? ps.findIndex((p) => p.job === +t.slice(1)) : ps.findIndex((p) => p.pid === +t);
        if (i >= 0) {
          const p = ps.splice(i, 1)[0];
          c.print(`[${p.job}]+  Terminado               ${p.cmd}`);
        } else if (+t === 2950) c.fail('kill: ese proceso es tu propia terminal. Mejor no.');
        else if ([1, 733, 812, 2011].includes(+t))
          c.fail(c.user === 'root' ? `kill: (${t}): es un proceso del sistema y este simulador no deja pararlo` : `bash: kill: (${t}) - Operación no permitida`);
        else c.fail(`bash: kill: (${t}) - No existe el proceso`);
      }
    },

    pkill(a, c) {
      const name = a.find((x) => x[0] !== '-');
      if (!name) return c.fail('pkill: indica el nombre del programa. Ejemplo: pkill sleep');
      const before = c.sh.procs.length;
      c.sh.procs = c.sh.procs.filter((p) => !p.cmd.split(' ')[0].includes(name));
      if (c.sh.procs.length === before) c.code = 1;
    },

    ps(a, c) {
      const procs = c.sh.procs;
      if (a.join('').replace('-', '').includes('aux') || a.includes('-ef'))
        c.print(
          [
            'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
            'root           1  0.0  0.0 168532 13104 ?        Ss   09:41   0:01 /sbin/init',
            'root         733  0.0  0.2 1984320 38112 ?       Ssl  09:41   0:03 /usr/lib/snapd/snapd',
            'root         812  0.0  0.1 338144 19004 ?        Ssl  09:41   0:01 /usr/sbin/NetworkManager',
            'estudia+    2011  1.2  2.4 4812344 392120 ?      Ssl  09:42   1:07 /usr/bin/gnome-shell',
            'estudia+    2950  0.0  0.0  11320  5376 pts/0    Ss   10:20   0:00 bash',
            ...procs.map((p) => `estudia+    ${p.pid}  0.0  0.0   8292  1024 pts/0    S    10:22   0:00 ${p.cmd}`),
            'estudia+    3104  0.0  0.0  12672  3456 pts/0    R+   10:24   0:00 ps aux',
          ].join('\n')
        );
      else
        c.print(
          [
            '    PID TTY          TIME CMD',
            '   2950 pts/0    00:00:00 bash',
            ...procs.map((p) => `${String(p.pid).padStart(7)} pts/0    00:00:00 ${p.cmd.split(' ')[0]}`),
            '   3104 pts/0    00:00:00 ps',
          ].join('\n')
        );
    },

    tar(a, c) {
      const usage = 'Uso: tar -czf copia.tar.gz carpeta (crear) | tar -tf copia.tar.gz (ver) | tar -xzf copia.tar.gz (extraer)';
      if (!a.length) return c.fail(usage);
      const fl = a[0].replace(/^-/, '');
      const rest = a.slice(1);
      let into = '.';
      const ci = rest.indexOf('-C');
      if (ci >= 0) into = rest.splice(ci, 2)[1] || '.';
      if (!/^[cxtzvf]+$/.test(fl) || !fl.includes('f') || !rest.length) return c.fail(usage);
      const arch = rest.shift();
      const ap = c.path(arch);
      if (fl.includes('c')) {
        if (!rest.length) return c.fail('tar: no has dicho qué quieres empaquetar');
        const items = [];
        for (const t of rest)
          guard(c, `tar: ${t}`, () => {
            const n = c.fs.node(c.path(t), c.user);
            if (!c.fs.can(n, c.user, 4)) fail('EACCES');
            items.push({ name: base(c.path(t)), node: c.fs.clone(n) });
          });
        if (!items.length) return;
        const names = tarNames(items);
        c.fs.write(ap, c.user, `(datos comprimidos: ${names.length} elementos)\n`);
        c.fs.node(ap).archive = items;
        if (fl.includes('v')) names.forEach((x) => c.print(x));
        return;
      }
      const n = c.fs.node(ap, c.user);
      if (n.type === 'dir') fail('EISDIR');
      if (!c.fs.can(n, c.user, 4)) fail('EACCES');
      if (!n.archive) return c.fail('tar: Esto no parece un archivo tar');
      if (fl.includes('t')) return tarNames(n.archive).forEach((x) => c.print(x));
      if (!fl.includes('x')) return c.fail(usage);
      const dp = c.path(into);
      for (const it of n.archive) guard(c, `tar: ${it.name}`, () => c.fs.put((dp === '/' ? '' : dp) + '/' + it.name, c.user, c.fs.clone(it.node)));
      if (fl.includes('v')) tarNames(n.archive).forEach((x) => c.print(x));
    },

    adduser(a, c) {
      const name = a.find((x) => x[0] !== '-');
      const users = c.sh.users;
      if (!name) return c.fail('adduser: indica el nombre. Ejemplo: sudo adduser ana');
      if (c.user !== 'root') return c.fail('adduser: Solo root puede añadir un usuario o un grupo al sistema.');
      if (!/^[a-z][a-z0-9_-]*$/.test(name)) return c.fail('adduser: usa solo minúsculas, números y guiones, empezando por una letra.');
      if (Object.prototype.hasOwnProperty.call(users, name)) return c.fail(`adduser: El usuario «${name}» ya existe.`);
      const uid = ++c.sh.uidSeq;
      users[name] = uid;
      c.sh.groups[name] = [name];
      c.fs.write('/etc/passwd', 'root', `${name}:x:${uid}:${uid}:,,,:/home/${name}:/bin/bash\n`, true);
      if (!c.fs.find('/home/' + name)) {
        c.fs.mkdir('/home/' + name, 'root');
        Object.assign(c.fs.node('/home/' + name), { owner: name, group: name, mode: 0o750 });
      }
      c.print(
        `Añadiendo el usuario «${name}» ...\nAñadiendo el nuevo grupo «${name}» (${uid}) ...\n` +
          `Añadiendo el nuevo usuario «${name}» (${uid}) con grupo «${name}» ...\n` +
          `Creando el directorio personal «/home/${name}» ...\nCopiando los ficheros desde «/etc/skel» ...\n` +
          'Nueva contraseña: ********\nVuelva a escribir la nueva contraseña: ********\npasswd: contraseña actualizada correctamente'
      );
    },

    deluser(a, c) {
      const name = a.find((x) => x[0] !== '-');
      const users = c.sh.users;
      if (!name) return c.fail('deluser: indica el nombre. Ejemplo: sudo deluser ana');
      if (c.user !== 'root') return c.fail('deluser: Solo root puede eliminar un usuario o un grupo del sistema.');
      if (name === 'root' || name === USER) return c.fail(`deluser: en este simulador no se puede borrar a «${name}».`);
      if (!Object.prototype.hasOwnProperty.call(users, name)) return c.fail(`deluser: El usuario «${name}» no existe.`);
      delete users[name];
      delete c.sh.groups[name];
      const kept = lines(c.fs.read('/etc/passwd', 'root')).filter((l) => !l.startsWith(name + ':'));
      c.fs.write('/etc/passwd', 'root', kept.join('\n') + '\n');
      if (a.includes('--remove-home') && c.fs.find('/home/' + name)) c.fs.remove('/home/' + name, 'root');
      c.print(`Eliminando al usuario «${name}» ...\nHecho.`);
    },

    usermod(a, c) {
      const rest = a.filter((x) => x[0] !== '-');
      if (!a.some((x) => /^-\w*G/.test(x)) || rest.length < 2) return c.fail('Uso: sudo usermod -aG GRUPO USUARIO');
      if (c.user !== 'root') return c.fail('usermod: Permiso denegado.');
      const [group, name] = rest;
      if (!Object.prototype.hasOwnProperty.call(c.sh.users, name)) return c.fail(`usermod: el usuario «${name}» no existe`);
      const g = (c.sh.groups[name] = c.sh.groups[name] || [name]);
      if (!g.includes(group)) g.push(group);
    },

    groups(a, c) {
      const name = a[0] || c.user;
      if (!Object.prototype.hasOwnProperty.call(c.sh.users, name)) return c.fail(`groups: «${name}»: no existe ese usuario`);
      const g = name === USER ? [USER, 'adm', 'sudo'].concat((c.sh.groups[name] || []).filter((x) => ![USER, 'adm', 'sudo'].includes(x))) : c.sh.groups[name] || [name];
      c.print((a[0] ? name + ' : ' : '') + g.join(' '));
    },

    id(a, c) {
      const name = a[0] || c.user;
      if (!Object.prototype.hasOwnProperty.call(c.sh.users, name)) return c.fail(`id: «${name}»: no existe ese usuario`);
      if (name === 'root') return c.print('uid=0(root) gid=0(root) grupos=0(root)');
      if (name === USER) return c.print('uid=1000(estudiante) gid=1000(estudiante) grupos=1000(estudiante),4(adm),27(sudo)');
      const uid = c.sh.users[name];
      const extra = (c.sh.groups[name] || []).filter((g) => g !== name).map((g) => `,${g === 'sudo' ? 27 : g === 'adm' ? 4 : 1100}(${g})`);
      c.print(`uid=${uid}(${name}) gid=${uid}(${name}) grupos=${uid}(${name})${extra.join('')}`);
    },

    hostname(a, c) {
      c.print(a.includes('-I') ? NET_IP : HOST);
    },

    ip(a, c) {
      const s = a.find((x) => x[0] !== '-') || '';
      if (/^a/.test(s))
        c.print(
          '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN\n' +
            '    inet 127.0.0.1/8 scope host lo\n' +
            '2: wlp2s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n' +
            '    link/ether 3c:52:82:1a:9f:07 brd ff:ff:ff:ff:ff:ff\n' +
            `    inet ${NET_IP}/24 brd 192.168.1.255 scope global dynamic wlp2s0`
        );
      else if (/^r/.test(s))
        c.print(`default via 192.168.1.1 dev wlp2s0 proto dhcp metric 600\n192.168.1.0/24 dev wlp2s0 proto kernel scope link src ${NET_IP} metric 600`);
      else c.fail('Uso: ip a (tus direcciones) | ip r (por dónde sales a Internet)');
    },

    ping(a, c) {
      let n = 4;
      const rest = [];
      for (let i = 0; i < a.length; i++) {
        if (a[i] === '-c') n = parseInt(a[++i], 10) || 1;
        else if (a[i][0] !== '-') rest.push(a[i]);
      }
      const h = rest[0];
      if (!h) return c.fail('ping: indica a quién. Ejemplo: ping -c 3 ubuntu.com');
      const addr = /^\d+\.\d+\.\d+\.\d+$/.test(h) ? h : HOSTS[h];
      if (!addr) return c.fail(`ping: ${h}: Nombre o servicio desconocido`);
      n = Math.max(1, Math.min(n, 10));
      const local = addr.startsWith('127.') || addr.startsWith('192.168.');
      c.print(`PING ${h} (${addr}) 56(84) bytes of data.`);
      for (let k = 0; k < n; k++) {
        const t = local ? 0.04 + k / 100 : 12 + ((k * 7 + h.length * 3) % 9) + (k % 3) / 10;
        c.print(`64 bytes from ${addr}: icmp_seq=${k + 1} ttl=${local ? 64 : 56} time=${t.toFixed(local ? 2 : 1)} ms`);
      }
      c.print(`\n--- ${h} ping statistics ---\n${n} packets transmitted, ${n} received, 0% packet loss, time ${n * 1000 - 997}ms`);
    },

    curl(a, c) {
      const url = a.find((x) => x[0] !== '-');
      if (!url) return c.fail('curl: indica una dirección. Ejemplo: curl ifconfig.me');
      const r = fetchSim(url);
      if (!r) return c.fail(`curl: (6) Could not resolve host: ${url.replace(/^https?:\/\//, '').split('/')[0]}`);
      c.out += r.body;
    },

    wget(a, c) {
      const url = a.find((x) => x[0] !== '-');
      if (!url) return c.fail('wget: falta la URL. Ejemplo: wget https://ejemplo.org/mensaje.txt');
      const r = fetchSim(url);
      if (!r) return c.fail(`wget: no se pudo resolver la dirección del equipo «${url.replace(/^https?:\/\//, '').split('/')[0]}»`);
      const name = base(r.path) || 'index.html';
      c.fs.write(c.path(name), c.user, r.body);
      c.print(
        `Resolviendo ${r.host}... ${HOSTS[r.host]}\nConectando con ${r.host}:443... conectado.\n` +
          `Petición HTTP enviada, esperando respuesta... 200 OK\nLongitud: ${bytes(r.body)}\n` +
          `Guardando como: «${name}»\n\n«${name}» guardado [${bytes(r.body)}/${bytes(r.body)}]`
      );
    },

    ss(a, c) {
      c.print(
        'Netid State  Local Address:Port   Proceso\n' +
          'udp   UNCONN 127.0.0.53%lo:53     systemd-resolved\n' +
          'udp   UNCONN 0.0.0.0:5353         avahi-daemon\n' +
          'tcp   LISTEN 127.0.0.53%lo:53     systemd-resolved\n' +
          'tcp   LISTEN 127.0.0.1:631        cupsd\n' +
          'tcp   LISTEN 0.0.0.0:22           sshd'
      );
    },

    cut(a, c) {
      let d = '\t';
      let f = null;
      let ch = null;
      const files = [];
      for (let i = 0; i < a.length; i++) {
        const x = a[i];
        if (x === '-d') d = a[++i];
        else if (x.startsWith('-d')) d = x.slice(2);
        else if (x === '-f') f = a[++i];
        else if (x.startsWith('-f')) f = x.slice(2);
        else if (x === '-c') ch = a[++i];
        else if (x.startsWith('-c')) ch = x.slice(2);
        else files.push(x);
      }
      const want = fieldList(f || ch || '');
      if (!want || !d) return c.fail("cut: di qué campos quieres con -f. Ejemplo: cut -d' ' -f1");
      for (const [, text] of inputs(c, 'cut', files))
        for (const l of lines(text)) {
          if (f && !l.includes(d)) c.print(l);
          else c.print((f ? l.split(d) : Array.from(l)).filter((x, i) => want(i + 1)).join(f ? d : ''));
        }
    },
  });

  DOCS.push(
    ...[
      ['Atajos', 'alias', 'Crea un atajo para una orden larga. Sin nada, lista los que hay.', "alias ver='ls -la'"],
      ['Atajos', 'export', 'Crea una variable que también ven los programas que lances.', 'export EDITOR=nano'],
      ['Atajos', 'env', 'Muestra las variables de entorno.', 'env'],
      ['Atajos', 'source', 'Ejecuta las órdenes de un archivo en tu terminal actual.', 'source .bashrc'],
      ['Guiones', 'bash', 'Ejecuta un guion. Lo que pongas detrás llega como $1, $2…', 'bash saludo.sh Ana'],
      ['Procesos', 'jobs', 'Trabajos que has dejado en segundo plano con &.', 'jobs'],
      ['Procesos', 'kill', 'Detiene un proceso por su número (PID). -9 lo fuerza.', 'kill 3201'],
      ['Procesos', 'pkill', 'Detiene procesos por nombre.', 'pkill sleep'],
      ['Procesos', 'sleep', 'Espera unos segundos. Con & al final, en segundo plano.', 'sleep 300 &'],
      ['Comprimir', 'tar', 'Empaqueta y comprime: c crea, t lista, x extrae, z comprime, f indica el archivo.', 'tar -czf copia.tar.gz Documentos'],
      ['Usuarios', 'adduser', 'Crea un usuario con su carpeta personal (necesita sudo).', 'sudo adduser ana'],
      ['Usuarios', 'deluser', 'Borra un usuario (necesita sudo).', 'sudo deluser ana'],
      ['Usuarios', 'groups', 'Grupos a los que pertenece un usuario.', 'groups'],
      ['Usuarios', 'usermod', 'Cambia un usuario; -aG lo añade a un grupo.', 'sudo usermod -aG sudo ana'],
      ['Red', 'ip', 'Tus direcciones de red (ip a) y tu salida a Internet (ip r).', 'ip a'],
      ['Red', 'ping', 'Comprueba si un equipo responde. -c limita los intentos.', 'ping -c 3 ubuntu.com'],
      ['Red', 'curl', 'Pide una dirección web y muestra la respuesta (hay que instalarlo).', 'curl ifconfig.me'],
      ['Red', 'wget', 'Descarga un archivo de Internet.', 'wget https://ejemplo.org/mensaje.txt'],
      ['Red', 'ss', 'Puertos abiertos en tu equipo.', 'ss -tuln'],
      ['Buscar y filtrar', 'cut', 'Se queda con una columna de cada línea. -d separador, -f número de campo.', "cut -d' ' -f1 /var/log/syslog"],
    ].map(([cat, cmd, desc, ex]) => ({ cat, cmd, desc, ex }))
  );
  COMMANDS['.'] = COMMANDS.source;

  function headTail(a, c, which) {
    let n = 10;
    const files = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '-n') n = parseInt(a[++i], 10);
      else if (/^-n?\d+$/.test(a[i])) n = parseInt(a[i].replace(/^-n?/, ''), 10);
      else files.push(a[i]);
    }
    if (!(n >= 0)) return c.fail(`${which}: número de líneas inválido`);
    const ins = inputs(c, which, files);
    ins.forEach(([name, text], i) => {
      if (ins.length > 1) c.print((i ? '\n' : '') + `==> ${name} <==`);
      const ls = lines(text);
      for (const l of which === 'head' ? ls.slice(0, n) : n ? ls.slice(-n) : []) c.print(l);
    });
  }

  /* ---------- intérprete ---------- */

  class Shell {
    constructor(fs) {
      this.fs = fs;
      this.user = USER;
      this.cwd = HOME;
      this.prev = HOME;
      this.history = [];
      this.installed = new Set();
      this.env = { HOME, USER, SHELL: '/bin/bash', HOSTNAME: HOST, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' };
      this.editor = null;
      this.clearScreen = false;
      this.depth = 0;
      this.aliases = { ll: 'ls -la' };
      this.procs = [];
      this.pidSeq = 3200;
      this.users = { root: 0, [USER]: 1000 };
      this.groups = {};
      this.uidSeq = 1000;
    }

    promptPath() {
      if (this.cwd === HOME) return '~';
      if (this.cwd.startsWith(HOME + '/')) return '~' + this.cwd.slice(HOME.length);
      return this.cwd;
    }

    available(name) {
      return !PACKAGES[name] || this.installed.has(name);
    }

    variable(name) {
      if (name === 'PWD') return this.cwd;
      if (name === '?') return String(this.lastCode || 0);
      return this.env[name] || '';
    }

    /* Ejecuta una línea escrita por la persona. Devuelve la salida en orden y los avisos para la interfaz. */
    run(line) {
      line = line.trim();
      this.editor = null;
      this.clearScreen = false;
      if (!line) return { parts: [], out: '', err: '', code: 0 };
      this.history.push(line);
      const r = this.execLine(line, this.user);
      while (!this.fs.find(this.cwd)) this.cwd = this.fs.split(this.cwd)[0];
      r.out = r.parts.filter((p) => p[0] === 'out').map((p) => p[1]).join('');
      r.err = r.parts.filter((p) => p[0] === 'err').map((p) => p[1]).join('');
      r.clear = this.clearScreen;
      r.editor = this.editor;
      return r;
    }

    tokenize(s) {
      const toks = [];
      let cur = null;
      let i = 0;
      const push = () => {
        if (cur) toks.push(cur);
        cur = null;
      };
      const vars = (t) => t.replace(/\$(\w+|\?)/g, (m, n) => this.variable(n));
      while (i < s.length) {
        const ch = s[i];
        if (ch === ' ' || ch === '\t') {
          push();
          i++;
        } else if (ch === '#' && !cur) break;
        else if (ch === '|' || ch === ';') {
          push();
          toks.push({ op: ch });
          i++;
        } else if (ch === '&' && s[i + 1] === '&') {
          push();
          toks.push({ op: '&&' });
          i += 2;
        } else if (ch === '&') {
          push();
          toks.push({ op: '&' });
          i++;
        } else if (ch === '>') {
          let op = '>';
          if (cur && cur.raw && cur.v === '2') {
            cur = null;
            op = '2>';
          }
          push();
          if (s[i + 1] === '>') {
            if (op === '>') op = '>>';
            i++;
          }
          toks.push({ op });
          i++;
        } else {
          cur = cur || { v: '', raw: true };
          if (ch === "'" || ch === '"') {
            const j = s.indexOf(ch, i + 1);
            if (j < 0) throw new Error('faltan unas comillas de cierre (' + ch + ')');
            const inner = s.slice(i + 1, j);
            cur.v += ch === '"' ? vars(inner) : inner;
            cur.raw = false;
            i = j + 1;
          } else if (ch === '\\' && i + 1 < s.length) {
            cur.v += s[i + 1];
            cur.raw = false;
            i += 2;
          } else if (ch === '$') {
            const m = /^\$(\w+|\?)/.exec(s.slice(i));
            if (m) {
              cur.v += this.variable(m[1]);
              i += m[0].length;
            } else {
              cur.v += ch;
              i++;
            }
          } else {
            cur.v += ch;
            i++;
          }
        }
      }
      push();
      return toks;
    }

    glob(word, user) {
      const i = word.lastIndexOf('/');
      const dir = word.slice(0, i + 1);
      const pat = word.slice(i + 1);
      if (/[*?]/.test(dir)) return [word];
      let ch;
      try {
        ch = this.fs.list(this.fs.abs(this.cwd, dir), user);
      } catch (e) {
        return [word];
      }
      const re = globRe(pat);
      const hits = Object.keys(ch).filter((k) => re.test(k) && (pat[0] === '.' || k[0] !== '.')).sort(cmp);
      return hits.length ? hits.map((k) => dir + k) : [word];
    }

    /* Parte la línea en órdenes separadas por ; && y &, respetando las comillas.
       Cada orden se interpreta justo antes de ejecutarse, para que vea las variables de la anterior. */
    splitLine(s) {
      const out = [];
      let cur = '';
      let q = null;
      let depth = 0;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (q) {
          cur += ch;
          if (ch === q) q = null;
        } else if (ch === '\\' && i + 1 < s.length) cur += ch + s[++i];
        else if (ch === '$' && s[i + 1] === '(') {
          depth++;
          cur += '$(';
          i++;
        } else if (depth) {
          if (ch === ')') depth--;
          cur += ch;
        } else if (ch === '|' && s[i + 1] === '|') {
          out.push([cur, '||']);
          cur = '';
          i++;
        }
        else if (ch === "'" || ch === '"') {
          q = ch;
          cur += ch;
        } else if (ch === '#' && (!cur || /\s$/.test(cur))) break;
        else if (ch === ';') {
          out.push([cur, ';']);
          cur = '';
        } else if (ch === '&' && s[i + 1] === '&') {
          out.push([cur, '&&']);
          cur = '';
          i++;
        } else if (ch === '&' && !/>\s*$/.test(cur)) {
          out.push([cur, '&']);
          cur = '';
        } else cur += ch;
      }
      out.push([cur, '']);
      /* Un «if … fi» o un «for … done» es una sola orden aunque lleve puntos y coma dentro. */
      const merged = [];
      let open = 0;
      let acc = null;
      for (const [t, sep] of out) {
        const w = t.trim();
        const opens = /^(?:(?:then|else|do)\s+)?(?:if|for)\s/.test(w);
        if (!open && !opens) {
          merged.push([t, sep]);
          continue;
        }
        if (opens) open++;
        if (/^(?:fi|done)$/.test(w)) open--;
        acc = (acc === null ? '' : acc) + t;
        if (open > 0) acc += (sep || ';') + ' ';
        else {
          merged.push([acc, sep]);
          acc = null;
        }
      }
      if (acc !== null) merged.push([acc.replace(/[;&|\s]+$/, ''), '']);
      return merged;
    }

    /* Palabras de un texto, con ~ y comodines ya resueltos. */
    expand(text, user) {
      const out = [];
      for (const t of this.tokenize(text)) {
        if (t.op) continue;
        let v = t.v;
        if (t.raw && (v === '~' || v.startsWith('~/'))) v = HOME + v.slice(1);
        if (t.raw && /[*?]/.test(v)) out.push(...this.glob(v, user));
        else out.push(v);
      }
      return out;
    }

    /* $(orden): ejecuta la orden y pone su salida en ese sitio. */
    subst(text, user, res) {
      let out = '';
      let q = null;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q === "'") {
          out += ch;
          if (ch === "'") q = null;
        } else if (ch === '\\' && i + 1 < text.length) out += ch + text[++i];
        else if (ch === "'" && !q) {
          q = "'";
          out += ch;
        } else if (ch === '"') {
          q = q ? null : '"';
          out += ch;
        } else if (ch === '$' && text[i + 1] === '(') {
          let d = 1;
          let j = i + 2;
          for (; j < text.length && d; j++) {
            if (text[j] === '(') d++;
            else if (text[j] === ')') d--;
          }
          if (d) {
            out += ch;
            continue;
          }
          const r = this.execLine(text.slice(i + 2, j - 1), user);
          for (const p of r.parts) if (p[0] === 'err') res.parts.push(p);
          out += r.parts
            .filter((p) => p[0] === 'out')
            .map((p) => p[1])
            .join('')
            .replace(/\x01.|\x02/g, '')
            .replace(/\n+$/, '')
            .replace(/\n/g, ' ');
          i = j - 1;
        } else out += ch;
      }
      return out;
    }

    execLine(line, user) {
      const res = { parts: [], code: 0 };
      /* Bucle en una línea: for x in lista; do orden; done */
      const loop = /^\s*for\s+(\w+)\s+in\s+(.*?)\s*;\s*do\s+(.*?)\s*;?\s*done\s*$/.exec(line);
      if (loop && this.depth < 6) {
        let items;
        try {
          items = this.expand(this.subst(loop[2], user, res), user);
        } catch (e) {
          res.parts.push(['err', 'bash: ' + e.message + '\n']);
          res.code = 2;
          return res;
        }
        this.depth++;
        try {
          for (const it of items.slice(0, 200)) {
            this.env[loop[1]] = it;
            const r = this.execLine(loop[3], user);
            res.parts.push(...r.parts);
            res.code = r.code;
          }
        } finally {
          this.depth--;
        }
        return res;
      }
      /* Condición en una línea: if orden; then ...; else ...; fi */
      const cond = /^\s*if\s+(.+?)\s*;\s*then\s+(.+?)(?:\s*;\s*else\s+(.+?))?\s*;?\s*fi\s*$/.exec(line);
      if (cond && this.depth < 6) {
        const t = this.execLine(cond[1], user);
        res.parts.push(...t.parts);
        const branch = t.code === 0 ? cond[2] : cond[3];
        this.depth++;
        try {
          if (branch) {
            const r = this.execLine(branch, user);
            res.parts.push(...r.parts);
            res.code = r.code;
          }
        } finally {
          this.depth--;
        }
        this.lastCode = res.code;
        return res;
      }
      let skip = false;
      for (const [raw, sep] of this.splitLine(line)) {
        if (raw.trim() && !skip && /^\s*(if|for)\s/.test(raw) && raw.trim() !== line.trim()) {
          const r = this.execLine(raw, user);
          res.parts.push(...r.parts);
          res.code = r.code;
          this.lastCode = r.code;
        } else if (raw.trim() && !skip) {
          let toks;
          try {
            const text = raw.includes('$(') ? this.subst(raw, user, res) : raw;
            toks = this.tokenize(text);
          } catch (e) {
            res.parts.push(['err', 'bash: ' + e.message + '\n']);
            res.code = 2;
            return res;
          }
          if (toks.length) {
            const r = sep === '&' && toks[0].v === 'sleep' ? this.background(toks) : this.pipeline(toks, user);
            if (r.err) res.parts.push(['err', r.err]);
            if (r.out) res.parts.push(['out', r.out]);
            res.code = r.code;
            this.lastCode = r.code;
          }
        }
        skip = sep === '&&' ? res.code !== 0 : sep === '||' ? res.code === 0 : false;
      }
      return res;
    }

    /* orden &: la deja en marcha como trabajo en segundo plano. */
    background(seg) {
      const cmd = seg.filter((t) => !t.op).map((t) => t.v).join(' ');
      const job = this.procs.reduce((m, p) => Math.max(m, p.job), 0) + 1;
      const pid = ++this.pidSeq;
      this.procs.push({ job, pid, cmd });
      return { out: `[${job}] ${pid}\n`, err: '', code: 0 };
    }

    pipeline(toks, user) {
      const cmds = [[]];
      for (const t of toks) {
        if (t.op === '|') cmds.push([]);
        else cmds[cmds.length - 1].push(t);
      }
      let stdin = null;
      let err = '';
      let last = { out: '', code: 0 };
      cmds.forEach((cmd, i) => {
        last = this.command(cmd, stdin, i === cmds.length - 1, user);
        err += last.err;
        stdin = last.out;
      });
      return { out: last.out, err, code: last.code };
    }

    command(toks, stdin, isLast, baseUser) {
      const words = [];
      let redir = null;
      let dropErr = false;
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.op) {
          const target = toks[++i];
          if (!target || target.op) return { out: '', err: 'bash: error sintáctico: falta el archivo después de «' + t.op + '»\n', code: 2 };
          if (t.op === '2>') dropErr = true;
          else redir = { path: target.v, append: t.op === '>>' };
          continue;
        }
        let v = t.v;
        if (t.raw && (v === '~' || v.startsWith('~/'))) v = HOME + v.slice(1);
        if (t.raw && /[*?]/.test(v)) words.push(...this.glob(v, baseUser));
        else words.push(v);
      }
      if (redir && (redir.path === '~' || redir.path.startsWith('~/'))) redir.path = HOME + redir.path.slice(1);

      if (words.length && words.every((w) => /^[A-Za-z_]\w*=/.test(w))) {
        for (const w of words) this.env[w.slice(0, w.indexOf('='))] = w.slice(w.indexOf('=') + 1);
        return { out: '', err: '', code: 0 };
      }
      const al = words.length ? this.aliases[words[0]] : null;
      if (al && Object.prototype.hasOwnProperty.call(this.aliases, words[0]))
        words.splice(0, 1, ...this.tokenize(al).filter((t) => !t.op).map((t) => t.v));

      const sh = this;
      const c = {
        sh,
        fs: this.fs,
        user: baseUser,
        stdin,
        tty: isLast && !redir,
        out: '',
        err: '',
        code: null,
        print(s) {
          this.out += s + '\n';
        },
        fail(s) {
          this.err += s + '\n';
        },
        path(p) {
          return sh.fs.abs(sh.cwd, p);
        },
      };

      let argv = words;
      if (argv[0] === 'sudo') {
        argv = argv.slice(1);
        let target = 'root';
        while (argv[0] && argv[0][0] === '-') {
          if (argv[0] === '-u') {
            target = argv[1] || '';
            argv = argv.slice(2);
          } else argv = argv.slice(1);
        }
        if (!Object.prototype.hasOwnProperty.call(this.users, target)) {
          c.fail(`sudo: usuario desconocido ${target}`);
          argv = [];
        } else if (!argv.length || argv[0] === 'su' || (argv[0] === 'bash' && argv.length === 1)) {
          c.fail('En este simulador, sudo se pone delante de la orden que quieres ejecutar como administrador.\nEjemplo: sudo apt update');
          argv = [];
        } else if (argv[0] === 'cd') {
          c.fail('sudo: cd: orden no encontrada\n(cd pertenece a la propia terminal; no se puede lanzar con sudo)');
          argv = [];
        } else c.user = target;
      }

      if (argv.length) {
        const name = argv[0];
        try {
          if (name.includes('/')) this.runFile(argv, c);
          else if (!COMMANDS[name]) {
            const found = this.lookPath(name, c.user);
            if (found) this.runFile([found].concat(argv.slice(1)), c);
            else {
              c.fail(`${name}: orden no encontrada`);
              c.code = 127;
            }
          } else if (!this.available(name)) {
            c.fail(`No se ha encontrado la orden «${name}», pero se puede instalar con:\nsudo apt install ${name}`);
            c.code = 127;
          } else COMMANDS[name](argv.slice(1), c);
        } catch (e) {
          if (!(e instanceof FsError)) throw e;
          c.fail(`${name}: ${e.message}`);
        }
      }

      let out = c.out;
      if (redir) {
        if (redir.path !== '/dev/null') {
          try {
            /* Como en bash: la redirección la hace tu usuario, no sudo. */
            this.fs.write(this.fs.abs(this.cwd, redir.path), baseUser, out, redir.append);
          } catch (e) {
            if (!(e instanceof FsError)) throw e;
            c.fail(`bash: ${redir.path}: ${e.message}`);
          }
        }
        out = '';
      }
      const err = dropErr ? '' : c.err;
      return { out, err, code: c.code !== null ? c.code : c.err ? 1 : 0 };
    }

    /* Busca un programa propio (un guion ejecutable) en las carpetas de $PATH. */
    lookPath(name, user) {
      for (let dir of String(this.env.PATH || '').split(':')) {
        if (!dir) continue;
        if (dir === '~' || dir.startsWith('~/')) dir = HOME + dir.slice(1);
        const p = this.fs.abs('/', dir + '/' + name);
        const n = this.fs.find(p, user);
        if (n && n.type === 'file' && this.fs.can(n, user, 1) && n.content.trim()) return p;
      }
      return null;
    }

    /* ./programa: ejecuta un guion línea a línea si tiene permiso de ejecución. */
    runFile(argv, c, noExec) {
      const t = argv[0];
      let n;
      try {
        n = this.fs.node(c.path(t), c.user);
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        c.code = 127;
        return c.fail(`bash: ${t}: ${e.message}`);
      }
      if (n.type === 'dir') return c.fail(`bash: ${t}: Es un directorio`);
      const canRun = c.user === 'root' ? n.mode & 0o111 : this.fs.can(n, c.user, 1);
      if (!canRun && !noExec) {
        c.code = 126;
        return c.fail(`bash: ${t}: Permiso denegado`);
      }
      if (this.depth > 4) return c.fail(`bash: ${t}: demasiados guiones anidados`);
      this.depth++;
      const saved = {};
      for (let i = 0; i < 10; i++) {
        saved[i] = this.env[i];
        this.env[i] = i < argv.length ? argv[i] : '';
      }
      try {
        for (const l of lines(n.content)) {
          if (!l.trim() || l.trim()[0] === '#') continue;
          const r = this.execLine(l, c.user);
          for (const [kind, text] of r.parts) c[kind] += text;
        }
      } finally {
        this.depth--;
        for (let i = 0; i < 10; i++) {
          if (saved[i] === undefined) delete this.env[i];
          else this.env[i] = saved[i];
        }
      }
    }

    /* Autocompletado con Tab: órdenes en la primera palabra, rutas en el resto. */
    complete(line) {
      const word = /(\S*)$/.exec(line)[1];
      const head = line.slice(0, line.length - word.length);
      const first = (!head.trim() || /(\||;|&&|sudo)\s*$/.test(head)) && !word.includes('/');
      let dir = '';
      let cands;
      if (first) {
        cands = Object.keys(COMMANDS)
          .filter((k) => k.startsWith(word) && this.available(k))
          .sort()
          .map((k) => [k, k + ' ']);
      } else {
        const i = word.lastIndexOf('/');
        dir = word.slice(0, i + 1);
        const pre = word.slice(i + 1);
        const real = dir === '~/' || dir.startsWith('~/') ? HOME + dir.slice(1) : dir;
        let ch;
        try {
          ch = this.fs.list(this.fs.abs(this.cwd, real), this.user);
        } catch (e) {
          return { line, options: [] };
        }
        cands = Object.keys(ch)
          .filter((k) => k.startsWith(pre) && (pre[0] === '.' || k[0] !== '.'))
          .sort(cmp)
          .map((k) => [k, k + (ch[k].type === 'dir' ? '/' : ' ')]);
      }
      if (!cands.length) return { line, options: [] };
      if (cands.length === 1) return { line: head + dir + cands[0][1], options: [] };
      let common = cands[0][0];
      for (const [k] of cands) while (!k.startsWith(common)) common = common.slice(0, -1);
      return { line: head + dir + common, options: cands.map((x) => x[0]) };
    }
  }

  /* net: archivos extra que «existen» en la red simulada, como 'ejemplo.org/bandera.txt'. */
  G.SHELL = { Shell, DOCS, PACKAGES, HOST, HOSTS, COMMANDS, net: {}, util: { opts, guard, inputs, lines, bytes, base, cmp, escRe, globRe, mark } };
})(typeof window !== 'undefined' ? window : globalThis);
