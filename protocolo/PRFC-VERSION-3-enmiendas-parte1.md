# PRFC-CC8-2026 v3.0 — Enmiendas propuestas (Parte 1: cierre de vacíos)

**Estado:** Propuesto
**Aplica a:** `PRFC-VERSION-3` (documento `3.0.0`, byte de versión `3`)
**Objetivo:** cerrar los vacíos y ambigüedades del protocolo **antes** de que
alguien escriba código byte-exacto. En un formato binario entre 13
implementaciones, un solo punto ambiguo hace que dos grupos no interoperen y no
se note hasta el volcado hexadecimal. Todo lo de aquí es texto listo para pegar
en el documento v3.

> Esta es la **Parte 1** (correcciones al protocolo). La **Parte 2**
> (implementación: códec, servidor, puente, cliente) se trabaja aparte.

---

## A. Bloqueantes — resolver antes de codificar

### A.1 — Nuevo §23.5: errores de decodificación y recuperación

> **Motivo:** el flujo binario con prefijo de longitud **no se resincroniza
> solo** como el texto por líneas. Un prefijo de longitud corrupto (dice 5000,
> eran 40) hace que el receptor se «coma» los mensajes siguientes y el flujo
> quede desincronizado para siempre. El §29.12 manda enviar `ERROR` pero nunca
> dice qué hacer con la conexión. Hay que distinguir dos clases de error.

**Texto propuesto:**

> **23.5 Errores de decodificación y recuperación**
>
> Se distinguen dos clases de error, porque el flujo binario no se puede
> resincronizar solo:
>
> - **Error de enmarcado o decodificación** — la longitud declarada no cuadra,
>   un `str` se sale del cuerpo, o el cuerpo termina antes de lo esperado. En
>   este punto la posición dentro del flujo ya no es confiable: el siguiente byte
>   podría ser la mitad de otro mensaje. El receptor **debe** enviar `ERROR` con
>   código `INVALID_ENCODING` (§29.12) y **cerrar la conexión**. No debe intentar
>   seguir leyendo.
> - **Mensaje bien enmarcado pero de tipo desconocido** — la longitud es
>   correcta y se leyeron los N bytes, pero el byte de tipo no está en §26. Como
>   el enmarcado está intacto, el receptor **descarta esos N bytes y continúa**
>   (lector tolerante). Puede enviar `ERROR INVALID_MESSAGE` o ignorarlo, pero
>   **no** cierra la conexión.
>
> Esta distinción es la que permite agregar tipos de mensaje nuevos en el futuro
> sin romper a los clientes viejos: mientras el enmarcado se respete, lo
> desconocido se salta.

---

### A.2 — Aclaración a §23.1 y §28.1: la longitud de `str` es en bytes

> **Motivo:** §28.1 dice en el layout «1 a 20 **bytes** UTF-8» pero en la prosa
> «entre 1 y 20 **caracteres**». No es lo mismo: «Rosángela» son 9 caracteres
> pero 10 bytes (la «á» ocupa 2). Un límite medido en caracteres haría que un
> servidor acepte un nombre que otro rechaza.

**Texto propuesto:**

> El `u8` de longitud de un `str` cuenta **bytes UTF-8**, nunca caracteres. Todos
> los límites de longitud se miden en bytes. La validación del nombre en §28.1 se
> lee: **«1 a 20 bytes UTF-8 tras quitar espacios»**.

---

### A.3 — Aclaración a §23.2 y §35.1: cuerpo vs. mensaje enmarcado

> **Motivo:** §35.1 dice que un `INPUT` serializa a `11 03 00 07 01` (5 bytes),
> pero §23.2 exige un prefijo de longitud `u16` sobre TCP. Hay que aclarar qué es
> «el mensaje» y confirmar el endianness del prefijo (es el campo más crítico).

**Texto propuesto:**

> El prefijo de longitud `u16` va en **big-endian**, igual que todo entero
> multibyte (§23.1).
>
> Los «bytes de oro» de §35.1 (`11 03 00 07 01`) son el **cuerpo** del mensaje
> —encabezado `tipo + ver` incluido—. Sobre TCP ese mismo `INPUT` viaja enmarcado
> así:
>
> ```
> 00 05 | 11 03 00 07 01
> └u16┘   └── cuerpo (N = 5 bytes) ──┘
> ```
>
> La longitud `N` cuenta desde el byte de tipo hasta el final del cuerpo y **no
> se incluye a sí misma**. La prueba de §35.1 valida el cuerpo; la de §35.4 (dos
> mensajes pegados) valida el enmarcado.

---

### A.4 — Aclaración a §10 y §24: redondeo del paso de movimiento

> **Motivo:** el paso por ciclo `playerSpeed × tickIntervalMs / 1000` es exacto
> con los valores por defecto (220, 50 → 11.00), pero si se reconfiguran los
> parámetros puede no ser entero. Sin una regla de redondeo fija, dos servidores
> derivan distinto y la predicción del cliente (§31) nunca coincide.

**Texto propuesto:**

> El paso por ciclo se calcula en unidades fijas (×100) y se redondea a entero
> con **redondeo aritmético (half away from zero)** antes de sumarse a la
> posición:
>
> ```
> pasoFijo = round( playerSpeedFijo × tickIntervalMs / 1000 )
> ```
>
> donde `playerSpeedFijo` es la velocidad ×100 que viaja en `GAME_STARTED`. La
> posición siempre se almacena y se transmite como entero ×100 (§24). Con los
> valores por defecto el paso es exacto; la regla solo importa si se cambian los
> parámetros.

