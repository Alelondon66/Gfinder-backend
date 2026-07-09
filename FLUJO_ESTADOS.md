# Flujo de diálogos y estados — GFinder / VUELVE

Mapeo del código actual (`server.js`, commit `7bbcafb`) para revisar qué circuitos están completos y cuáles tienen huecos.

## Diagrama de estados

```mermaid
stateDiagram-v2
    [*] --> SinProceso

    SinProceso --> esperando_codigo_registro: A
    SinProceso --> esperando_codigo_encuentro: E
    SinProceso --> esperando_texto_soporte: C
    SinProceso --> esperando_sucursal_personal: 9
    SinProceso --> SinProceso: HOLA/MENU/otro (muestra menú o fallback)

    state "Registro de llavero (A)" as Registro {
        esperando_codigo_registro --> esperando_codigo_registro: código inválido
        esperando_codigo_registro --> SinProceso: código ya activado (⚠️ ver nota D)
        esperando_codigo_registro --> esperando_nombre_registro: código válido y libre
        esperando_nombre_registro --> esperando_email_alternativo: cualquier texto (⚠️ nota E)
        esperando_email_alternativo --> esperando_email_alternativo: email inválido
        esperando_email_alternativo --> esperando_confirmacion_alta: email válido
        esperando_confirmacion_alta --> completado_dueño: "1"
        esperando_confirmacion_alta --> SinProceso: "2"
        esperando_confirmacion_alta --> esperando_confirmacion_alta: otra respuesta
    }

    state "Encuentro (E)" as Encuentro {
        esperando_codigo_encuentro --> esperando_codigo_encuentro: código inválido / no existe
        esperando_codigo_encuentro --> esperando_subopcion_encuentro: código válido\n(dispara plantilla WA al dueño)
        esperando_subopcion_encuentro --> esperando_ubicacion_finder: D
        esperando_subopcion_encuentro --> esperando_mensaje_anonimo: H
        esperando_subopcion_encuentro --> completado_finder: F
        esperando_subopcion_encuentro --> esperando_subopcion_encuentro: otra respuesta
        esperando_ubicacion_finder --> esperando_subopcion_encuentro: envía ubicación (GPS)
        esperando_ubicacion_finder --> esperando_ubicacion_finder: envía TEXTO (⚠️ nota A — sin manejo, silencio total)
        esperando_mensaje_anonimo --> completado_finder: cualquier texto (reenvía al dueño)
    }

    state "Soporte (C)" as Soporte {
        esperando_texto_soporte --> completado_soporte: cualquier texto
    }

    state "Personal AXION (9)" as Personal {
        esperando_sucursal_personal --> esperando_sucursal_personal: no son 4 dígitos
        esperando_sucursal_personal --> esperando_codigo_personal_suc_N: 4 dígitos válidos
        esperando_codigo_personal_suc_N --> esperando_codigo_personal_suc_N: código inválido / no existe
        esperando_codigo_personal_suc_N --> completado_custodia: código válido\n(dispara plantilla WA al dueño)
    }

    completado_dueño --> [*]: F (cierra con finder activo)
    completado_dueño --> [*]: H mensaje (reenvía al finder activo)
    completado_dueño --> completado_dueño: notificación pendiente → se revela al primer mensaje

    note right of esperando_codigo_registro
        Cualquier estado no-completado se puede
        abortar globalmente con CANCELAR o MENU
        (borra la fila y vuelve a SinProceso)
    end note

    note right of completado_dueño
        Timeout de 300s sin interacción SOLO
        aplica a estados no-completados (⚠️ nota G)
    end note
```

## Atajos globales (usuario con llavero `completado`)

| Disparador | Acción |
|---|---|
| `F` | Busca la fila `completado` más reciente con el mismo código y distinto teléfono (el "finder" u otra parte), la borra y avisa a ambos lados que se cerró el chat. |
| `H <mensaje>` | Igual búsqueda, pero reenvía el mensaje en vez de cerrar. |
| Cualquier texto, si hay `notificacion_pendiente` | Se revela el detalle real guardado (mensaje del finder o alerta) y se corta ahí — no sigue procesando el resto del texto como comando. |

## Circuitos incompletos / riesgos detectados

**A. `esperando_ubicacion_finder` no maneja mensajes de texto.**
Si el finder está en este estado y en vez de compartir ubicación escribe texto, ninguna rama del código lo atiende (solo se actualiza `ultima_interaccion`). El usuario queda "colgado" sin respuesta hasta que escriba `CANCELAR`/`MENU` o pase el timeout de 5 min. Debería reprompt-earlo pidiendo la ubicación de nuevo.

**B. Ambigüedad cuando hay más de una fila `completado` con el mismo `codigo_llavero`.**
El match de `F`/`H` del dueño busca "la fila `completado` más reciente con ese código y otro teléfono" — pero puede haber varias: el finder real, un empleado AXION que registró custodia (opción 9), o incluso un segundo finder que encontró el mismo código. Como se toma solo la más reciente por fecha, un evento posterior (ej. el empleado AXION cargando la custodia) puede "tapar" el vínculo con el finder real y el dueño termina hablando/cerrando con la fila equivocada.

**C. La fila de "custodia AXION" (opción 9) nunca se limpia.**
Queda como `completado` para siempre con el mismo código que el dueño, agravando el punto B indefinidamente (no hay ningún `F`/cierre que la borre).

**D. Al reingresar un código ya activado, no se reenvía el menú.**
El bot dice *"Código ya activado. Seleccioná la Opción C"* pero borra el proceso sin mostrar el menú — el usuario tiene que escribir `Hola` de nuevo para poder elegir C. Fricción evitable.

**E. Sin validación en `esperando_nombre_registro`.**
Acepta cualquier texto como nombre (vacío tras trim, solo números, emojis, etc.). Bajo impacto pero fácil de acotar con un largo mínimo.

**F. Filas `completado` "viejas" con el mismo código nunca se purgan solas.**
Si un llavero se reactiva o tiene varios ciclos de encuentro, las filas anteriores (finder, AXION) solo desaparecen si alguien hace `F` explícitamente. No hay barrido automático, a diferencia del timeout de 300s que sí limpia los procesos abandonados no completados.

**G. El timeout de 5 minutos no aplica a estados `completado`.**
Coherente para el dueño (su registro debe persistir), pero las filas de finder/AXION completadas (que en la práctica son "sesiones temporales" de un intercambio) tampoco expiran nunca — alimenta directamente los puntos B, C y F.

## Sugerencias de mejora (para priorizar, no implementadas)

1. Agregar manejo explícito de texto en `esperando_ubicacion_finder` (nota A) — bajo esfuerzo, cierra un hueco real de UX.
2. Distinguir el rol de cada fila `completado` con un campo explícito (`rol: dueño | finder | axion`) en vez de inferirlo por orden de fecha — resolvería B, C y F de raíz.
3. Reenviar el menú automáticamente cuando se cancela un registro por código duplicado (nota D).
4. Job periódico (similar al de notificaciones vencidas) que purgue filas `completado` de finder/AXION más allá de cierto tiempo sin actividad, en vez de depender de que alguien escriba `F`.
