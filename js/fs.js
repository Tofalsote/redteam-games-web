/* Sistema de archivos virtual: un árbol en memoria con dueños y permisos. */
(function (G) {
  'use strict';

  const USER = 'estudiante';
  const HOME = '/home/' + USER;

  const MSG = {
    ENOENT: 'No existe el archivo o el directorio',
    EACCES: 'Permiso denegado',
    ENOTDIR: 'No es un directorio',
    EISDIR: 'Es un directorio',
    EEXIST: 'El archivo ya existe',
    ENOTEMPTY: 'El directorio no está vacío',
    EPERM: 'Operación no permitida',
    EINVAL: 'Argumento inválido',
  };

  class FsError extends Error {
    constructor(code) {
      super(MSG[code] || code);
      this.code = code;
    }
  }
  function fail(code) {
    throw new FsError(code);
  }

  function D(children, owner = 'root', mode = 0o755) {
    return { type: 'dir', owner, group: owner, mode, mtime: Date.now(), children: children || {} };
  }
  function F(content = '', owner = 'root', mode = 0o644) {
    return { type: 'file', owner, group: owner, mode, mtime: Date.now(), content };
  }

  const SYSLOG = [
    'nov 15 09:58:01 ubuntu systemd[1]: Started Daily apt download activities.',
    'nov 15 09:58:14 ubuntu kernel: usb 1-2: new high-speed USB device number 4 using xhci_hcd',
    'nov 15 09:58:15 ubuntu kernel: usb-storage 1-2:1.0: USB Mass Storage device detected',
    'nov 15 10:01:22 ubuntu NetworkManager[812]: <info> device (wlp2s0): state change: connected',
    'nov 15 10:02:47 ubuntu sshd[1543]: Accepted password for estudiante from 192.168.1.20 port 51122 ssh2',
    'nov 15 10:03:05 ubuntu cups[901]: error: unable to open printer configuration',
    'nov 15 10:05:31 ubuntu systemd[1]: Starting Cleanup of Temporary Directories...',
    'nov 15 10:07:12 ubuntu kernel: Error: thermal sensor reading out of range',
    'nov 15 10:09:40 ubuntu sshd[1602]: Failed password for invalid user admin from 203.0.113.7 port 40022 ssh2',
    'nov 15 10:09:44 ubuntu sshd[1602]: Failed password for invalid user admin from 203.0.113.7 port 40022 ssh2',
    'nov 15 10:12:03 ubuntu snapd[733]: error: cannot refresh snap "firefox": network unreachable',
    'nov 15 10:15:18 ubuntu systemd[1]: Finished Cleanup of Temporary Directories.',
    'nov 15 10:17:55 ubuntu gnome-shell[2011]: ERROR: extension failed to load',
    'nov 15 10:20:00 ubuntu CRON[2140]: (root) CMD (run-parts /etc/cron.hourly)',
  ].join('\n') + '\n';

  function baseTree() {
    const u = USER;
    const bins = {};
    ['bash', 'cat', 'cp', 'grep', 'ls', 'mkdir', 'mv', 'nano', 'rm', 'sudo', 'apt'].forEach((b) => {
      bins[b] = F('', 'root', 0o755);
    });
    return D({
      bin: D({ bash: F('', 'root', 0o755), ls: F('', 'root', 0o755) }),
      etc: D({
        hostname: F('ubuntu\n'),
        hosts: F('127.0.0.1 localhost\n127.0.1.1 ubuntu\n'),
        'os-release': F(
          'PRETTY_NAME="Ubuntu 24.04 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\n' +
            'VERSION="24.04 LTS (Noble Numbat)"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\n'
        ),
        passwd: F(
          'root:x:0:0:root:/root:/bin/bash\n' +
            'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\n' +
            'estudiante:x:1000:1000:Estudiante:/home/estudiante:/bin/bash\n'
        ),
        shadow: F(
          'root:!:19800:0:99999:7:::\n' +
            'estudiante:$y$j9T$ejemplo$hashDeLaContraseñaQueNadieDebeVer:19800:0:99999:7:::\n',
          'root',
          0o640
        ),
        apt: D({
          'sources.list': F('deb http://archive.ubuntu.com/ubuntu noble main universe\n'),
        }),
      }),
      home: D({
        [u]: D(
          {
            '.bashrc': F('# Configuración de tu terminal\nalias ll="ls -l"\n', u),
            '.perfil-secreto': F('Los archivos que empiezan por punto están ocultos.\n', u),
            Documentos: D(
              {
                'notas.txt': F(
                  'Notas de mi primer día con Linux\n' +
                    '- La terminal no muerde.\n' +
                    '- Todo en Linux es un archivo.\n' +
                    '- pwd me dice dónde estoy.\n' +
                    '- ls me enseña qué hay.\n',
                  u
                ),
                'lista-compra.txt': F('tomates\narroz\ncafé\nmanzanas\npan\narroz\nleche\n', u),
              },
              u
            ),
            Descargas: D(
              {
                'manual-ubuntu.pdf': F('%PDF-1.7 (contenido binario simulado)\n', u),
                'fondo.jpg': F('(imagen simulada)\n', u),
              },
              u
            ),
            Escritorio: D({}, u),
            Imágenes: D({ 'vacaciones.png': F('(imagen simulada)\n', u) }, u),
          },
          u,
          0o750
        ),
      }),
      root: D({}, 'root', 0o700),
      tmp: D({}, 'root', 0o777),
      usr: D({ bin: D(bins), share: D({}) }),
      var: D({
        log: D({
          syslog: F(SYSLOG),
          'auth.log': F(
            'nov 15 10:09:40 ubuntu sshd[1602]: Failed password for invalid user admin\n' +
              'nov 15 10:21:07 ubuntu sudo: estudiante : TTY=pts/0 ; COMMAND=/usr/bin/apt update\n',
            'root',
            0o640
          ),
        }),
      }),
    });
  }

  class Vfs {
    constructor() {
      this.root = baseTree();
    }

    /* Ruta absoluta y normalizada a partir del directorio actual. */
    abs(cwd, p) {
      if (!p) return cwd;
      const parts = (p[0] === '/' ? p : cwd + '/' + p).split('/');
      const out = [];
      for (const s of parts) {
        if (!s || s === '.') continue;
        if (s === '..') out.pop();
        else out.push(s);
      }
      return '/' + out.join('/');
    }

    /* bit: 4 leer, 2 escribir, 1 ejecutar/entrar */
    can(node, user, bit) {
      if (user === 'root') return true;
      const shift = node.owner === user ? 6 : node.group === user ? 3 : 0;
      return !!((node.mode >> shift) & bit);
    }

    node(abs, user = 'root') {
      let n = this.root;
      if (abs === '/') return n;
      for (const s of abs.slice(1).split('/')) {
        if (n.type !== 'dir') fail('ENOTDIR');
        if (!this.can(n, user, 1)) fail('EACCES');
        n = n.children[s];
        if (!n) fail('ENOENT');
      }
      return n;
    }

    find(abs, user = 'root') {
      try {
        return this.node(abs, user);
      } catch (e) {
        return null;
      }
    }

    split(abs) {
      const i = abs.lastIndexOf('/');
      return [abs.slice(0, i) || '/', abs.slice(i + 1)];
    }

    parent(abs, user) {
      const [d, name] = this.split(abs);
      const p = this.node(d, user);
      if (p.type !== 'dir') fail('ENOTDIR');
      if (!this.can(p, user, 1)) fail('EACCES');
      return [p, name];
    }

    list(abs, user) {
      const n = this.node(abs, user);
      if (n.type !== 'dir') fail('ENOTDIR');
      if (!this.can(n, user, 4)) fail('EACCES');
      return n.children;
    }

    read(abs, user) {
      const n = this.node(abs, user);
      if (n.type === 'dir') fail('EISDIR');
      if (!this.can(n, user, 4)) fail('EACCES');
      return n.content;
    }

    write(abs, user, content, append) {
      if (abs === '/') fail('EISDIR');
      const [p, name] = this.parent(abs, user);
      const n = p.children[name];
      if (n) {
        if (n.type === 'dir') fail('EISDIR');
        if (!this.can(n, user, 2)) fail('EACCES');
        n.content = append ? n.content + content : content;
        n.mtime = Date.now();
      } else {
        if (!this.can(p, user, 2)) fail('EACCES');
        p.children[name] = F(content, user, 0o664);
      }
    }

    mkdir(abs, user) {
      if (abs === '/') fail('EEXIST');
      const [p, name] = this.parent(abs, user);
      if (p.children[name]) fail('EEXIST');
      if (!this.can(p, user, 2)) fail('EACCES');
      p.children[name] = D({}, user, 0o775);
    }

    remove(abs, user) {
      if (abs === '/') fail('EPERM');
      const [p, name] = this.parent(abs, user);
      if (!p.children[name]) fail('ENOENT');
      if (!this.can(p, user, 2)) fail('EACCES');
      delete p.children[name];
    }

    put(abs, user, node) {
      if (abs === '/') fail('EEXIST');
      const [p, name] = this.parent(abs, user);
      if (!this.can(p, user, 2)) fail('EACCES');
      p.children[name] = node;
    }

    clone(node, owner) {
      const c = Object.assign({}, node, { mtime: Date.now() });
      if (owner) {
        c.owner = owner;
        c.group = owner;
      }
      if (node.type === 'dir') {
        c.children = {};
        for (const k of Object.keys(node.children)) c.children[k] = this.clone(node.children[k], owner);
      }
      return c;
    }

    /* Todas las rutas existentes (para detectar qué es nuevo en el explorador). */
    allPaths() {
      const out = new Set();
      const walk = (p, n) => {
        out.add(p);
        if (n.type === 'dir')
          for (const k of Object.keys(n.children)) walk((p === '/' ? '' : p) + '/' + k, n.children[k]);
      };
      walk('/', this.root);
      return out;
    }
  }

  function modeStr(node) {
    const b = 'rwxrwxrwx';
    const a = (node.type === 'dir' ? 'd' : '-').split('');
    for (let i = 0; i < 9; i++) a.push(node.mode & (1 << (8 - i)) ? b[i] : '-');
    /* setuid / setgid / sticky: cambian la x por s/S/t/T, como en un Linux real */
    if (node.mode & 0o4000) a[3] = node.mode & 0o100 ? 's' : 'S';
    if (node.mode & 0o2000) a[6] = node.mode & 0o010 ? 's' : 'S';
    if (node.mode & 0o1000) a[9] = node.mode & 0o001 ? 't' : 'T';
    return a.join('');
  }

  G.VFS = { Vfs, FsError, fail, modeStr, USER, HOME };
})(typeof window !== 'undefined' ? window : globalThis);
