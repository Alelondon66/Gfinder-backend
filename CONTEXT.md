# GFinder / VUELVE — Contexto del Proyecto

## Concepto
Servicio de recuperación de llaveros/llaves extraviadas vía WhatsApp, integrado con **AXION** (estaciones de servicio) como puntos físicos de entrega y custodia. Marca del servicio: **VUELVE**. Nombre técnico interno del bot: **GFinder**.

## Cómo funciona (flujo actual)

### 1. Registro del dueño (opción A del menú)
- El usuario activa un llavero ingresando un **código de 8 caracteres** con formato tipo patente argentina (2 letras + 4 números + 2 letras), validado con un dígito verificador calculado por algoritmo (`validarCodigoGFinder`).
- Carga su nombre y un **teléfono alternativo de seguridad**.
- Acepta términos (link a vuelve.com/terminos) respondiendo `1` para confirmar o `2` para cancelar.
- Al confirmar, el registro queda en estado `completado` (llavero activo).

### 2. Quien encuentra un llavero (opción E del menú)
- Ingresa el código de 8 caracteres encontrado.
- El sistema valida que exista y esté activo, y **avisa inmediatamente al dueño** (y a su teléfono alternativo si corresponde).
- El finder puede compartir su **ubicación** (GPS) → el bot calcula, con fórmula de Haversine (`calcularDistancia`), la **sucursal AXION más cercana** para dejar el llavero.
- Desde ahí puede elegir:
  - **D**: ver dónde devolverlo (dirección de la sucursal)
  - **H**: enviar un mensaje anónimo/intermediado al dueño (sin revelar números de teléfono entre las partes)
  - **F**: finalizar el proceso
- Al dejarlo en la sucursal se genera un **código de retiro de 4 dígitos** que se envía al dueño (y a su contacto alternativo) para que lo recupere.

### 3. Consultas/Reclamos (opción C del menú)
- Registra el mensaje en la tabla `soporte` y cierra el proceso.

### 4. Personal AXION (opción 9, uso interno)
- Un empleado de sucursal ingresa el número de sucursal (4 dígitos) y luego el código del llavero para registrar que quedó en custodia ahí.

### 5. Comando `F` como cierre directo
- Si el dueño (ya con llavero completado) escribe `F`, cierra el chat activo con quien lo encontró y borra el registro de "encuentro" en curso.

### 6. Comando `H <mensaje>` como atajo
- Permite al dueño responder directamente con `H mensaje` sin pasar por el submenú, reenviando el mensaje al finder correspondiente.

## Dashboard comercial
Endpoint `GET /api/dashboard/metrics`, protegido por API key en header `x-api-key`. Devuelve:
- Tasa de recuperación (llaveros encontrados / activos)
- Comportamiento por canal (geolocalización AXION vs. chat directo)
- Alertas de soporte pendientes
- Ranking de sucursales (`vista_ranking_sucursales_axion`)

## Stack actual
- **Backend:** Node.js + Express
- **Base de datos:** Supabase (tablas: `llaveros`, `soporte`, `sucursales`; vistas: `vista_dashboard_gfinder`, `vista_ranking_sucursales_axion`)
- **Mensajería:** WhatsApp Business API (Meta Graph API v25.0)
- **Geolocalización:** cálculo propio de distancia (Haversine), sin API externa de mapas

## Modelo de datos inferido (tabla `llaveros`)
Campos usados en el código: `id`, `telefono_usuario`, `codigo_llavero`, `estado`, `nombre_usuario`, `telefono_alternativo`, `telefono_finder`, `fecha_registro`, `ultima_interaccion`.

Estados (`estado`) identificados en el flujo:
`esperando_codigo_registro`, `esperando_nombre_registro`, `esperando_celular_alternativo`, `esperando_confirmacion_alta`, `esperando_codigo_encuentro`, `esperando_subopcion_encuentro`, `esperando_ubicacion_finder`, `esperando_mensaje_anonimo`, `esperando_texto_soporte`, `esperando_sucursal_personal`, `esperando_codigo_personal_suc_{N}`, `completado`.

## Puntos a revisar / posibles mejoras (detectados en lectura de código, no implementados aún)
1. **Secretos hardcodeados en el código**: `WEBHOOK_VERIFY_TOKEN` y la API key del dashboard (`token_secreto_dashboard_axion_2026`) están escritos directamente en el archivo en vez de usar variables de entorno. Deberían moverse a `.env`.
2. La limpieza automática de procesos abandonados usa un umbral de 300 segundos (5 minutos) sin interacción — confirmar si ese tiempo sigue siendo el deseado.
3. Revisar si el archivo subido (`server5-7.js`) es la versión más actual en producción o si hay cambios posteriores no reflejados.

## Preferencias de trabajo de Ale
- Prefiere que se le pregunte antes de que se desarrolle o escriba código, en vez de asumir directamente.
- Valora entender bien el contexto y el código existente antes de proponer cambios.
- Trabaja en paralelo varios proyectos (Londiu SA, regalar., ATRÉVETE, GFinder/VUELVE, entre otros) — este documento es específico de GFinder/VUELVE.

## Archivo de código de referencia
`server5-7.js` (adjunto junto a este documento) — versión actual del servidor Express con toda la lógica del bot descripta arriba.
