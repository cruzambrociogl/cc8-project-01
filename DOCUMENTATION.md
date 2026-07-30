# CTF-GRID — Documentación Técnica (Team 6)

Juego de captura la bandera implementado sobre el **protocolo binario PRFC-CC8-2026
v3.0**, para que todos los equipos del curso (13 equipos, 6 lenguajes) puedan
interoperar sobre un mismo formato de cable. El stack del Team 9 es **JavaScript**
con un renderer de navegador en **Phaser**, más un pequeño **bridge** y servidor en
**Node.js**.

- Spec completa del protocolo: [`protocolo/PRFC-VERSION-3.md`](protocolo/PRFC-VERSION-3.md)
- Nuestras aclaraciones propuestas: [`protocolo/PRFC-VERSION-3-enmiendas-parte1.md`](protocolo/PRFC-VERSION-3-enmiendas-parte1.md)
- Inicio rápido: [`README.md`](README.md) · Handoff del equipo: [`HANDOFF.md`](HANDOFF.md)

---

## 1. Tecnologías

| Área | Elección | Por qué |
|---|---|---|
| Lenguaje | JavaScript (ES modules) | Stack del equipo; el mismo codec corre en Node y en el navegador |
| Runtime | Node.js (servidor, bridge, servidor de archivos estáticos) | TCP nativo (`node:net`) y UDP (`node:dgram`) |
| Renderer | Phaser 3 (vendorizado, `web/vendor/phaser.min.js`) | Renderizado 2D canvas/WebGL en el navegador |
| Navegador↔SO | WebSocket (paquete npm `ws`) | Los navegadores no pueden abrir TCP/UDP crudo; el bridge traduce |
| Formato de cable | **Binario** a medida, big-endian, con prefijo de longitud | Protocolo v3 (compacto, ~10× más chico que JSON) |
| Paso de build | **Ninguno** | ES modules planos servidos estáticamente; `npm install` solo trae `ws` |

La única dependencia de npm es **`ws`** (para el socket de espectador del servidor
y el bridge). Phaser está vendorizado como archivo (no es dependencia de npm) para
que el juego funcione offline en una LAN/VPN.

---

## 2. Arquitectura

Un único servidor autoritativo por partida; los clientes solo envían *intención*
(dirección de movimiento + interactuar), nunca posiciones. El servidor es dueño de
todo el estado y valida todo.

```
                      ┌─────────────────────────────┐
                      │          SERVER             │  dueño del estado del juego, 20 ticks/s
                      │  TCP :5000  (gameplay)      │  autoritativo, sin entidad propia
                      │  UDP :5001  (discovery)     │
                      │  WS  :5200  (host view)     │
                      └───┬───────────┬─────────────┘
       raw TCP + UDP      │           │  WebSocket (localhost)
   (clientes en lenguaje──┘           └──────── [ host view / spectator.html ]
    nativo se conectan                            vista read-only + Start/Reset
    directamente)             │
                             │  nuestro cliente de navegador no puede hacer TCP/UDP crudo, entonces:
                   ┌─────────┴──────────┐
                   │   BRIDGE (Node)    │  WS :8080  ⇄  TCP :5000 / UDP :5001
                   │  pipe de bytes     │
                   │  tonto + discovery │
                   │  UDP               │
                   └─────────┬──────────┘
                             │  WebSocket (frames binarios)
                   ┌─────────┴──────────┐
                   │ CLIENTE NAVEGADOR  │  index.html + Phaser (web/game.js)
                   │  (el jugador)      │  teclado → INPUT/INTERACT, renderiza GAME_STATE
                   └────────────────────┘
```

