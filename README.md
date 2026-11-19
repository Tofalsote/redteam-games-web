# Red Team Lab

Laboratorio para aprender **escalada de privilegios y pivoting** (seguridad ofensiva / red team) en
**Linux y Windows**, jugando. Pensado para estudiantes de ciberseguridad que usan Kali.

Simulas el momento en que ya tienes una **shell** en una máquina y aprendes, paso a paso, a enumerar,
pivotar y escalar hasta **root** (Linux) o **SYSTEM** (Windows). Tiene el **aspecto de una terminal de Kali**
(prompt de dos líneas incluido). Todo ocurre en el navegador: la máquina, el sistema y las técnicas son un
**simulador**; **ninguna de estas técnicas funciona fuera de esta página**, no hay exploits reales.

## Abrirla

1. Descomprime el zip entero (no abras `index.html` desde dentro del zip).
2. Haz doble clic en `index.html`.

Funciona en Windows, macOS y Linux con un navegador actual. No necesita instalación, servidor ni Internet.

## Dos mundos (pestaña arriba a la izquierda)

### 🐉 Linux — 4 niveles
- **1 · El punto de apoyo**: orientación tras la shell, estabilizar la TTY, reconocimiento, botín y credenciales.
- **2 · Enumeración**: `sudo -l`, SUID (`find -perm -4000`), cron, capabilities, archivos escribibles y credenciales.
- **3 · Pivoting de usuario**: contraseña reutilizada (`su`), clave SSH (`ssh`), `sudo -u` y una cadena completa.
- **4 · Escalada a root**: sudo mal configurado (GTFOBins), SUID, cron escribible, `cap_setuid`, `/etc/passwd` y un asalto final.

### 🪟 Windows — 5 niveles
- **1 · Reconocimiento**: `whoami /priv`, `whoami /groups`, `systeminfo`, `net user`, `tasklist`, botín y `cmdkey`.
- **2 · Privilegios de token**: entender `whoami /priv`, `SeImpersonatePrivilege` → SYSTEM (PrintSpoofer/Potato), `SeBackupPrivilege` (SAM).
- **3 · Servicios**: `sc query/qc`, permisos débiles (`sc config`), ruta sin comillas (unquoted path).
- **4 · Credenciales y registro**: `runas /savecred`, AlwaysInstallElevated (`msiexec`).
- **5 · El asalto final**: de una shell de servicio a SYSTEM, tú solo.

Cada nivel (o casi) tiene su **zona de juego**: un contrarreloj y una caza de banderas. Las banderas son números
aleatorios distintos en cada navegador, así que no sirve copiar las de otra persona.

El panel de la derecha se adapta: en Linux es un **explorador de archivos** (muestra el bit SUID y los dueños); en
Windows es el panel **Sesión** (usuario, nivel de integridad y privilegios de token, marcando los explotables).

## Dónde tocar

| Archivo | Contenido |
| --- | --- |
| `js/lessons.js` / `js/winlessons.js` | Misiones de Linux / de Windows |
| `js/games.js` | Datos y juegos de Linux (Windows: dentro de winlessons.js) |
| `js/redteam.js` | Motor del laboratorio Linux (máquina vulnerable y técnicas) |
| `js/winshell.js` | Motor del laboratorio Windows (shell cmd/PowerShell y técnicas) |
| `js/shell*.js`, `js/fs.js` | Terminal de Linux y archivos simulados |
| `js/app.js` | Interfaz, cambio de mundo, prompt, puntos, rangos y logros |
| `css/style.css` | Diseño (aspecto Kali; variables al final del archivo) |

Es un simulador educativo: reconoce las técnicas correctas y reacciona, pero no ejecuta nada real.
El progreso se guarda en el navegador de cada persona (`localStorage`).

## Puntos y rangos

Puntos y rangos: el último rango llega al terminarlo todo jugando bien; repetir un juego solo suma si mejoras tu récord. Y hay un logro oculto para quien lo complete al 100 %.