---

### A.5 — Aclaración a §29.5 y §29.6: fuente única del portador

> **Motivo:** quién lleva la bandera aparece dos veces —`carrierId` en el bloque
> de la bandera y `hasFlag` en cada jugador—. Dos fuentes de verdad pueden
> contradecirse.

**Texto propuesto:**

> `carrierId` es la fuente **autoritativa** del portador. Un cliente que reciba un
> `hasFlag` que no concuerde con `carrierId` debe creerle a `carrierId`. El
> servidor debe mantenerlos consistentes: `hasFlag == (playerId == carrierId)`.

---

### A.6 — Aclaración a §20: iniciar la partida no es un mensaje

> **Motivo:** §20.4 dice «el anfitrión inicia la partida», pero el conjunto
> cliente→servidor (§26) solo tiene JOIN, INPUT, INTERACT, LEAVE. Un grupo que
> haga el cliente buscará un mensaje de inicio que no existe.

**Texto propuesto:**

> No existe —ni debe existir— un mensaje de cliente para iniciar la partida. El
> anfitrión es quien ejecuta el modo servidor (§4) y dispara el inicio de forma
> **local** en su propio proceso (una tecla o un botón de su interfaz). Un cliente
> nunca inicia la partida.

---

## B. Recomendadas — se sienten en las pruebas

### B.1 — Nuevo §22.1 y parámetro en §21: detección de conexiones muertas

> **Motivo:** TCP no avisa de inmediato cuando el otro extremo desaparece sin
> cerrar (una VM en pausa, un cable desconectado). Sin una regla, ese jugador se
> queda parado en la partida para siempre.

**Texto propuesto (§22.1):**

> **22.1 Detección de conexiones muertas**
>
> El servidor debe desconectar a un cliente del que no reciba **ningún byte** en
> `idleTimeoutMs`. Para no ser desconectado en fases de poca actividad, un cliente
> sin nada que enviar puede reenviar periódicamente su `INPUT` actual (por
> ejemplo cada 2 s); como el servidor solo conserva el último `INPUT` por jugador
> (§30), reenviarlo es idempotente y no hace falta un mensaje de ping dedicado.
> Cualquier byte recibido reinicia el temporizador. Al desconectar por inactividad
> se aplica §17 (cae la bandera si la llevaba; se envía `PLAYER_DISCONNECTED`).

**Agregar a la tabla de §21:**

> | `idleTimeoutMs` | 10000 | Tiempo sin recibir bytes de un cliente antes de desconectarlo. |

*(Alternativa más «de libro» si el grupo la prefiere: agregar mensajes `PING`/
`PONG` dedicados en lugar de reusar `INPUT`. Es más limpio pero suma dos tipos.)*

---

### B.2 — Aclaración a §8: asignación de `playerId`

> **Motivo:** §8 dice `u16`, `0 = ninguno`, pero no fija cómo se asignan, y el
> desempate por `playerId` (§15) depende de que sean estables.

**Texto propuesto:**

> El servidor asigna `playerId` como `u16` consecutivo empezando en `1` (`0`
> queda reservado para «ninguno»). Un id **no se reutiliza** dentro de la misma
> partida aunque el jugador se desconecte, para que el orden por `playerId` (§15)
> sea estable. El id es único solo dentro de esa partida.

---

### B.3 — Aclaración a §24: los flotantes internos sí están permitidos

> **Motivo:** teams van a sobrepensar la regla de «no flotantes» y creer que ni
> siquiera pueden usar `sqrt` para calcular distancias.

**Texto propuesto:**

> La regla de «no punto flotante» aplica **solo a lo que viaja por el cable**, no
> al cálculo interno del servidor. El servidor puede usar flotantes internamente
> (por ejemplo `sqrt` para la distancia de las condiciones de interacción y
> victoria, §13, §14, §16); únicamente debe **transmitir** enteros ×100. Como el
> servidor es la única autoridad, su cálculo interno no afecta la
> interoperabilidad.

---

## Resumen de cambios

| # | Sección | Cambio | Prioridad |
|---|---|---|---|
| A.1 | nuevo §23.5 | Error de enmarcado → cerrar; tipo desconocido bien enmarcado → saltar y seguir | Bloqueante |
| A.2 | §23.1, §28.1 | Longitud de `str` en **bytes**, no caracteres | Bloqueante |
| A.3 | §23.2, §35.1 | Prefijo `u16` big-endian; «bytes de oro» = cuerpo, no mensaje enmarcado | Bloqueante |
| A.4 | §10, §24 | Redondeo del paso fijado (half away from zero) | Bloqueante |
| A.5 | §29.5, §29.6 | `carrierId` es la fuente autoritativa del portador | Bloqueante |
| A.6 | §20 | Iniciar la partida es acción local del anfitrión, no un mensaje | Bloqueante |
| B.1 | nuevo §22.1, §21 | `idleTimeoutMs` y detección de conexiones muertas | Recomendada |
| B.2 | §8 | Política de asignación de `playerId` | Recomendada |
| B.3 | §24 | Flotantes internos permitidos; solo el cable es entero | Recomendada |