El cliente de cualquier equipo debe poder jugar en el servidor de cualquier otro
equipo. Un cliente en lenguaje nativo (Rust, Go, Java, C#, Python) se conecta
**directamente** por TCP; nuestro cliente de navegador pasa por el bridge. Desde el
punto de vista del servidor son idénticos.

---

## 3. Estructura del proyecto

| Archivo | Rol |
|---|---|
| `protocol.js` | **El codec binario** — única fuente de verdad del formato de cable. `encode`/`decode` para cada mensaje, `frame`/`StreamFramer` para el framing con prefijo de longitud en TCP, helpers de punto fijo, enums. Corre en Node *y* en el navegador. |
| `protocol.test.js` | Auto-tests de conformidad — golden bytes y round-trip de cada mensaje (`npm test`). |
| `server.js` | Servidor autoritativo: gameplay por TCP, discovery por UDP, loop de juego a 20 tps, WS de host-view, arranque controlado por el host. |
| `bridge.js` | Gateway WS↔TCP/UDP para el cliente de navegador. Cero lógica de juego. |
| `serve.js` | Servidor HTTP estático mínimo para la UI web (puerto 5173). |
| `bot.js` | Cliente de prueba headless (TCP crudo) que se une y juega hacia la bandera. |
| `web/index.html` | UI del jugador: conectar, descubrir/elegir un servidor, unirse; aloja el canvas de Phaser. |
| `web/spectator.html` | Vista del host: render cenital read-only + controles Start / New-match. |
| `web/net.js` | Networking del navegador: WebSocket + codec + estado del mundo + interpolación de snapshots. |
| `web/game.js` | Escena de Phaser: renderiza mapa, círculo, bandera, jugadores; lee el teclado. |
| `web/vendor/phaser.min.js` | Phaser 3 vendorizado (funciona offline). |
| `protocolo/` | La spec v3 y nuestras enmiendas propuestas. |

---

## 4. El protocolo (resumen)

Detalles completos en [`protocolo/PRFC-VERSION-3.md`](protocolo/PRFC-VERSION-3.md). Puntos clave:

- **Binario, big-endian.** Todos los enteros multi-byte van en orden de red.
- **Framing (TCP):** cada mensaje va precedido de una longitud `u16` big-endian,
  seguida de esa cantidad de bytes de cuerpo. El cuerpo empieza con `u8 type` +
  `u8 version(=3)`. (Los datagramas UDP llevan un solo mensaje, sin prefijo de
  longitud.)
- **Coordenadas de punto fijo:** las unidades del mundo se envían como `i32` de
  `valor × 100` (ej. `-120.75` → `-12075`). Esto evita discrepancias de floats
  entre lenguajes — ningún número de punto flotante cruza el cable jamás.
- **Lector tolerante:** los tipos de mensaje desconocidos pero bien enmarcados se
  saltan; un error real de framing/decode cierra la conexión.

### Conjunto de mensajes

| Código | Mensaje | Dir | Propósito |
|---|---|---|---|
| `0x01` | DISCOVER_REQUEST | C→bcast (UDP) | "¿hay servidores por ahí?" |
| `0x02` | DISCOVER_RESPONSE | S→C (UDP) | anuncio del servidor: nombre, puerto TCP, jugadores |
| `0x10` | JOIN | C→S | solicitud para unirse (`name`) |
| `0x11` | INPUT | C→S | dirección activa (UP/DOWN/LEFT/RIGHT/NONE) |
| `0x12` | INTERACT | C→S | presionar la tecla de interactuar (agarrar/robar) |
| `0x13` | LEAVE | C→S | salir voluntariamente |
| `0x20` | JOIN_ACCEPTED | S→C | `playerId` asignado |
| `0x21` | JOIN_REJECTED | S→C | razón (lleno / ya empezó / …) |
| `0x22` | LOBBY_STATE | S→C | lista de jugadores mientras se espera |
| `0x23` | GAME_COUNTDOWN | S→C | segundos restantes |
| `0x24` | GAME_STARTED | S→C | configuración completa (mapa, círculo, velocidad…) + jugadores |
| `0x25` | GAME_STATE | S→C | snapshot autoritativo, cada tick |
| `0x26` | FLAG_PICKED_UP | S→C | alguien agarró la bandera |
| `0x27` | FLAG_STOLEN | S→C | la bandera cambió de portador |
| `0x28` | PLAYER_DISCONNECTED | S→C | un jugador se fue |
| `0x29` | GAME_OVER | S→C | ganador |
| `0x2A` | ERROR | S→C | código de error no fatal |

Chequeo de golden bytes: un `INPUT` del jugador `7` moviéndose hacia arriba
serializa al cuerpo `11 03 00 07 01`, enmarcado en TCP como
`00 05 11 03 00 07 01`. `npm test` lo verifica.

---

## 5. Mecánicas del juego

- **Mapa:** un plano **continuo** de 2000×2000 (no una grilla). El origen `(0,0)`
  es el centro; **x crece a la derecha, y crece hacia abajo** (convención de
  pantalla). Los jugadores quedan acotados a los límites del mapa (±1000).
- **Círculo central:** radio 500, centrado en el origen. La única bandera está en
  el centro.
- **Movimiento:** 4 direcciones (UP/DOWN/LEFT/RIGHT) o NONE (detenerse). El
  cliente envía su *dirección activa* solo cuando cambia; el servidor avanza a
  cada jugador un paso por tick (`playerSpeed × tickInterval`, por defecto
  220 u/s a 20 tps = 11 u/tick). Los jugadores no colisionan entre sí.
- **Agarrar la bandera:** presionar interactuar dentro del `interactionRadius`
  (60) de la bandera mientras está en el suelo → la cargas (`FLAG_PICKED_UP`).
- **Robar:** presionar interactuar dentro del rango del portador actual → la
  bandera cambia de manos al instante (`FLAG_STOLEN`). **Sin inmunidad, sin
  cooldown** — puede cambiar de manos en cada tick. Robos simultáneos en un
  mismo tick se resuelven por el `playerId` más bajo.
- **Ganar:** cargar la bandera **completamente fuera** del círculo
  (`distance(player, origin) − playerRadius > circleRadius`). El primero en
  lograrlo gana; el servidor envía el `GAME_STATE` final y luego `GAME_OVER`.
- **Desconexión:** el jugador se elimina; si cargaba la bandera, esta cae donde
  estaba y puede volver a agarrarse.
- **Loop de tick del servidor (20 Hz):** drenar inputs → mover y acotar →
  resolver interacciones por `playerId` ascendente → actualizar la bandera →
  chequear victoria → incrementar el tick → enviar eventos y luego `GAME_STATE`.

---

## 6. Conectividad cliente-servidor

### Puertos

| Puerto | Transporte | Usado para |
|---|---|---|
| `5000` | TCP | gameplay (la partida) |
| `5001` | UDP | discovery de servidores (broadcast) |
| `5200` | WebSocket (localhost) | vista de host / espectador + controles del host |
| `8080` | WebSocket | bridge ⇄ cliente de navegador |
| `5173` | HTTP | UI web estática |

> En macOS, el puerto **5000 lo usa AirPlay Receiver**, así que en la práctica
> corremos el servidor en **5100**. Todas las partes son configurables.

### Ciclo de vida

1. **Discovery (opcional).** El cliente (vía su bridge) hace broadcast UDP de
   `DISCOVER_REQUEST` en el 5001. Los servidores en estado *waiting* responden
   con `DISCOVER_RESPONSE` (su nombre, puerto TCP, cantidad de jugadores). El
   cliente los lista; ingresar la IP manualmente siempre está disponible como
   respaldo.
2. **Join.** El cliente abre TCP hacia el servidor y envía `JOIN`; el servidor
   responde `JOIN_ACCEPTED` (+ `playerId`) o `JOIN_REJECTED`.
3. **Lobby.** El servidor transmite `LOBBY_STATE` a medida que los jugadores
   entran y salen.
4. **Start.** El **host** (operador del servidor) arranca la partida —
   presionando ENTER en la terminal del servidor, o con el botón **Start
   match** en la vista del host. El servidor envía `GAME_COUNTDOWN` × N, luego
   `GAME_STARTED` (configuración completa).
5. **Play.** El cliente envía `INPUT`/`INTERACT`; el servidor transmite
   `GAME_STATE` en cada tick más mensajes de evento.
6. **End.** `GAME_OVER`. El host puede reiniciar a un lobby nuevo (**New
   match**).

### El bridge (por qué existe)

Los navegadores no pueden abrir sockets TCP o UDP crudos. El bridge es un
**pipe de bytes tonto** que habla WebSocket con la página y TCP/UDP crudo con
la red del juego:
- Los frames WS de **texto** = control (`discover`, `connect`) — solo para el
  bridge, nunca llegan al servidor.
- Los frames WS **binarios** = mensajes del juego — se retransmiten tal cual
  hacia/desde el TCP del servidor (el bridge es dueño del framing `u16` para
  que el navegador maneje mensajes completos).
- El bridge hace el broadcast UDP de discovery en nombre del navegador.

Los equipos en lenguaje nativo no necesitan bridge — abren los sockets
TCP/UDP directamente.

### Postura de robustez / interoperabilidad

- Las **conexiones muertas** se detectan con **TCP keepalive**
  (`setKeepAlive`), no con un timer de inactividad a nivel de app — así un
  cliente válido pero silencioso (esperando en el lobby, o quieto) nunca es
  expulsado. (Hay un idle-timeout de app disponible pero deshabilitado por
  defecto; habilitarlo rompería la interoperabilidad con clientes que no
  envían keepalive.)
- **Lector tolerante:** nunca rechazamos un `JOIN` por el nombre (aceptamos
  cualquiera, lo acotamos para mostrarlo), y saltamos tipos de mensaje
  desconocidos. Principio: *estrictos en lo que enviamos, tolerantes en lo
  que aceptamos.*

---

## 7. Uso

Requiere **Node.js**. Desde la carpeta `game/`:

```bash
npm install          # trae `ws`
npm test             # verifica el codec (chequeos de golden-byte + round-trip)
```

### Correr un servidor (host)

```bash
node server.js 5100 "My Server"      # puerto 5100, nombre mostrado en discovery
# luego presiona ENTER (o usa la vista de host) para arrancar cuando haya jugadores
```

### Vista de host (ver + controlar la partida)

```bash
npm run web                          # sirve la UI en http://localhost:5173
```
Abrir `http://localhost:5173/spectator.html` → **Watch** → **▶ Start match** /
**↻ New match**. El host no juega (según el §4 del protocolo).

### Jugar como cliente

```bash
node bridge.js 8080                  # WS 8080 + UDP discovery 5001
npm run web                          # http://localhost:5173
```
Abrir `http://localhost:5173`:
1. Bridge `ws://localhost:8080` → **Connect bridge**
2. **Find servers** (elegir uno) o escribir Host/Port manualmente → poner un
   Nombre → **Join**
3. Moverse con **flechas / WASD**; agarrar o robar con **Espacio / E**; sacar
   la bandera del círculo para ganar.

### Entre máquinas (LAN / Radmin VPN / Tailscale)

- Correr el servidor en una máquina; cada jugador corre su propio `bridge.js`
  + UI web y ya sea **descubre** el servidor (funciona en una LAN y sobre
  **Radmin VPN**, que sí propaga broadcast) o **escribe la IP del host**
  (necesario sobre Tailscale, que no propaga broadcast).
- Permitir el aviso del firewall del SO para `node` en la máquina del
  servidor.

### Bot de prueba headless

```bash
node bot.js BotName 127.0.0.1 5100   # se une y juega hacia la bandera (TCP crudo)
```

---

## 8. Estado y limitaciones

- **Hecho:** codec binario (probado), servidor autoritativo + loop de juego
  completo, cliente de navegador con renderizado en Phaser + interpolación de
  snapshots, bridge WS/UDP, discovery de servidores, lobby + arranque
  controlado por el host + reinicio, vista de host/espectador, y
  endurecimiento de interoperabilidad con base-v3.
- **No implementado (opcional):** predicción del lado del cliente (§31),
  pulido visual más allá del renderer funcional, reconexión (explícitamente
  fuera de alcance en la spec).
- **Salvedad de interoperabilidad:** toda la clase debe estar en el protocolo
  v3 para jugar entre equipos; v3 es una propuesta (v2 era la spec previa).
  Nuestras enmiendas (`protocolo/…enmiendas…`) son aclaraciones, no cambios
  de cable — interoperamos con equipos que solo tienen base-v3.

---

## 9. Uso de IA

Cómo usamos IA en este proyecto, por transparencia (como lo pide el curso).
Esta sección es la narrativa curada; el registro verbatim completo de
prompts está en el §10 más abajo (61 prompts, extraídos de las transcripciones
de sesión).

### Herramienta y método

- **Herramienta:** Claude Code — el asistente de IA de línea de comandos de
  Anthropic (basado en chat, pero puede leer/escribir archivos del repo y
  correr comandos como `node`, `git`, tests).
- **Modelo:** Claude Opus.
- **Cómo trabajamos:** de forma conversacional e iterativa. Nosotros (los
  humanos) fijamos los objetivos, tomamos cada decisión de diseño, revisamos
  cada cambio y corrimos/probamos todo. La IA hizo análisis, escribió código
  y explicó trade-offs. Cada feature se verificó (tests de golden-byte, bots
  headless, corridas reales entre dos máquinas por Tailscale/Radmin) y se
  commiteó a Git — el historial de commits es el registro de lo que quedó.
- **Registro:** Claude Code guarda cada sesión como una transcripción local
  `.jsonl`, así que tenemos el historial completo de prompts/respuestas. El
  §10 está extraído de ahí.

### Qué hizo la IA vs. qué decidimos nosotros

| La IA ayudó con | Nosotros decidimos / fue nuestro |
|---|---|
| Revisar los borradores del protocolo, encontrar vacíos/contradicciones | Qué juego/protocolo construir; adoptar v3 binario |
| Escribir el codec, servidor, bridge, cliente, tests | La arquitectura, los puertos, y cada decisión de trade-off |
| Explicar trade-offs (binario vs JSON, TCP vs WebSocket, discovery) | Rechazar MessagePack; movimiento en 4 direcciones; punto fijo |
| Debuggear las desconexiones entre equipos | Probar con otros equipos y reportar qué fallaba |
| Ops: setup de git, transferencia de archivos, docs | Qué entregar y cuándo |

### Fase por fase

#### 9.1 Diseño y revisión del protocolo
Le pedimos a la IA que analizara nuestro borrador de protocolo y razonara
sobre la arquitectura: cliente vs. servidor, grilla vs. mapa continuo, y
transporte. Hallazgo clave que sacó a la luz: **los navegadores no pueden
abrir TCP/UDP crudo**, así que nuestro equipo de JS/Phaser necesita un
proceso bridge. Revisó la spec y produjo correcciones concretas de vacíos.
Nosotros decidimos la dirección; ella hizo el análisis y el borrador.

#### 9.2 Demo de esqueleto mínimo (JSON)
Construimos primero la porción end-to-end más delgada — servidor + bridge +
una página web plana mostrando mensajes en vivo — para probar el camino de
comunicación antes de cualquier lógica de juego. La probamos **entre
máquinas** (host Mac ↔ VM Windows) por Tailscale. Esto desriesgó temprano la
parte más difícil (comunicación entre máquinas vía bridge).

#### 9.3 Alineación con la spec de la clase (v3 binario)
Cuando la spec real del grupo resultó ser **PRFC-CC8-2026 v3.0** (plano
continuo, formato de cable **binario**), le pedimos a la IA que la comparara
con nuestro borrador de grilla y marcara que eran juegos distintos. Después
discutimos eficiencia (binario vs. JSON vs. MessagePack); **rechazamos
MessagePack** y nos comprometimos con el v3 binario del grupo. La IA
escribió nuestras aclaraciones propuestas
([`protocolo/…enmiendas…`](protocolo/PRFC-VERSION-3-enmiendas-parte1.md)).

#### 9.4 Implementación (Parte 2), construida y probada en rebanadas
Cada rebanada se escribió, se probó headless, y se commiteó:
- **Codec binario + tests de golden-byte** — la base de interoperabilidad
  (`protocol.js`, `protocol.test.js`).
- **Servidor + loop de juego** — movimiento, agarrar/robar la bandera,
  victoria, 20 tps (`server.js`).
- **Bridge** — relay binario WS↔TCP (`bridge.js`).
- **Fase 1** — cliente renderizado con Phaser con interpolación de snapshots
  (`web/`).
- **Fase 2** — lobby + arranque controlado por el host + cuenta regresiva.
- **Fase 3** — discovery de servidores por UDP (el bridge hace el broadcast
  por el navegador).
- **Vista de host/espectador** — el servidor "muestra el juego" según el §4,
  con controles Start/New-match; nombrado del servidor al lanzarlo.

#### 9.5 Correcciones de interoperabilidad entre equipos (de pruebas reales)
Jugar contra otros equipos expuso bugs que luego arreglamos con la IA:
- Jugadores eran **expulsados del lobby** — nuestro idle-timeout descartaba
  clientes válidos pero silenciosos (throttling de pestaña en segundo plano,
  y otros equipos sin keepalive). Arreglo: deshabilitar el idle-timeout de la
  app, detectar pares muertos vía **TCP keepalive** en su lugar.
- Hicimos que el servidor fuera un **lector tolerante** — nunca rechazar un
  join por el nombre; enviar solo exactamente lo que define la spec.
  Principio: *estrictos en lo que enviamos, tolerantes en lo que aceptamos.*

#### 9.6 Ops y documentación
Configuramos el repo de Git y lo pusheamos, transferimos los builds a la VM
de prueba (Taildrop), armamos el paquete de entrega, y escribimos esta
documentación técnica.

---

## 10. Registro de prompts a la IA (verbatim)

Registro verbatim de los prompts que le dimos a Claude Code (el CLI de
Anthropic) mientras construíamos este proyecto, extraído de las
transcripciones locales de sesión y ordenado cronológicamente. Se omiten
salidas de herramientas, mensajes de sistema y slash-commands; se quitaron
duplicados exactos. Sesiones: `3e39ab02` (2026-07-24) y `1ffbb9ae`
(2026-07-28/29). Total: 61 prompts.

> **Nota:** los prompts se dejan tal como se escribieron originalmente (en
> inglés, con errores de tipeo incluidos) porque este es un registro
> verbatim — traducirlos alteraría el registro histórico real de lo que se
> escribió.

### 1. 2026-07-24 05:17:22 UTC

> please analize it we are starting a new project

### 2. 2026-07-24 05:20:16 UTC

> see each team will develop something similar see we all are going to connect to radmin or tailscale, then comunicate each, somewhere somehow a session will be created all of the teams will connect to that session, each team will be a player the comunication shoud be like realtime the first that capture the flag wins so it thas to be realtime, we all will be using different technologies to create the our  version of the game, thats what is interesting about the project the same game idea, different technologies, realtime updates we all talking to eachother
> here is where the protocol comes we need to design some protocol so we all talk the same language and we are able to play the game
> you get the idea?  lets discuss about that first
>
> we need to design that architecture, we dont know if we need servers or clients,  i think a 2d frid is ok for starters so we hav eposition and colitions we can race but im not sure as i said we need to define that, actually if we go for the grid for example, that decision should be part of the protocol
>
>
> this is just the first draft but is not fixed at all still need refinement

### 3. 2026-07-24 05:38:32 UTC

> im not getting what are you asking, the only real constrain we have right now is the techstack each team have chosen, we cannot change those, those are fixed we need to plan our protocol and standard compatible with all of them,

### 4. 2026-07-24 05:42:00 UTC

> i just have this list
> | # | Integrantes | Lenguaje | Red | Gráficos |
> |---|---|---|---|---|
> | 1 | Guillermo Martínez, Gabriel García | Rust | Socket | Macroquad |
> | 2 | Jorge Cuevas, Santiago Maldonado | JavaScript | Socket | Three.js |
> | 3 | Emely Batres, Víctor Arias | Python | Socket | pygame |
> | 4 | Samantha Rodas, Carlos Adolfo Álvarez | Java | Socket | Swing |
> | 5 | Ricardo Caballeros, Cristian Sactic | C# | .NET | por confirmar |
> | 6 | Erick Mejía, José Rivera | Go | NET | Ebitengine |
> | 7 | Javier Rodas, Cristopher García | Python | Socket | pygame |
> | 8 | José España, Lester Hernández | C# | Socket | Raylib |
> | 9 | Cruz Ambrocio, Rosángela Rodríguez | JavaScript | Socket | Phaser |
> | 10 | Carlos Milán, Herbert Álvarez | Java | Socket | Swing |
> | 11 | José Ordóñez, Rodrigo Ávila | Python | Socket | Arcade |
> | 12 | Derek Tórtola, Edgar Cordón | Rust | por confirmar | por confirmar |
> | 13 | Carlos Yoc, Emmanuel López | TypeScript | por confirmar | HTML y CSS |

### 5. 2026-07-24 05:45:57 UTC

> what if we all go for sockets?

### 6. 2026-07-24 05:50:21 UTC

> lets assume this is the case, we all go for sockets and we either use  a helper (bridge) or electron i think we can handle both, so i would not worry about that,
> if thats decided then we need to validate our protocol and standard for this scenario

### 7. 2026-07-24 05:54:41 UTC

> i think i agree with the fixes

### 8. 2026-07-24 06:30:30 UTC

> the json format, can generate lag?

### 9. 2026-07-24 21:41:28 UTC

> hey i got this message from my classmates:
>
> Propuesta de Actualización Urgente - Protocolo v3.0 (Prevención de Lag Masivo)
>
> Compañeros, revisando la arquitectura del proyecto con el auxiliar, detectamos un problema crítico de rendimiento en la versión 2.0 del protocolo que nos afectará a todos el día de la entrega.
>
> EL PROBLEMA:
> Actualmente, el PRFC exige enviar el estado del juego en formato JSON en texto plano 20 veces por segundo. Si logramos la meta de 100 jugadores, el servidor tendría que enviar un JSON de aproximadamente 10 KB a cada uno de los 100 clientes, 20 veces por segundo. Esto generaría un tráfico de 20 Megabytes por segundo (MB/s) continuos de subida para el anfitrión. En una red como Radmin VPN, esto causará lag masivo, saturación de la red y desconexiones inmediatas.
>
> LA SOLUCIÓN (Actualización a v3.0):
> Para solucionar esto sin tener que reescribir toda la lógica o pelearnos con el manejo de bytes manual (endianness, padding, etc.), proponemos usar MessagePack.
> MessagePack es un estándar que funciona exactamente igual que JSON (es decir, usamos los mismos campos y estructura que ya definimos), pero los comprime en formato binario automáticamente, reduciendo el peso de la red drásticamente.
>
> CAMBIOS AL DOCUMENTO PRFC-CC8-2026:
> Se propone modificar la "Sección 23. Formato de comunicación" con las siguientes reglas para todos los lenguajes:
>
> Nueva Versión: Todos los mensajes deben llevar el campo "protocolVersion": "3.0".
>
> Formato Base: Se elimina el JSON en texto. Todo se serializará a binario usando la librería de MessagePack.
>
> Comunicación TCP (El Juego):
> Como TCP es un flujo continuo de datos y MessagePack genera bytes crudos (ya no podemos usar el salto de línea \n para separar mensajes), cada mensaje debe ir precedido por un Encabezado de 4 bytes (UInt32 Big Endian) que indique el tamaño exacto del mensaje que le sigue.
> Estructura del paquete TCP: [4 bytes de tamaño] + [Payload binario de MessagePack]
>
> Comunicación UDP (Descubrimiento):
> Los datagramas UDP ya tienen límites naturales. Un datagrama UDP contendrá exactamente un mensaje serializado con MessagePack (SIN el encabezado de 4 bytes).
>
> LIBRERÍAS RECOMENDADAS POR LENGUAJE:
> Esta optimización no requiere reescribir sus objetos ni clases. Solo deben instalar la librería oficial de MessagePack para su lenguaje y cambiar sus funciones de "JSON Parse" a "MessagePack Decode":
>
> Rust: rmp-serde (Se integra directo con Serde, igual que JSON).
>
> JavaScript / TypeScript: @msgpack/msgpack (Librería oficial de npm).
>
> Python: msgpack (Se instala con pip install msgpack).
>
> Java: msgpack-java o jackson-dataformat-msgpack.
>
> C# (.NET): MessagePack-CSharp (Recomendada por Microsoft, súper rápida).
>
> Golang: [github.com/vmihailenco/msgpack/v5](https://github.com/vmihailenco/msgpack/v5)
>
> Si todos estamos de acuerdo, adoptemos este estándar desde ya para asegurar que nuestras computadoras soporten las 100 conexiones simultáneas sin crashear.

### 10. 2026-07-25 00:08:53 UTC

> PRFC-CC8-2026 was the first draft of the plan we had now obsolete,
> what they meant with 100 players its that even tho we are just 13 ish teams we will can be 26 players, we also need to be prepared that i gave a copy of my game to antoher person they will be able to connect as an extra player untill 100 conections you get what im saying?
> our analisys should be like how using json will impact if there are that many connections, the lag is a real issue, suppose we are having a poor bandwidth connection

### 11. 2026-07-25 00:10:09 UTC

> PRFC-CC8-2026 was the first draft of the plan we had now obsolete,
> what they meant with 100 players its that even tho we are just 13 ish teams we will can be 26 players, we also need to be prepared that i gave a copy of my game to antoher person they will be able to connect as an extra player untill 100 conections you get what im saying?
> our analisys should be like how using json will impact if there are that many connections, the lag is a real issue, suppose we are having a poor bandwidth connection
> i also need to understand how the MessagePack will work in our plan if for some reason
> i need to understand everything, know the tradeoffs

### 12. 2026-07-25 00:59:11 UTC

> before you do that,
> you say deltas, im imagin this like this
> the server creates the session then each player connects the few send and retrivals will contain the most data, once everyone is connected we just share deltas, we can easly use json with positions arrays right? with the messagepack we are suceptible to loose data? monitoring and debugging gets harder with messagepack right?
> see the goal is 100 but realistically when testing we are not even hitting 50,

### 13. 2026-07-25 01:18:46 UTC

> go ahead

### 14. 2026-07-25 01:27:13 UTC

> i think there is not more improvement to do to the plan without making thinks more complex, or you have something to add?
> what if we for a demo, which entities are needed like a server, node to connecto tthe socket and a ui right?

### 15. 2026-07-25 01:27:39 UTC

> i think there is not more improvement to do to the plan without making thinks more complex, or you have something to add?
> what if we for a demo, which entities are needed like a server, node to connecto tthe socket and a ui right?
> no code yet, lets keep discussing

### 16. 2026-07-25 02:11:55 UTC

> no yet
> see i was imagining something simpler just to show how it would work, for now just with my stack
> - a little webpage with only the necesary elements to connect and a button maybe to send like if the player did amove  and some labels showing the messages from the other players
> - a node app that works as the bridge, simple like that
> - a server that creates a session, accepts the connection, manage all the session logic, wait for the messages from the players and send the status each x bits, for the demo just the "session" simulation, in the first time a player connect send all the details about the session, then send just the message the player send with the button, if a new player joins show send that too to the players, and send also just the messages the the playes send with the button
>
> and thats it i will install here and a virtual machine the node+webpage so i can simulate one server and two players.
> i think my idea is missing a lot things but i wanted that to be as simple as possible but showing a use case of working comunication
> what do you think

### 17. 2026-07-25 02:17:09 UTC

> yes, the speak the real protocol, is needed thanks lets plan now what we will implement then we have a good setup idea

### 18. 2026-07-25 02:57:45 UTC

> - the server will serve the players the grid specs and who start the session can configure that, for the demo make the server just seve 4x4 grid nothing else we are not making moves yet, i just want to show with labels what each player send like just the messages
> - no yet lets keep the demo simple
>
> what else should we consider?

### 19. 2026-07-25 03:05:54 UTC

> go with intent

### 20. 2026-07-25 03:07:22 UTC

> yes wite the DEMO.md

### 21. 2026-07-25 03:08:42 UTC

> lets start then

### 22. 2026-07-25 03:52:50 UTC

> good it worked now i see it working
> now check this file PROJECT01/CC8-Protocolo/protocolo/PRFC-CC8-2026.md
> there you have the draft of the game we agreed some time ago just check it i will askyou things later

### 23. 2026-07-25 04:12:18 UTC

> we know the json works and is simpler but yes as you said ""real"/more impressive engineering" is why we are discussing binary

### 24. 2026-07-25 04:20:46 UTC

> what do you tthink about this
> PROJECT01/CC8-Protocolo/acuerdos/PRFC-VERSION-3.md

### 25. 2026-07-25 04:25:54 UTC

> lets suppose we drop the json option and we go for this, what would be needed to implement that, smoething missing in the protocol? what is the job now?

### 26. 2026-07-25 18:44:28 UTC

> - give me an md file with what i should append to the v3 about the part 1, i think you know what to suggest
> later we will work on part 2

### 27. 2026-07-25 18:48:12 UTC

> yes lets go with part two, leave the demo as it is make a copy and apply the changes on that copy

### 28. 2026-07-25 19:06:07 UTC

> go with the bridge
> i still think you are dooing too much, the demo should work the same as it was with the json just adding the new protocol with all the new things to make it work, im not looking for the game working now

### 29. 2026-07-25 19:40:47 UTC

> correct me if im wrong, but i think we are printing in the ui every tick
> if i do a move i can see in my ui but i dont see in the other client and viceversa

### 30. 2026-07-25 19:57:34 UTC

> P1(Cruz) x= 1000.0 y= 673.7 dir=RIGHT ← you
> P2(Alex) x= 1000.0 y= -1000.0 dir=UP
>
> i this, the x or y when someone makes a the number keeps changing like increasing or decreasing is that normal?

### 31. 2026-07-25 20:00:58 UTC

> ok i need to send this to rosangela
> she will also use claude code, i need to send to her the demo "game" that now we confirm that is working, also the protocol we are using
> i think we need a better md file to send to her our context of what we have build what is missing, and a copy of the v3 protocol of the team right am i missing something?

### 32. 2026-07-25 20:19:48 UTC

> do the git init, and link it to git@github.com:cruzambrociogl/cc8-project-01.git push the changes

### 33. 2026-07-25 23:44:44 UTC

> now we have that, can we start with the real game, whats the plan?

### 34. 2026-07-25 23:51:12 UTC

> go ahead with phase 1

### 35. 2026-07-25 23:58:20 UTC

> yes commit it

### 36. 2026-07-26 00:00:11 UTC

> go with phase 2

### 37. 2026-07-26 00:06:22 UTC

> yes commit

### 38. 2026-07-26 00:07:31 UTC

> go for it, we will use radmin

### 39. 2026-07-26 00:15:34 UTC

> commit it

### 40. 2026-07-26 00:17:28 UTC

> so no more code to write? just testing?

### 41. 2026-07-26 00:18:43 UTC

> send the game folder to the vm

### 42. 2026-07-26 00:28:23 UTC

> hey me as a server can i see he game?

### 43. 2026-07-26 00:30:00 UTC

> hey me as a server can i see he game? i nthe ui i shoul have a view of host or  server not a player

### 44. 2026-07-26 00:37:07 UTC

> quick quetion, what name is the name of my server?

### 45. 2026-07-26 00:37:25 UTC

> let me name it

### 46. 2026-07-26 00:40:18 UTC

> wait wait, the naming cant be set on the ui right? and in the command

### 47. 2026-07-26 00:41:50 UTC

> if i run this node server.js 5100 "martian"
> will it work? what i see in the ui how do i start the game? close the game? how many people?

### 48. 2026-07-26 00:44:55 UTC

> can i start and control the game as server from the ui?

### 49. 2026-07-26 00:52:44 UTC

> commit it and push ir

### 50. 2026-07-26 01:02:46 UTC

> ok it kind of worked, put a button to switch views to /http://localhost:5173/spectator.html on the client view
> and we tried and some of the people where disconnected, just one player survived

### 51. 2026-07-26 01:07:31 UTC

> commit it and push it

### 52. 2026-07-27 03:43:57 UTC

> we were testing with the other teams, see while waiting in the lobby, with me as host, some player were kicke out ,just disconnected they have to rejoin, im not sure what happend

### 53. 2026-07-27 04:00:47 UTC

> commit and puh

### 54. 2026-07-27 04:01:36 UTC

> what if we remove the enmiendas?

### 55. 2026-07-27 04:07:24 UTC

> asume other teams did not apply the enmiendas

### 56. 2026-07-27 04:11:32 UTC

> do both

### 57. 2026-07-27 04:37:52 UTC

> thanks
> my teamate is getting this error when running node server.js 5000 "martian_2"
> node server.js 5000 "martian_2"123abc$
>   UDP discovery error: bind EACCES 0.0.0.0:5001
> v3 binary server "martian_2123abc$" on 0.0.0.0:5000
>   host view (spectator): open the web UI at /spectator.html -> ws://localhost:5200
>   host-controlled: press ENTER to start the match when players have joined

### 58. 2026-07-27 04:39:00 UTC

> thanks
> my teamate is getting this error when running node server.js 5000 "martian_2"
> node server.js 5000 "martian_2"
>   UDP discovery error: bind EACCES 0.0.0.0:5001
> v3 binary server "martian_2123abc$" on 0.0.0.0:5000
>   host view (spectator): open the web UI at /spectator.html -> ws://localhost:5200
>   host-controlled: press ENTER to start the match when players have joined

### 59. 2026-07-29 03:18:15 UTC

> can you zip the game folder without the autogenerated things ready to submit

### 60. 2026-07-29 23:32:57 UTC

> check the current status of the project and generate a documentation file, that holds technical documentation about the technologies and the code, game mechanics cliente server conectivity, and usage instructions, also i dont know how to document this but they ask us to see if we can document what prompt did we gave the AI to help us with the project but here claude code is pure chat so idk any suggestion?,

### 61. 2026-07-29 23:38:47 UTC

> lgo with A both
