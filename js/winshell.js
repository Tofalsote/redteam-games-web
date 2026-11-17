/* Motor del mundo Windows: una shell simulada (cmd/PowerShell) sobre una máquina Windows vulnerable,
   con las técnicas de escalada de privilegios de Windows (tokens, servicios, credenciales, registro).
   Todo es simulado: ninguna técnica funciona fuera de esta página. */
(function (G) {
  'use strict';

  const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
  const lc = (s) => String(s).toLowerCase();
  const nrm = (s) => lc(s).replace(/\\+$/, ''); // ruta en minúsculas sin barra final

  /* Descripciones de los privilegios de token (lo que enseña whoami /priv). */
  const PRIV_DESC = {
    SeImpersonatePrivilege: 'Impersonate a client after authentication',
    SeAssignPrimaryTokenPrivilege: 'Replace a process level token',
    SeBackupPrivilege: 'Back up files and directories',
    SeRestorePrivilege: 'Restore files and directories',
    SeDebugPrivilege: 'Debug programs',
    SeTakeOwnershipPrivilege: 'Take ownership of files or other objects',
    SeLoadDriverPrivilege: 'Load and unload device drivers',
    SeChangeNotifyPrivilege: 'Bypass traverse checking',
    SeShutdownPrivilege: 'Shut down the system',
    SeIncreaseWorkingSetPrivilege: 'Increase a process working set',
    SeManageVolumePrivilege: 'Perform volume maintenance tasks',
  };
  /* Privilegios que, bien explotados, llevan a SYSTEM. */
  const JUICY = ['SeImpersonatePrivilege', 'SeAssignPrimaryTokenPrivilege', 'SeBackupPrivilege', 'SeRestorePrivilege', 'SeDebugPrivilege', 'SeTakeOwnershipPrivilege', 'SeLoadDriverPrivilege'];

  /* ---------- la máquina ---------- */

  function buildBox(win, spec) {
    spec = spec || {};
    win.host = spec.host || 'CLIENTE01';
    win.user = spec.user || 'thomas';
    win.domain = spec.domain || win.host;
    win.integrity = spec.integrity || 'Medium';
    win.admin = false;
    win.system = false;
    win.owned = new Set([win.user]);
    win.cwd = spec.cwd || 'C:\\Users\\' + win.user;
    win.priv = new Set(['SeChangeNotifyPrivilege', 'SeIncreaseWorkingSetPrivilege'].concat(spec.priv || []));
    win.services = spec.services || {};
    win.reg = Object.assign({}, spec.reg || {});
    win.creds = spec.creds || [];
    win.users = Object.assign({ Administrator: { admin: true }, [win.user]: { admin: false }, Guest: { admin: false, disabled: true } }, spec.extraUsers || {});
    win.tasks = spec.tasks || [];
    win.history = win.history || [];
    win.env = Object.assign({ USERNAME: win.user, USERDOMAIN: win.domain, COMPUTERNAME: win.host, USERPROFILE: 'C:\\Users\\' + win.user, 'PATH': 'C:\\Windows\\system32;C:\\Windows' }, spec.env || {});
    win.hotfixes = spec.hotfixes || ['KB5004331', 'KB5003791'];
    win.writable = new Set((spec.writable || []).map(nrm)); // carpetas que el usuario puede escribir
    /* sistema de archivos: mapa ruta(min) -> {content, adminOnly} */
    win.fs = {};
    win.fs['c:\\users\\' + lc(win.user) + '\\desktop\\notas.txt'] = { content: 'recordar: pedir acceso al servidor de ficheros\r\n' };
    for (const f of spec.files || []) win.fs[lc(f.path)] = { content: f.content, adminOnly: !!f.adminOnly };
    win.vector = spec.vector || null; // pista interna de cuál es el camino (para la ayuda)
    return win;
  }

  /* ---------- utilidades de salida ---------- */

  function result(parts) {
    const r = { parts, clear: false, editor: null };
    r.out = parts.filter((p) => p[0] === 'out').map((p) => p[1]).join('');
    r.err = parts.filter((p) => p[0] === 'err').map((p) => p[1]).join('');
    r.code = parts.some((p) => p[0] === 'err') ? 1 : 0;
    return r;
  }
  const O = (s) => ['out', s + '\r\n'];
  const E = (s) => ['err', s + '\r\n'];

  function elevate(win, level) {
    if (level === 'system') {
      win.system = true;
      win.admin = true;
      win.integrity = 'System';
      win.owned.add('SYSTEM');
    } else {
      win.admin = true;
      win.integrity = 'High';
      win.owned.add('Administrator');
    }
  }
  const whoamiStr = (win) => (win.system ? 'nt authority\\system' : lc(win.domain) + '\\' + lc(win.admin ? 'administrator' : win.user));

  /* ---------- órdenes ---------- */

  const C = {};

  C.whoami = function (a, win) {
    const f = lc(a[0] || '');
    if (!f || f === '/upn') return [O(whoamiStr(win))];
    if (f === '/priv' || f === '/all') {
      const rows = [
        'PRIVILEGES INFORMATION',
        '----------------------',
        '',
        'Privilege Name                  Description                                        State',
        '=============================== ================================================== ========',
      ];
      const list = win.system ? Object.keys(PRIV_DESC) : Array.from(win.priv);
      for (const p of list) rows.push(pad(p, 32) + pad(PRIV_DESC[p] || p, 51) + (win.system ? 'Enabled' : 'Enabled'));
      if (f === '/all') return C.whoami(['/groups'], win).concat([[['out', '\r\n']][0]], [O(rows.join('\r\n'))]);
      return [O(rows.join('\r\n'))];
    }
    if (f === '/groups') {
      const rows = ['GROUP INFORMATION', '-----------------', '', 'Group Name                             Type             Attributes', '====================================== ================ =================='];
      rows.push(pad('Everyone', 38) + 'Well-known group Mandatory group, Enabled');
      rows.push(pad('BUILTIN\\Users', 38) + 'Alias            Mandatory group, Enabled');
      if (win.admin || win.system) rows.push(pad('BUILTIN\\Administrators', 38) + 'Alias            Mandatory group, Enabled');
      rows.push(pad('Mandatory Label\\' + (win.system ? 'System' : win.admin ? 'High' : 'Medium') + ' Mandatory Level', 38) + 'Label');
      return [O(rows.join('\r\n'))];
    }
    return [E('ERROR: Invalid argument/option - ' + "'" + a[0] + "'.")];
  };

  C.hostname = (a, win) => [O(win.host)];
  C.ver = () => [O('\r\nMicrosoft Windows [Version 10.0.19045.3803]\r\n')];

  C.systeminfo = (a, win) => [
    O(
      [
        'Host Name:                 ' + win.host,
        'OS Name:                   Microsoft Windows 10 Pro',
        'OS Version:                10.0.19045 N/A Build 19045',
        'System Type:               x64-based PC',
        'Domain:                    ' + win.domain,
        'Hotfix(s):                 ' + win.hotfixes.length + ' Hotfix(s) Installed.',
      ]
        .concat(win.hotfixes.map((h, i) => '                           [' + (i + 1).toString().padStart(2, '0') + ']: ' + h))
        .join('\r\n')
    ),
  ];

  C.set = (a, win) => {
    if (a[0]) {
      const k = Object.keys(win.env).find((x) => lc(x) === lc(a[0].replace(/=$/, '')));
      return k ? [O(k + '=' + win.env[k])] : [E('Environment variable ' + a[0] + ' not defined')];
    }
    return [O(Object.keys(win.env).map((k) => k + '=' + win.env[k]).join('\r\n'))];
  };

  C.hostname;
  C['net'] = function (a, win) {
    const sub = lc(a[0] || '');
    if (sub === 'user' && !a[1]) {
      return [O('User accounts for \\\\' + win.host + '\r\n\r\n-------------------------------------------------------------------------------\r\n' + Object.keys(win.users).map((u) => pad(u, 25)).join('') + '\r\nThe command completed successfully.')];
    }
    if (sub === 'user' && a[1]) {
      const u = Object.keys(win.users).find((x) => lc(x) === lc(a[1]));
      if (!u) return [E('The user name could not be found.')];
      const adm = win.users[u].admin;
      return [O(['User name                    ' + u, 'Account active               ' + (win.users[u].disabled ? 'No' : 'Yes'), 'Local Group Memberships      ' + (adm ? '*Administrators       *Users' : '*Users'), 'The command completed successfully.'].join('\r\n'))];
    }
    if (sub === 'localgroup' && lc(a[1] || '') === 'administrators') {
      return [O('Alias name     administrators\r\nMembers\r\n\r\n-------------------------------------------------------------------------------\r\n' + Object.keys(win.users).filter((u) => win.users[u].admin).join('\r\n') + '\r\nThe command completed successfully.')];
    }
    if (sub === 'localgroup' && !a[1]) return [O('Aliases for \\\\' + win.host + '\r\n\r\n*Administrators\r\n*Users\r\n*Remote Desktop Users\r\nThe command completed successfully.')];
    if (sub === 'start' || sub === 'stop') return svcAction(win, a[1], sub);
    return [E("The syntax of this command is: NET USER | NET LOCALGROUP | NET START ...")];
  };

  C.tasklist = (a, win) =>
    [
      O(
        [
          'Image Name                     PID Session Name        Session#    Mem Usage',
          '========================= ======== ================ =========== ============',
          'System                           4 Services                   0        140 K',
          'svchost.exe                    812 Services                   0      8,420 K',
          'explorer.exe                  2104 Console                    1     32,100 K',
        ]
          .concat((win.services ? Object.keys(win.services) : []).filter((s) => win.services[s].state === 'running').map((s, i) => pad(win.services[s].image || s + '.exe', 25) + (1300 + i * 10).toString().padStart(9) + ' Services                   0      5,120 K'))
          .join('\r\n')
      ),
    ];

  C.netstat = (a, win) => [O('\r\nActive Connections\r\n\r\n  Proto  Local Address          Foreign Address        State           PID\r\n  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       812\r\n  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4\r\n  TCP    0.0.0.0:3389           0.0.0.0:0              LISTENING       1120')];

  C.sc = function (a, win) {
    const sub = lc(a[0] || '');
    const name = a[1];
    if (sub === 'query' && !name) return [O(Object.keys(win.services).map((s) => 'SERVICE_NAME: ' + s + '\r\n        STATE              : ' + (win.services[s].state === 'running' ? '4  RUNNING' : '1  STOPPED')).join('\r\n\r\n') || 'No services.')];
    if ((sub === 'qc' || sub === 'query') && name) {
      const s = findSvc(win, name);
      if (!s) return [E('[SC] OpenService FAILED 1060:\r\n\r\nThe specified service does not exist as an installed service.')];
      if (sub === 'query') return [O('SERVICE_NAME: ' + s.name + '\r\n        STATE              : ' + (s.state === 'running' ? '4  RUNNING' : '1  STOPPED'))];
      return [O(['[SC] QueryServiceConfig SUCCESS', '', 'SERVICE_NAME: ' + s.name, '        BINARY_PATH_NAME   : ' + s.binpath, '        START_TYPE         : ' + (s.start || 'AUTO_START'), '        DISPLAY_NAME       : ' + (s.display || s.name)].join('\r\n'))];
    }
    if (sub === 'config' && name) {
      const key = Object.keys(win.services).find((x) => lc(x) === lc(name));
      if (!key) return [E('[SC] OpenService FAILED 1060')];
      const s = win.services[key];
      const bp = a.join(' ').match(/binpath=\s*"?([^"]+)"?/i);
      if (!bp) return [E('Uso: sc config NOMBRE binpath= "C:\\ruta\\prog.exe"')];
      if (!s.canConfig) return [E('[SC] OpenService FAILED 5:\r\n\r\nAccess is denied.')];
      s.binpath = bp[1].trim();
      s.hijacked = true;
      return [O('[SC] ChangeServiceConfig SUCCESS')];
    }
    if ((sub === 'start' || sub === 'stop') && name) return svcAction(win, name, sub);
    return [E('DESCRIPTION:\r\n        SC query | qc | config | start | stop NOMBRE')];
  };

  const findSvc = (win, name) => {
    const k = Object.keys(win.services).find((s) => lc(s) === lc(name));
    return k ? Object.assign({ name: k }, win.services[k]) : null;
  };
  function svcAction(win, name, action) {
    const k = Object.keys(win.services).find((s) => lc(s) === lc(name));
    if (!k) return [E('[SC] StartService FAILED 1060: El servicio no existe.')];
    const s = win.services[k];
    if (action === 'stop') {
      s.state = 'stopped';
      return [O('[SC] El servicio ' + k + ' se ha detenido.')];
    }
    s.state = 'running';
    /* al arrancar se ejecuta su binario: si lo controlas (ruta cambiada, o ruta sin comillas con hueco plantado), SYSTEM */
    const gapHit = s.unquoted && win.planted && unquotedGaps(s.binpath).some((g) => win.planted.has(lc(g)) && win.writable.has(nrm(g.replace(/\\[^\\]+$/, ''))));
    if (s.hijacked || gapHit) {
      elevate(win, 'system');
      return [O('[SC] El servicio ' + k + ' se está iniciando.'), O(''), O('[+] El servicio ha ejecutado tu binario como SYSTEM. Escribe whoami para confirmarlo.')];
    }
    return [O('[SC] El servicio ' + k + ' se está iniciando.')];
  }

  /* Rutas donde un binpath SIN COMILLAS con espacios se puede secuestrar: C:\Program.exe, C:\Program Files\Vuln.exe ... */
  function unquotedGaps(binpath) {
    const p = String(binpath).replace(/"/g, '');
    if (/^"/.test(binpath) || !/ /.test(p)) return [];
    const parts = p.split('\\');
    const gaps = [];
    let acc = parts[0];
    for (let i = 1; i < parts.length; i++) {
      if (acc.includes(' ')) gaps.push(acc.replace(/ .*$/, '') + '.exe');
      const seg = parts.slice(0, i).join('\\');
      if (/ /.test(parts[i - 1])) gaps.push(seg.replace(/ [^\\]*$/, '') + '.exe');
      acc += '\\' + parts[i];
    }
    /* el caso típico: hasta el primer espacio */
    const firstSpace = p.indexOf(' ');
    if (firstSpace > 0) gaps.push(p.slice(0, firstSpace) + '.exe');
    return Array.from(new Set(gaps));
  }

  /* copy/echo: planta un "binario" en una ruta (para el secuestro de servicio sin comillas) */
  C.copy = function (a, win) {
    const dest = (a[a.length - 1] || '').replace(/"/g, '');
    if (a.length < 2) return [E('Uso: copy origen "C:\\ruta\\destino.exe"')];
    const dir = dest.replace(/\\[^\\]+$/, '');
    if (!win.writable.has(nrm(dir)) && !win.writable.has(nrm(dest))) return [E('Acceso denegado. No puedes escribir en ' + dir)];
    win.planted = win.planted || new Set();
    win.planted.add(lc(dest));
    win.fs[lc(dest)] = { content: '(binario del atacante)\r\n' };
    return [O('        1 file(s) copied.')];
  };

  C.reg = function (a, win) {
    const sub = lc(a[0] || '');
    if (sub === 'query') {
      const key = (a[1] || '').replace(/"/g, '');
      const hits = Object.keys(win.reg).filter((k) => lc(k).startsWith(lc(key)) && key);
      if (!hits.length) return [E('ERROR: The system was unable to find the specified registry key or value.')];
      let out = '\r\n' + key + '\r\n';
      for (const h of hits) {
        const name = h.slice(key.length).replace(/^\\/, '') || '(Default)';
        out += '    ' + pad(name, 24) + 'REG_DWORD    ' + win.reg[h] + '\r\n';
      }
      return [O(out)];
    }
    if (sub === 'add') return [O('The operation completed successfully.')];
    return [E('Uso: reg query CLAVE')];
  };

  C.icacls = function (a, win) {
    const path = (a[0] || '').replace(/"/g, '');
    if (!path) return [E('Uso: icacls RUTA')];
    const writable = win.writable.has(nrm(path));
    return [O(path + ' ' + (writable ? 'BUILTIN\\Users:(F)\r\n         ' : '') + 'NT AUTHORITY\\SYSTEM:(F)\r\n         BUILTIN\\Administrators:(F)\r\n\r\nSuccessfully processed 1 files.')];
  };

  C.cmdkey = function (a, win) {
    if (lc(a[0] || '') === '/list') {
      if (!win.creds.length) return [O('\r\nCurrently stored credentials:\r\n\r\n    * NONE *')];
      return [O('\r\nCurrently stored credentials:\r\n\r\n' + win.creds.map((c) => '    Target: ' + (c.type || 'Domain') + ':target=' + c.target + '\r\n    Type: ' + (c.type || 'Domain Password') + '\r\n    User: ' + c.user).join('\r\n\r\n'))];
    }
    return [E('Uso: cmdkey /list')];
  };

  C.schtasks = (a, win) => [O('\r\nFolder: \\\r\nTaskName                                 Next Run Time          Status\r\n======================================== ====================== ===============\r\n' + (win.tasks.length ? win.tasks.map((t) => pad('\\' + t.name, 40) + pad(t.next || 'N/A', 23) + 'Ready').join('\r\n') : '\\Microsoft\\Windows\\UpdateTask            N/A                    Ready'))];

  /* navegación y archivos */
  C.cd = function (a, win) {
    if (!a[0] || a[0] === '/d') a = a.filter((x) => x !== '/d');
    const t = a[0];
    if (!t) return [O(win.cwd)];
    win.cwd = resolve(win, t);
    return [];
  };
  C.dir = function (a, win) {
    const p = lc(resolve(win, a.find((x) => x[0] !== '/') || win.cwd));
    const prefix = p.endsWith('\\') ? p : p + '\\';
    const names = new Set();
    for (const k of Object.keys(win.fs)) if (k.startsWith(prefix)) names.add(k.slice(prefix.length).split('\\')[0]);
    const rows = ['', ' Directory of ' + resolve(win, a.find((x) => x[0] !== '/') || win.cwd), ''];
    for (const n of names) {
      const full = prefix + n;
      const isFile = !!win.fs[full];
      rows.push(pad('18/11/2026  10:20', 22) + (isFile ? pad(String((win.fs[full].content || '').length), 16) : pad('<DIR>', 16)) + ' ' + n);
    }
    if (!names.size) rows.push('File Not Found');
    return [O(rows.join('\r\n'))];
  };
  C.type = function (a, win) {
    const p = lc(resolve(win, a[0] || ''));
    const f = win.fs[p];
    if (!f) return [E('The system cannot find the file specified.')];
    if (f.adminOnly && !win.admin && !win.system) return [E('Access is denied.')];
    return [['out', f.content]];
  };
  function resolve(win, t) {
    t = t.replace(/"/g, '');
    if (/^[a-zA-Z]:\\/.test(t)) return t;
    if (t === '..') return win.cwd.replace(/\\[^\\]+$/, '') || 'C:\\';
    if (t === '\\') return 'C:\\';
    return (win.cwd.endsWith('\\') ? win.cwd : win.cwd + '\\') + t;
  }

  /* runas con credenciales robadas */
  C.runas = function (a, win) {
    const line = a.join(' ');
    const u = (line.match(/\/user:(\S+)/i) || [])[1] || '';
    const name = u.split('\\').pop();
    const saved = /\/savecred/i.test(line);
    const cred = win.creds.find((c) => lc(c.user).split('\\').pop() === lc(name));
    const known = win.knownPass && win.knownPass[lc(name)];
    if (!u) return [E('Uso: runas /user:Administrator cmd   (o /savecred si la credencial está guardada)')];
    if (saved && cred) {
      elevate(win, 'admin');
      return [O('Attempting to start cmd as user "' + u + '" ...'), O('[+] Credencial guardada usada. Ahora eres ' + name + '.')];
    }
    if (known) {
      elevate(win, 'admin');
      return [O('Attempting to start cmd as user "' + u + '" ...'), O('[+] Contraseña correcta. Ahora eres ' + name + '.')];
    }
    return [E('RUNAS ERROR: Unable to run - cmd\r\n1326: The user name or password is incorrect.')];
  };

  /* herramientas de explotación (simuladas) */
  function exploitTool(win, line) {
    const l = lc(line);
    /* PrintSpoofer / GodPotato / JuicyPotato: necesitan SeImpersonate o SeAssignPrimaryToken */
    if (/(printspoofer|godpotato|juicypotato|roguepotato|sweetpotato)/.test(l)) {
      if (win.priv.has('SeImpersonatePrivilege') || win.priv.has('SeAssignPrimaryTokenPrivilege')) {
        elevate(win, 'system');
        return [O('[+] Found privilege: SeImpersonatePrivilege'), O('[+] Named pipe listening...'), O('[+] CreateProcessAsUser OK'), O('[+] Token duplicado. Shell como SYSTEM. Escribe whoami para confirmarlo.')];
      }
      return [E('[-] No tienes SeImpersonatePrivilege ni SeAssignPrimaryTokenPrivilege. Esta técnica no sirve aquí.')];
    }
    /* msiexec con AlwaysInstallElevated */
    if (/msiexec/.test(l) && /\/i/.test(l)) {
      const a = win.reg['HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer\\AlwaysInstallElevated'];
      const b = win.reg['HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer\\AlwaysInstallElevated'];
      if (a === 1 && b === 1) {
        elevate(win, 'system');
        return [O('[+] AlwaysInstallElevated activo: el .msi se instala como SYSTEM.'), O('[+] Payload ejecutado. whoami para confirmar.')];
      }
      return [E('msiexec: el .msi se ejecutó con tus permisos normales (AlwaysInstallElevated no está en 1/1).')];
    }
    /* reg save del SAM con SeBackupPrivilege */
    if (/reg\s+save/.test(l) && /(sam|system)/.test(l)) {
      if (win.priv.has('SeBackupPrivilege')) {
        win.dumpedSam = true;
        return [O('The operation completed successfully.'), O('[+] Con SeBackupPrivilege has copiado el SAM y el SYSTEM. Ya puedes extraer los hashes offline (secretsdump).')];
      }
      return [E('reg save: Access is denied. (necesitas SeBackupPrivilege)')];
    }
    return null;
  }

  /* ---------- la shell ---------- */

  class WinShell {
    constructor() {
      this.win = true;
      this.history = [];
      buildBox(this, {});
    }
    get root() {
      return this.system;
    }
    prompt() {
      return 'PS ' + this.cwd + '> ';
    }
    run(raw) {
      const line = raw.trim();
      this.editor = null;
      this.clear = false;
      if (!line) return result([['out', '']]);
      this.history.push(line);
      /* ¿es una herramienta/técnica de explotación? */
      const ex = exploitTool(this, line);
      if (ex) return result(ex.length ? ex : [['out', '']]);
      /* PowerShell: traducir algunos cmdlets a su equivalente */
      let pline = line.replace(/^powershell(\.exe)?(\s+-\w+)*\s+/i, '').replace(/^cmd(\.exe)?\s+\/c\s+/i, '');
      const ps = psTranslate(pline);
      const toks = tokenize(ps);
      let name = lc(toks[0] || '');
      name = name.replace(/\.exe$/, '').replace(/^\.\\/, '').replace(/^.*\\/, '');
      const argv = toks.slice(1);
      if (name === 'exit') return result([['out', '']]);
      if (name === 'cls' || name === 'clear') {
        this.clear = true;
        return result([['out', '']]);
      }
      if (name === 'echo') return result([['out', this.subEnv(argv.join(' ')) + '\r\n']]);
      if (name === 'help') return result([['out', winHelp()]]);
      const fn = C[name];
      if (!fn) return result([E("'" + toks[0] + "' is not recognized as an internal or external command,\r\noperable program or batch file.")]);
      const parts = fn(argv.map((x) => this.subEnv(x)), this);
      return result(parts.length ? parts : [['out', '']]);
    }
    subEnv(s) {
      return String(s).replace(/%(\w+)%/g, (m, k) => {
        const kk = Object.keys(this.env).find((x) => lc(x) === lc(k));
        return kk ? this.env[kk] : m;
      }).replace(/\$env:(\w+)/gi, (m, k) => {
        const kk = Object.keys(this.env).find((x) => lc(x) === lc(k));
        return kk ? this.env[kk] : m;
      });
    }
    sessionInfo() {
      return {
        user: this.system ? 'NT AUTHORITY\\SYSTEM' : this.domain + '\\' + (this.admin ? 'Administrator' : this.user),
        host: this.host,
        integrity: this.integrity,
        admin: this.admin,
        system: this.system,
        privs: this.system ? JUICY.filter((p) => true) : Array.from(this.priv),
        juicy: Array.from(this.priv).filter((p) => JUICY.includes(p)),
        services: this.services,
        creds: this.creds,
      };
    }
  }

  function tokenize(s) {
    const out = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
  }
  /* Unos cuantos cmdlets de PowerShell se mapean a su equivalente clásico, para que el alumno pueda usar ambos. */
  function psTranslate(line) {
    const map = [
      [/^Get-LocalUser\b.*/i, 'net user'],
      [/^Get-LocalGroupMember\s+Administrators.*/i, 'net localgroup administrators'],
      [/^Get-Service\b.*/i, 'sc query'],
      [/^Get-Content\s+(.+)$/i, (m) => 'type ' + m[1]],
      [/^cat\s+(.+)$/i, (m) => 'type ' + m[1]],
      [/^ls\b\s*(.*)$/i, (m) => 'dir ' + (m[1] || '')],
      [/^gci\b\s*(.*)$/i, (m) => 'dir ' + (m[1] || '')],
      [/^Get-ChildItem\b\s*(.*)$/i, (m) => 'dir ' + (m[1] || '')],
    ];
    for (const [re, to] of map) {
      const m = re.exec(line);
      if (m) return typeof to === 'function' ? to(m) : to;
    }
    return line;
  }
  function winHelp() {
    return [
      'Órdenes de este simulador de Windows:',
      '  Enumerar:   whoami [/priv|/groups|/all]  systeminfo  hostname  ver',
      '              net user [nombre]  net localgroup administrators  set',
      '              tasklist  netstat -ano  schtasks /query',
      '  Servicios:  sc query  sc qc NOMBRE  sc config NOMBRE binpath= "..."  sc start/stop NOMBRE',
      '  Registro:   reg query CLAVE   (AlwaysInstallElevated, Autologon…)',
      '  Permisos:   icacls RUTA   cmdkey /list',
      '  Archivos:   dir  cd  type ARCHIVO',
      '  Credencial: runas /savecred /user:Administrator cmd',
      '  Técnicas:   PrintSpoofer.exe -i -c cmd   msiexec /i x.msi   reg save HKLM\\SAM sam.hive',
      '',
      'Escribe whoami para ver quién eres tras cada intento.',
    ].join('\r\n');
  }

  G.WIN = { WinShell, buildBox, JUICY, PRIV_DESC };
})(typeof window !== 'undefined' ? window : globalThis);
