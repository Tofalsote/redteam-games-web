/* Mundo Windows: misiones de escalada de privilegios de Windows y su zona de juego.
   Mismo formato que las misiones de Linux, pero con os:'windows' y una WinShell.
   setup(sh) recibe la WinShell. Todo es simulado: nada funciona fuera de esta página. */
(function (G) {
  'use strict';

  const WIN = G.WIN;
  const box = (spec) => (sh) => WIN.buildBox(sh, spec || {});
  const sys = (c) => c.sh.system;
  const admin = (c) => c.sh.admin || c.sh.system;
  const okOut = (c, re) => re.test(c.r.out) && !c.r.err;
  const ran = (re) => (c) => re.test(c.line);

  const ADMIN_FLAG = (content) => ({ path: 'C:\\Users\\Administrator\\Desktop\\root.txt', content: content + '\r\n', adminOnly: true });
  const USER_FLAG = (content) => ({ path: 'C:\\Users\\thomas\\Desktop\\user.txt', content: content + '\r\n' });

  const WIN_MISSIONS = [
    /* ===== NIVEL 1 · RECONOCIMIENTO ===== */
    {
      id: 'win-recon',
      os: 'windows',
      level: 1,
      title: 'Tienes una shell en Windows',
      tag: 'Orientación',
      say: 'Cambiamos de sistema. Tienes una shell en un Windows. Aquí mandan los privilegios de token, no el SUID.',
      setup: box({ priv: ['SeImpersonatePrivilege'], files: [USER_FLAG('w1n_us3r')] }),
      body: `
        <p>Has conseguido una shell en una máquina <b>Windows</b> como el usuario <code>thomas</code>. El objetivo
        final aquí no es «root», sino <code>NT AUTHORITY\\SYSTEM</code>, la cuenta más poderosa del sistema (o la de
        un administrador local).</p>
        <p>El reconocimiento inicial es parecido al de Linux, pero con otras órdenes. Puedes usar <b>cmd</b> o
        <b>PowerShell</b>; el simulador acepta las dos.</p>
        <div class="cards">
          <div><code>whoami</code><small>¿qué usuario soy?</small></div>
          <div><code>whoami /priv</code><small>mis privilegios de token: ¡lo más importante!</small></div>
          <div><code>whoami /groups</code><small>mis grupos (¿Administrators?)</small></div>
          <div><code>hostname · systeminfo</code><small>qué máquina y qué parches tiene</small></div>
        </div>
        <p>Mira el panel <b>Sesión</b> de la derecha: resume quién eres, tu nivel de integridad y qué privilegios
        tienes. Un privilegio marcado como <b>⚠ explotable</b> es tu billete a SYSTEM.</p>`,
      steps: [
        { t: '¿Quién eres? <code>whoami</code>', hint: 'whoami', ok: (c) => okOut(c, /thomas/i) },
        { t: 'Lo más importante en Windows: tus privilegios de token. <code>whoami /priv</code>', hint: 'whoami /priv', ok: (c) => /PRIVILEGES/i.test(c.r.out) },
        { t: '¿Estás en el grupo Administrators? <code>whoami /groups</code>', hint: 'whoami /groups', ok: (c) => /GROUP/i.test(c.r.out) },
        { t: 'Nombre de la máquina: <code>hostname</code>', hint: 'hostname', ok: (c) => okOut(c, /CLIENTE01/i) },
        { t: 'Sistema y parches instalados: <code>systeminfo</code>', hint: 'systeminfo', ok: (c) => /OS Name/i.test(c.r.out) },
      ],
    },
    {
      id: 'win-users',
      os: 'windows',
      level: 1,
      title: 'Usuarios, grupos y red',
      tag: 'Enumeración',
      say: 'Como en Linux: ¿quién más vive aquí, quién es admin y qué servicios escuchan?',
      setup: box({ priv: ['SeImpersonatePrivilege'] }),
      body: `
        <p>El equivalente a <code>/etc/passwd</code> en Windows son las órdenes <code>net</code>. Y saber quién es
        administrador te dice a quién tienes que llegar.</p>
        <div class="cards">
          <div><code>net user</code><small>todas las cuentas</small></div>
          <div><code>net user NOMBRE</code><small>detalle de una cuenta y sus grupos</small></div>
          <div><code>net localgroup administrators</code><small>quién manda en esta máquina</small></div>
          <div><code>tasklist · netstat -ano</code><small>procesos y puertos</small></div>
        </div>`,
      steps: [
        { t: 'Lista las cuentas: <code>net user</code>', hint: 'net user', ok: (c) => okOut(c, /thomas/i) },
        { t: '¿Quién es administrador? <code>net localgroup administrators</code>', hint: 'net localgroup administrators', ok: (c) => /Administrator/i.test(c.r.out) },
        { t: 'Detalle de tu cuenta: <code>net user thomas</code>', hint: 'net user thomas', ok: (c) => /Local Group/i.test(c.r.out) },
        { t: 'Procesos en marcha: <code>tasklist</code>', hint: 'tasklist', ok: (c) => /explorer\.exe/i.test(c.r.out) },
        { t: 'Puertos a la escucha: <code>netstat -ano</code>', hint: 'netstat -ano', ok: (c) => /LISTENING/i.test(c.r.out) },
      ],
    },
    {
      id: 'win-loot',
      os: 'windows',
      level: 1,
      title: 'El primer botín',
      tag: 'user.txt · credenciales',
      say: 'Igual que en Linux: la bandera de usuario y credenciales olvidadas por archivos y variables.',
      setup: box({
        priv: ['SeImpersonatePrivilege'],
        creds: [{ target: 'FILESERVER', user: 'CORP\\svc_backup' }],
        env: { DB_PASSWORD: 'Sql2024!' },
        files: [USER_FLAG('w1n_us3r'), { path: 'C:\\Users\\thomas\\Desktop\\web.config', content: '<connectionStrings>\r\n  <add name="db" password="Sql2024!" />\r\n</connectionStrings>\r\n' }],
      }),
      body: `
        <p>La bandera de usuario (<code>user.txt</code>) suele estar en el Escritorio. Y las credenciales se esconden
        en archivos de configuración, en variables de entorno y en el <b>almacén de credenciales de Windows</b>.</p>
        <div class="cards">
          <div><code>dir</code><small>listar archivos</small></div>
          <div><code>type ARCHIVO</code><small>leer un archivo</small></div>
          <div><code>set</code><small>variables de entorno (¡contraseñas!)</small></div>
          <div><code>cmdkey /list</code><small>credenciales guardadas en el sistema</small></div>
        </div>`,
      steps: [
        { t: 'Mira tu Escritorio: <code>dir C:\\Users\\thomas\\Desktop</code>', hint: 'dir C:\\Users\\thomas\\Desktop', ok: (c) => /user\.txt/i.test(c.r.out) },
        { t: 'Lee tu bandera: <code>type C:\\Users\\thomas\\Desktop\\user.txt</code>', hint: 'type C:\\Users\\thomas\\Desktop\\user.txt', ok: (c) => okOut(c, /w1n_us3r/) },
        { t: 'Lee el web.config: <code>type C:\\Users\\thomas\\Desktop\\web.config</code>', hint: 'type C:\\Users\\thomas\\Desktop\\web.config', ok: (c) => okOut(c, /Sql2024/) },
        { t: '¿Hay contraseñas en las variables de entorno? <code>set</code>', hint: 'set', ok: (c) => /DB_PASSWORD/i.test(c.r.out) },
        { t: '¿Credenciales guardadas en el sistema? <code>cmdkey /list</code>', hint: 'cmdkey /list', ok: (c) => /svc_backup/i.test(c.r.out) },
      ],
    },

    /* ===== NIVEL 2 · PRIVILEGIOS DE TOKEN ===== */
    {
      id: 'win-priv',
      os: 'windows',
      level: 2,
      title: 'Privilegios de token',
      tag: 'whoami /priv',
      say: 'El corazón de la escalada en Windows. Ciertos privilegios equivalen a ser SYSTEM.',
      setup: box({ priv: ['SeImpersonatePrivilege'], files: [ADMIN_FLAG('t0k3n_pwn')] }),
      body: `
        <p>Un <b>token</b> es la «tarjeta de identidad» de tu proceso, y lleva una lista de <b>privilegios</b>.
        Algunos, en manos de un atacante, valen tanto como ser administrador:</p>
        <div class="cards">
          <div><code>SeImpersonatePrivilege</code><small>el más común en cuentas de servicio → SYSTEM</small></div>
          <div><code>SeAssignPrimaryToken</code><small>igual de peligroso</small></div>
          <div><code>SeBackupPrivilege</code><small>leer cualquier archivo (¡el SAM!)</small></div>
          <div><code>SeDebugPrivilege</code><small>inyectar en procesos de SYSTEM</small></div>
        </div>
        <p>Las cuentas de servicios web (IIS, MSSQL) casi siempre tienen <code>SeImpersonatePrivilege</code>. Por eso lo
        primero tras conseguir una shell de servicio es <code>whoami /priv</code>.</p>`,
      steps: [
        { t: 'Lista tus privilegios: <code>whoami /priv</code>', hint: 'whoami /priv', ok: (c) => /SeImpersonatePrivilege/.test(c.r.out) },
        { t: 'Tienes <code>SeImpersonatePrivilege</code>: el panel Sesión lo marca como explotable. De momento no puedes leer la bandera de root: <code>type C:\\Users\\Administrator\\Desktop\\root.txt</code>', hint: 'type C:\\Users\\Administrator\\Desktop\\root.txt', ok: (c) => /Access is denied/i.test(c.r.err) },
        { t: 'Confirma que NO estás en Administrators todavía: <code>whoami /groups</code>', hint: 'whoami /groups', ok: (c) => /GROUP/i.test(c.r.out) && !/Administrators/.test(c.r.out) },
      ],
    },
    {
      id: 'win-potato',
      os: 'windows',
      level: 2,
      title: 'SeImpersonate → SYSTEM',
      tag: 'PrintSpoofer',
      say: 'Con SeImpersonate, una herramienta "Potato" roba el token de SYSTEM. Esto es lo que has venido a ver.',
      setup: box({ priv: ['SeImpersonatePrivilege'], files: [ADMIN_FLAG('p0t4t0_syst3m')] }),
      body: `
        <p>Con <code>SeImpersonatePrivilege</code>, puedes obligar a un servicio de SYSTEM a autenticarse contra ti y
        <b>robarle el token</b>. Las herramientas que lo hacen se llaman «Potato»: <b>PrintSpoofer</b>, <b>GodPotato</b>,
        <b>JuicyPotato</b>…</p>
        <div class="flow pipe">
          <span class="box">SeImpersonate</span><span class="arrow">→</span>
          <span class="box">PrintSpoofer</span><span class="arrow">→</span>
          <span class="box">token de SYSTEM</span><span class="arrow">→</span>
          <span class="box">SYSTEM</span>
        </div>
        <p>La orden típica abre una shell como SYSTEM:</p>
        <p><code>.\\PrintSpoofer64.exe -i -c cmd.exe</code></p>
        <p class="warn">Fíjate: si NO tuvieras SeImpersonate, esto no funcionaría. La técnica depende del privilegio.</p>`,
      steps: [
        { t: 'Confirma el privilegio: <code>whoami /priv</code>', hint: 'whoami /priv', ok: (c) => /SeImpersonatePrivilege/.test(c.r.out) },
        { t: 'Roba el token de SYSTEM: <code>.\\PrintSpoofer64.exe -i -c cmd.exe</code>', hint: '.\\PrintSpoofer64.exe -i -c cmd.exe', ok: sys },
        { t: 'Compruébalo: <code>whoami</code> debe decir <code>nt authority\\system</code>.', hint: 'whoami', ok: (c) => /nt authority\\system/i.test(c.r.out) },
        { t: 'Recoge la bandera de root: <code>type C:\\Users\\Administrator\\Desktop\\root.txt</code>', hint: 'type C:\\Users\\Administrator\\Desktop\\root.txt', ok: (c) => okOut(c, /p0t4t0_syst3m/) },
      ],
    },
    {
      id: 'win-backup',
      os: 'windows',
      level: 2,
      title: 'SeBackupPrivilege: leerlo todo',
      tag: 'SAM',
      say: 'Otro privilegio goloso: SeBackup te deja copiar cualquier archivo, incluidos los hashes de contraseñas.',
      setup: box({ priv: ['SeBackupPrivilege'] }),
      body: `
        <p><code>SeBackupPrivilege</code> permite leer <b>cualquier archivo</b> saltándose los permisos, con la excusa de
        hacer copias de seguridad. El objetivo clásico son los hashes de contraseñas de Windows, que viven en el
        registro (<code>SAM</code> y <code>SYSTEM</code>).</p>
        <div class="flow pipe">
          <span class="box">reg save HKLM\\SAM</span><span class="arrow">→</span>
          <span class="box">reg save HKLM\\SYSTEM</span><span class="arrow">→</span>
          <span class="box">secretsdump</span><span class="arrow">→</span>
          <span class="box">hashes</span>
          <small>con los hashes se entra como administrador (pass-the-hash)</small>
        </div>
        <p>Con el hash del administrador no hace falta ni descifrarlo: se usa tal cual para autenticarse. Aquí solo
        llegamos hasta copiar el SAM; el crackeo sería en tu máquina.</p>`,
      steps: [
        { t: 'Confirma el privilegio: <code>whoami /priv</code>', hint: 'whoami /priv', ok: (c) => /SeBackupPrivilege/.test(c.r.out) },
        { t: 'Copia el SAM (los hashes): <code>reg save HKLM\\SAM C:\\temp\\sam.hive</code>', hint: 'reg save HKLM\\SAM C:\\temp\\sam.hive', ok: (c) => /completed successfully/i.test(c.r.out) },
        { t: 'Y el SYSTEM (la clave para descifrarlos): <code>reg save HKLM\\SYSTEM C:\\temp\\system.hive</code>', hint: 'reg save HKLM\\SYSTEM C:\\temp\\system.hive', ok: (c) => c.sh.dumpedSam === true },
      ],
    },

    /* ===== NIVEL 3 · SERVICIOS ===== */
    {
      id: 'win-svc-enum',
      os: 'windows',
      level: 3,
      title: 'Servicios y sus binarios',
      tag: 'sc query',
      say: 'Los servicios corren como SYSTEM. Si controlas qué binario ejecuta uno, eres SYSTEM.',
      setup: box({
        services: { WindscribeService: { binpath: 'C:\\Program Files\\Windscribe\\WindscribeService.exe', state: 'running', canConfig: true, display: 'Windscribe Service' } },
        priv: [],
      }),
      body: `
        <p>Un <b>servicio</b> de Windows casi siempre corre como <code>SYSTEM</code>. Si puedes cambiar el programa que
        ejecuta, o reemplazar ese programa, tu código correrá como SYSTEM. Para investigarlos:</p>
        <div class="cards">
          <div><code>sc query</code><small>lista los servicios</small></div>
          <div><code>sc qc NOMBRE</code><small>su configuración: qué binario ejecuta</small></div>
          <div><code>icacls RUTA</code><small>¿quién puede escribir en ese binario o carpeta?</small></div>
        </div>
        <p>Dos fallos clásicos: que <b>tú puedas reconfigurar</b> el servicio (permisos débiles), o que su ruta tenga
        <b>espacios sin comillas</b>. Los veremos en las dos misiones siguientes.</p>`,
      steps: [
        { t: 'Lista los servicios: <code>sc query</code>', hint: 'sc query', ok: (c) => /SERVICE_NAME/i.test(c.r.out) },
        { t: 'Mira la config del servicio sospechoso: <code>sc qc WindscribeService</code>', hint: 'sc qc WindscribeService', ok: (c) => /BINARY_PATH_NAME/i.test(c.r.out) },
        { t: '¿Quién puede escribir en su binario? <code>icacls "C:\\Program Files\\Windscribe\\WindscribeService.exe"</code>', hint: 'icacls "C:\\Program Files\\Windscribe\\WindscribeService.exe"', ok: (c) => /SYSTEM/i.test(c.r.out) },
      ],
    },
    {
      id: 'win-svc-weak',
      os: 'windows',
      level: 3,
      title: 'Permisos débiles de servicio',
      tag: 'sc config',
      say: 'Si puedes reconfigurar un servicio, le dices que ejecute lo que tú quieras. Y lo ejecuta como SYSTEM.',
      setup: box({
        services: { VulnSvc: { binpath: '"C:\\Program Files\\Vuln\\svc.exe"', state: 'stopped', canConfig: true, display: 'Vulnerable Service' } },
        files: [ADMIN_FLAG('s3rv1c3_syst3m')],
      }),
      body: `
        <p>Algunos servicios permiten a usuarios normales <b>cambiar su configuración</b> (permiso
        <code>SERVICE_CHANGE_CONFIG</code>). Si es el caso, le cambias el binario que ejecuta por el tuyo con
        <code>sc config</code>, lo reinicias, y tu binario corre como SYSTEM.</p>
        <div class="flow pipe">
          <span class="box">sc config binpath=</span><span class="arrow">→</span>
          <span class="box">sc stop/start</span><span class="arrow">→</span>
          <span class="box">SYSTEM</span>
        </div>
        <p>Ojo a la sintaxis exacta: hay un espacio obligatorio después de <code>binpath=</code>.</p>`,
      steps: [
        { t: 'Mira la config actual: <code>sc qc VulnSvc</code>', hint: 'sc qc VulnSvc', ok: (c) => /BINARY_PATH_NAME/i.test(c.r.out) },
        { t: 'Cambia el binario que ejecuta: <code>sc config VulnSvc binpath= "C:\\temp\\rev.exe"</code>', hint: 'sc config VulnSvc binpath= "C:\\temp\\rev.exe"', ok: (c) => /SUCCESS/i.test(c.r.out) },
        { t: 'Arráncalo para que ejecute tu binario: <code>sc start VulnSvc</code>', hint: 'sc start VulnSvc', ok: sys },
        { t: 'Compruébalo: <code>whoami</code>', hint: 'whoami', ok: (c) => /system/i.test(c.r.out) },
        { t: 'Recoge la bandera: <code>type C:\\Users\\Administrator\\Desktop\\root.txt</code>', hint: 'type C:\\Users\\Administrator\\Desktop\\root.txt', ok: (c) => okOut(c, /s3rv1c3_syst3m/) },
      ],
    },
    {
      id: 'win-svc-unquoted',
      os: 'windows',
      level: 3,
      title: 'Ruta de servicio sin comillas',
      tag: 'unquoted path',
      say: 'El fallo más famoso de Windows: una ruta con espacios y sin comillas. Windows la interpreta mal.',
      setup: box({
        services: { FaxReader: { binpath: 'C:\\Program Files\\Fax Reader\\fax service.exe', state: 'stopped', unquoted: true, canConfig: false, display: 'Fax Reader' } },
        writable: ['C:\\'],
        files: [ADMIN_FLAG('unqu0t3d_win')],
      }),
      body: `
        <p>Cuando la ruta de un servicio tiene <b>espacios y no está entre comillas</b>, Windows no sabe dónde acaba el
        nombre del programa y prueba a ejecutar cada trozo con <code>.exe</code>:</p>
        <div class="anatomy">
          <span class="part a"><code>C:\\Program.exe</code><small>1º prueba esto…</small></span>
          <span class="sep">→</span>
          <span class="part b"><code>C:\\Program Files\\Fax.exe</code><small>…luego esto…</small></span>
          <span class="sep">→</span>
          <span class="part c"><code>…\\fax service.exe</code><small>el real</small></span>
        </div>
        <p>Si puedes <b>escribir</b> en una de esas carpetas intermedias, colocas ahí tu binario con ese nombre y, al
        arrancar el servicio, Windows ejecuta el tuyo como SYSTEM.</p>`,
      steps: [
        { t: 'Mira la ruta del servicio: <code>sc qc FaxReader</code>. Fíjate: tiene espacios y no lleva comillas.', hint: 'sc qc FaxReader', ok: (c) => /BINARY_PATH_NAME/i.test(c.r.out) },
        { t: '¿Puedes escribir en C:\\? <code>icacls C:\\</code> (verás <code>BUILTIN\\Users:(F)</code>).', hint: 'icacls C:\\', ok: (c) => /Users/i.test(c.r.out) },
        { t: 'Coloca tu binario en el hueco: <code>copy evil.exe "C:\\Program.exe"</code>', hint: 'copy evil.exe "C:\\Program.exe"', ok: (c) => /copied/i.test(c.r.out) },
        { t: 'Arranca el servicio: <code>sc start FaxReader</code>', hint: 'sc start FaxReader', ok: sys },
        { t: 'Compruébalo y recoge la bandera: <code>type C:\\Users\\Administrator\\Desktop\\root.txt</code>', hint: 'type C:\\Users\\Administrator\\Desktop\\root.txt', ok: (c) => okOut(c, /unqu0t3d_win/) },
      ],
    },

    /* ===== NIVEL 4 · CREDENCIALES Y REGISTRO ===== */
    {
      id: 'win-creds',
      os: 'windows',
      level: 4,
      title: 'Credenciales guardadas',
      tag: 'runas /savecred',
      say: 'Windows guarda credenciales para no pedirlas cada vez. Y tú puedes usarlas sin conocerlas.',
      setup: box({
        creds: [{ target: 'CLIENTE01', user: 'CLIENTE01\\Administrator' }],
        files: [ADMIN_FLAG('s4v3dcr3ds')],
      }),
      body: `
        <p>El almacén de credenciales de Windows guarda usuarios y contraseñas para servicios y tareas. Con
        <code>cmdkey /list</code> ves cuáles hay, y con <code>runas /savecred</code> ejecutas una orden como ese
        usuario <b>sin teclear su contraseña</b> (Windows la pone por ti).</p>
        <div class="flow pipe">
          <span class="box">cmdkey /list</span><span class="arrow">→</span>
          <span class="box">runas /savecred /user:Administrator</span><span class="arrow">→</span>
          <span class="box">Administrador</span>
        </div>`,
      steps: [
        { t: '¿Qué credenciales hay guardadas? <code>cmdkey /list</code>', hint: 'cmdkey /list', ok: (c) => /Administrator/i.test(c.r.out) },
        { t: 'Úsala para ejecutar una shell como administrador: <code>runas /savecred /user:CLIENTE01\\Administrator cmd</code>', hint: 'runas /savecred /user:CLIENTE01\\Administrator cmd', ok: admin },
        { t: 'Compruébalo: <code>whoami</code>', hint: 'whoami', ok: (c) => /administrator/i.test(c.r.out) },
        { t: 'Recoge la bandera: <code>type C:\\Users\\Administrator\\Desktop\\root.txt</code>', hint: 'type C:\\Users\\Administrator\\Desktop\\root.txt', ok: (c) => okOut(c, /s4v3dcr3ds/) },
      ],
    },
    {
      id: 'win-aie',
      os: 'windows',
      level: 4,
      title: 'AlwaysInstallElevated',
      tag: 'Registro · msiexec',
      say: 'Una política mal puesta: cualquier .msi se instala como SYSTEM. Un regalo que se mira en el registro.',
      setup: box({
        reg: {
          'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer\\AlwaysInstallElevated': 1,
          'HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer\\AlwaysInstallElevated': 1,
        },
        files: [ADMIN_FLAG('4lw4ys_1nst4ll')],
      }),
      body: `
        <p><b>AlwaysInstallElevated</b> es una política que, si está activada en las dos ramas del registro
        (<code>HKLM</code> y <code>HKCU</code>), hace que <b>cualquier paquete .msi se instale como SYSTEM</b>, lo lance
        quien lo lance. Un error de configuración precioso.</p>
        <div class="flow pipe">
          <span class="box">reg query (los dos = 0x1)</span><span class="arrow">→</span>
          <span class="box">msiexec /i payload.msi</span><span class="arrow">→</span>
          <span class="box">SYSTEM</span>
        </div>
        <p>Se comprueba mirando el registro; si ambas valen <code>0x1</code>, adelante.</p>`,
      steps: [
        { t: 'Comprueba la política en HKLM: <code>reg query HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer</code>', hint: 'reg query HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer', ok: (c) => /AlwaysInstallElevated/i.test(c.r.out) },
        { t: 'Y en HKCU: <code>reg query HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer</code>. Ambas valen 0x1.', hint: 'reg query HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer', ok: (c) => /AlwaysInstallElevated/i.test(c.r.out) },
        { t: 'Instala tu paquete como SYSTEM: <code>msiexec /quiet /qn /i payload.msi</code>', hint: 'msiexec /quiet /qn /i payload.msi', ok: sys },
        { t: 'Compruébalo y recoge la bandera: <code>type C:\\Users\\Administrator\\Desktop\\root.txt</code>', hint: 'type C:\\Users\\Administrator\\Desktop\\root.txt', ok: (c) => okOut(c, /4lw4ys_1nst4ll/) },
      ],
    },

    /* ===== NIVEL 5 · EL ASALTO FINAL ===== */
    {
      id: 'win-final',
      os: 'windows',
      level: 5,
      title: 'El asalto final (Windows)',
      tag: 'Misión final',
      say: 'Una shell de servicio en un Windows nuevo. De usuario a SYSTEM, tú solo.',
      setup: box({
        host: 'WEBSRV01',
        user: 'iis_svc',
        priv: ['SeImpersonatePrivilege'],
        files: [{ path: 'C:\\Users\\iis_svc\\Desktop\\user.txt', content: 'w3b_s3rv1c3\r\n' }, ADMIN_FLAG('SYSTEM_TOTAL')],
      }),
      body: `
        <p>Objetivo completo, como en un examen (tipo OSCP). Has conseguido una shell como la cuenta de servicio de un
        servidor web, <code>iis_svc</code>. Tienes que llegar a SYSTEM y recoger las dos banderas.</p>
        <div class="flow pipe">
          <span class="box">whoami /priv</span><span class="arrow">→</span>
          <span class="box">¿privilegio explotable?</span><span class="arrow">→</span>
          <span class="box">Potato</span><span class="arrow">→</span>
          <span class="box">SYSTEM</span>
        </div>
        <p>Sin pistas en el texto. Recuerda la rutina de Windows: <code>whoami</code> → <code>whoami /priv</code> →
        explotar el privilegio → recoger la bandera.</p>`,
      steps: [
        { t: 'Oriéntate: <code>whoami</code>', hint: 'whoami', ok: (c) => /iis_svc/i.test(c.r.out) },
        { t: 'Recoge la bandera de usuario: <code>type C:\\Users\\iis_svc\\Desktop\\user.txt</code>', hint: 'type C:\\Users\\iis_svc\\Desktop\\user.txt', ok: (c) => okOut(c, /w3b_s3rv1c3/) },
        { t: 'Mira tus privilegios de token: <code>whoami /priv</code>', hint: 'whoami /priv', ok: (c) => /SeImpersonatePrivilege/.test(c.r.out) },
        { t: 'Tienes SeImpersonate. Escala a SYSTEM: <code>.\\PrintSpoofer64.exe -i -c cmd.exe</code>', hint: '.\\PrintSpoofer64.exe -i -c cmd.exe', ok: sys },
        { t: 'Recoge la bandera final: <code>type C:\\Users\\Administrator\\Desktop\\root.txt</code>', hint: 'type C:\\Users\\Administrator\\Desktop\\root.txt', ok: (c) => okOut(c, /SYSTEM_TOTAL/) },
      ],
    },

    /* ===== ZONA DE JUEGO WINDOWS ===== */
    { id: 'win-cr1', os: 'windows', glevel: 'w1', title: 'Contrarreloj', tag: '75 segundos', mode: 'arcade', icon: '⏱', say: 'Enumeración de Windows a toda velocidad.', steps: [] },
    { id: 'win-ctf1', os: 'windows', glevel: 'w1', title: 'Caza de banderas', tag: '3 secretos', mode: 'ctf', icon: '🚩', say: 'Tres banderas que se encuentran enumerando: archivos, variables y credenciales.', outro: 'whoami, type, set y cmdkey: la foto inicial de cualquier Windows.', steps: [] },
    { id: 'win-cr2', os: 'windows', glevel: 'w2', title: 'Contrarreloj', tag: '75 segundos', mode: 'arcade', icon: '⏱', say: 'Escaladas de Windows contra el reloj. Cada reto, una máquina nueva.', steps: [] },
    { id: 'win-ctf2', os: 'windows', glevel: 'w2', title: 'Caza de banderas', tag: '3 secretos', mode: 'ctf', icon: '🚩', say: 'Para estas hay que llegar a SYSTEM por distintos caminos.', outro: 'Potato, servicios y registro: ya sabes escalar en Windows. Mundo Windows dominado.', steps: [] },
  ];

  /* Las misiones de Windows van detrás de las de Linux. */
  G.LESSONS.push(...WIN_MISSIONS);

  /* ---------- zona de juego de Windows ---------- */

  const flagFile = (path, adminOnly) => (f) => ({ path, content: f + '\r\n', adminOnly: !!adminOnly });

  const WCH1 = [
    { goal: 'Averigua con qué <b>usuario</b> estás', sol: 'whoami', ok: (c) => /thomas/i.test(c.r.out) },
    { goal: 'Lista tus <b>privilegios de token</b>', sol: 'whoami /priv', ok: (c) => /PRIVILEGES/i.test(c.r.out) },
    { goal: 'Averigua el <b>nombre de la máquina</b>', sol: 'hostname', ok: (c) => c.r.out.trim().toLowerCase() === 'cliente01' },
    { goal: 'Lista las <b>cuentas</b> de usuario', sol: 'net user', ok: (c) => /thomas/i.test(c.r.out) },
    { goal: '¿Quién es <b>administrador</b>?', sol: 'net localgroup administrators', ok: (c) => /Administrator/i.test(c.r.out) },
    { goal: 'Lista los <b>procesos</b>', sol: 'tasklist', ok: (c) => /explorer/i.test(c.r.out) },
    { goal: 'Mira los <b>puertos</b> abiertos', sol: 'netstat -ano', ok: (c) => /LISTENING/i.test(c.r.out) },
    { goal: 'Lista los <b>servicios</b>', setup: box({ services: { Svc1: { binpath: 'x', state: 'running' } } }), sol: 'sc query', ok: (c) => /SERVICE_NAME/i.test(c.r.out) },
    { goal: 'Muestra las <b>credenciales guardadas</b>', setup: box({ creds: [{ target: 'DC', user: 'CORP\\admin' }] }), sol: 'cmdkey /list', ok: (c) => /admin/i.test(c.r.out) },
    { goal: 'Comprueba la política <b>AlwaysInstallElevated</b> en HKLM', setup: box({ reg: { 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer\\AlwaysInstallElevated': 1 } }), sol: 'reg query HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer', ok: (c) => /AlwaysInstallElevated/i.test(c.r.out) },
  ].map((ch) => Object.assign({ setup: box({ priv: ['SeImpersonatePrivilege'] }) }, ch));

  const WCH2 = [
    { goal: 'Escala a <b>SYSTEM</b> con PrintSpoofer (tienes SeImpersonate)', setup: box({ priv: ['SeImpersonatePrivilege'] }), sol: '.\\PrintSpoofer64.exe -i -c cmd.exe', ok: (c) => c.sh.system },
    { goal: 'Escala por un <b>servicio con permisos débiles</b>', setup: box({ services: { Vuln: { binpath: 'x', state: 'stopped', canConfig: true } } }), sol: 'sc config Vuln binpath= "C:\\t\\x.exe"\nsc start Vuln', ok: (c) => c.sh.system },
    { goal: 'Escala por <b>AlwaysInstallElevated</b>', setup: box({ reg: { 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer\\AlwaysInstallElevated': 1, 'HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer\\AlwaysInstallElevated': 1 } }), sol: 'msiexec /i x.msi', ok: (c) => c.sh.system },
    { goal: 'Usa una <b>credencial guardada</b> para ser administrador', setup: box({ creds: [{ target: 'PC', user: 'PC\\Administrator' }] }), sol: 'runas /savecred /user:PC\\Administrator cmd', ok: (c) => c.sh.admin },
    { goal: 'Copia el <b>SAM</b> con SeBackupPrivilege', setup: box({ priv: ['SeBackupPrivilege'] }), sol: 'reg save HKLM\\SAM C:\\t\\sam.hive', ok: (c) => c.sh.dumpedSam === true },
    { goal: 'Confirma que eres <b>SYSTEM</b> tras escalar', setup: box({ priv: ['SeImpersonatePrivilege'] }), sol: '.\\PrintSpoofer64.exe -i -c cmd.exe\nwhoami', ok: (c) => /system/i.test(c.r.out) },
  ];

  const WFLAGS1 = [
    { id: 'wf1-file', name: 'En el escritorio', flag: 'FLAG{aaaaaaaaaaaa}', clue: 'Hay una nota en el escritorio del usuario con una bandera dentro.', hint: 'type C:\\Users\\thomas\\Desktop\\user.txt' },
    { id: 'wf1-env', name: 'En el entorno', flag: 'FLAG{bbbbbbbbbbbb}', clue: 'Una variable de entorno guarda una bandera.', hint: 'set | findstr FLAG   (o simplemente: set, y búscala)' },
    { id: 'wf1-cred', name: 'Config con secreto', flag: 'FLAG{cccccccccccc}', clue: 'Un archivo .config del escritorio esconde una bandera entre su configuración.', hint: 'type C:\\Users\\thomas\\Desktop\\app.config' },
  ];
  function setupWinCtf1(sh) {
    const f = (id) => WFLAGS1.find((x) => x.id === id).flag;
    WIN.buildBox(sh, {
      priv: ['SeImpersonatePrivilege'],
      env: { SECRET_TOKEN: f('wf1-env') },
      files: [
        { path: 'C:\\Users\\thomas\\Desktop\\user.txt', content: f('wf1-file') + '\r\n' },
        { path: 'C:\\Users\\thomas\\Desktop\\app.config', content: '<configuration>\r\n  <appSettings>\r\n    <add key="apiKey" value="' + f('wf1-cred') + '" />\r\n  </appSettings>\r\n</configuration>\r\n' },
        { path: 'C:\\Users\\thomas\\Desktop\\LEEME.txt', content: 'Nivel Windows 1: 3 banderas. Se encuentran enumerando (type, set).\r\n' },
      ],
    });
  }

  const WFLAGS2 = [
    { id: 'wf2-potato', name: 'Token robado', flag: 'FLAG{dddddddddddd}', clue: 'Tienes SeImpersonate. Escala a SYSTEM y lee la bandera del administrador.', hint: '.\\PrintSpoofer64.exe -i -c cmd.exe y luego type C:\\Users\\Administrator\\Desktop\\root.txt' },
    { id: 'wf2-svc', name: 'Por el servicio', flag: 'FLAG{eeeeeeeeeeee}', clue: 'El servicio VulnSvc se puede reconfigurar. Escala y lee la bandera protegida.', hint: 'sc config VulnSvc binpath= "x"; sc start VulnSvc; type C:\\flags\\svc.txt' },
    { id: 'wf2-sam', name: 'El tesoro del registro', flag: 'FLAG{ffffffffffff}', clue: 'Solo SYSTEM puede leer C:\\Windows\\flag_system.txt. Consíguelo como quieras.', hint: 'Escala a SYSTEM (PrintSpoofer o el servicio) y type C:\\Windows\\flag_system.txt' },
  ];
  function setupWinCtf2(sh) {
    const f = (id) => WFLAGS2.find((x) => x.id === id).flag;
    WIN.buildBox(sh, {
      priv: ['SeImpersonatePrivilege'],
      services: { VulnSvc: { binpath: '"C:\\Program Files\\Vuln\\svc.exe"', state: 'stopped', canConfig: true, display: 'Vuln' } },
      files: [
        { path: 'C:\\Users\\thomas\\Desktop\\LEEME.txt', content: 'Nivel Windows 2: 3 banderas. Hay que llegar a SYSTEM/admin.\r\n' },
        { path: 'C:\\Users\\Administrator\\Desktop\\root.txt', content: f('wf2-potato') + '\r\n', adminOnly: true },
        { path: 'C:\\flags\\svc.txt', content: f('wf2-svc') + '\r\n', adminOnly: true },
        { path: 'C:\\Windows\\flag_system.txt', content: f('wf2-sam') + '\r\n', adminOnly: true },
      ],
    });
  }

  Object.assign(G.GAMES.sets, {
    w1: { challenges: WCH1, flags: WFLAGS1, setup: setupWinCtf1, maxLines: 6 },
    w2: { challenges: WCH2, flags: WFLAGS2, setup: setupWinCtf2, maxLines: 6 },
  });

  /* chuleta de Windows (se muestra cuando el mundo activo es Windows) */
  G.SHELL.DOCS.push(
    ...[
      ['Orientarte', 'whoami', 'Dice con qué usuario estás.', 'whoami'],
      ['Orientarte', 'whoami /priv', 'Tus privilegios de token: lo más importante en Windows.', 'whoami /priv'],
      ['Orientarte', 'whoami /groups', 'Tus grupos (¿Administrators?).', 'whoami /groups'],
      ['Orientarte', 'systeminfo', 'Versión de Windows y parches instalados.', 'systeminfo'],
      ['Orientarte', 'hostname', 'Nombre de la máquina.', 'hostname'],
      ['Reconocer', 'net user', 'Lista las cuentas; con un nombre, el detalle de una.', 'net user'],
      ['Reconocer', 'net localgroup administrators', 'Quién es administrador local.', 'net localgroup administrators'],
      ['Reconocer', 'tasklist', 'Procesos en marcha.', 'tasklist'],
      ['Reconocer', 'netstat -ano', 'Puertos abiertos y sus procesos.', 'netstat -ano'],
      ['Reconocer', 'set', 'Variables de entorno (a veces con contraseñas).', 'set'],
      ['Archivos', 'dir', 'Lista archivos de una carpeta.', 'dir C:\\Users'],
      ['Archivos', 'type', 'Muestra el contenido de un archivo.', 'type user.txt'],
      ['Servicios', 'sc query', 'Lista los servicios.', 'sc query'],
      ['Servicios', 'sc qc', 'Config de un servicio: qué binario ejecuta.', 'sc qc VulnSvc'],
      ['Servicios', 'sc config', 'Cambia el binario de un servicio (si puedes).', 'sc config VulnSvc binpath= "C:\\t\\x.exe"'],
      ['Servicios', 'sc start/stop', 'Arranca o para un servicio.', 'sc start VulnSvc'],
      ['Servicios', 'icacls', 'Quién puede escribir en un archivo o carpeta.', 'icacls "C:\\Program Files"'],
      ['Registro', 'reg query', 'Lee el registro (AlwaysInstallElevated, autologon…).', 'reg query HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer'],
      ['Credenciales', 'cmdkey /list', 'Credenciales guardadas en el sistema.', 'cmdkey /list'],
      ['Credenciales', 'runas /savecred', 'Ejecuta como otro usuario con una credencial guardada.', 'runas /savecred /user:Administrator cmd'],
      ['Escalar', 'PrintSpoofer', 'Con SeImpersonate, roba el token de SYSTEM.', '.\\PrintSpoofer64.exe -i -c cmd.exe'],
      ['Escalar', 'msiexec', 'Con AlwaysInstallElevated, instala un .msi como SYSTEM.', 'msiexec /quiet /qn /i payload.msi'],
      ['Escalar', 'reg save', 'Con SeBackupPrivilege, copia el SAM (hashes).', 'reg save HKLM\\SAM C:\\temp\\sam.hive'],
      ['Escalar', 'copy (unquoted)', 'Coloca tu binario en el hueco de una ruta sin comillas.', 'copy evil.exe "C:\\Program.exe"'],
      ['Botín', 'type flag', 'La prueba: user.txt y root.txt.', 'type C:\\Users\\Administrator\\Desktop\\root.txt'],
    ].map(([cat, cmd, desc, ex]) => ({ cat, cmd, desc, ex, os: 'windows' }))
  );

  /* práctica libre de Windows */
  G.LESSONS.push({
    id: 'win-libre',
    os: 'windows',
    title: 'Terminal libre',
    tag: 'A tu aire',
    mode: 'free',
    icon: '⌨',
    say: 'Una máquina Windows con varios caminos a SYSTEM. Pruébalos. Si la rompes, pulsa Reiniciar.',
    setup: box({
      priv: ['SeImpersonatePrivilege'],
      services: { VulnSvc: { binpath: '"C:\\Program Files\\Vuln\\svc.exe"', state: 'stopped', canConfig: true } },
      reg: { 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer\\AlwaysInstallElevated': 1, 'HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer\\AlwaysInstallElevated': 1 },
      creds: [{ target: 'PC', user: 'PC\\Administrator' }],
      files: [{ path: 'C:\\Users\\Administrator\\Desktop\\root.txt', content: 'libre_system\r\n', adminOnly: true }],
    }),
    body: `
      <p>Un Windows de pruebas con <b>varios</b> caminos a SYSTEM a la vez: SeImpersonate, un servicio reconfigurable,
      AlwaysInstallElevated y una credencial guardada. Explótalos todos.</p>
      <div class="cards">
        <div><code>whoami /priv</code><small>¿privilegio explotable?</small></div>
        <div><code>.\\PrintSpoofer64.exe -i -c cmd.exe</code><small>Potato</small></div>
        <div><code>sc qc VulnSvc</code><small>servicios</small></div>
        <div><code>reg query HKLM\\...\\Installer</code><small>AlwaysInstallElevated</small></div>
        <div><code>cmdkey /list</code><small>credenciales</small></div>
        <div><code>whoami</code><small>confirma quién eres</small></div>
      </div>
      <p>Abre la <b>Chuleta</b> de arriba para ver todas las técnicas con su ejemplo.</p>`,
    steps: [],
  });
})(typeof window !== 'undefined' ? window : globalThis);
