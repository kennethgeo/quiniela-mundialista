# Plan de mejoras a partir de la auditoría

Fecha: 16 de octubre de 2026. Base: `9e33076`. Rama: `codex/mejoras-auditoria-seguras`.

## Objetivo y alcance

Corregir primero los problemas comprobados que afectan la confianza y el guardado de predicciones. Introducir después las mejoras administrativas y de participación. El informe de Argon es una lista de candidatos: cada recomendación necesita contraste con el código y pruebas; sus estimaciones no son compromisos de entrega.

## Condiciones de protección de datos

- La primera entrega cambia presentación y el formulario existente; no contiene migraciones, borrados, recálculos ni llamadas a producción.
- El motor de puntaje sigue siendo `backend/app/services/scoring.py`. No se introduce un motor de puntaje en JavaScript; clasificar un marcador como exacto no calcula puntos.
- Las pruebas usan sesiones y respuestas ficticias. No se utilizan secretos ni cuentas reales.
- El lote conserva su único `upsert` y el orden de desactivar ×2 antes de activarlo. Un error conserva el formulario abierto y no se anuncia como éxito.
- No se publicará ni desplegará desde esta entrega. La rama principal conserva el punto de partida.
- Antes de una entrega que escriba datos administrativos: verificar el esquema real con consultas de solo lectura, identificar los datos afectados, obtener una exportación privada con conteos y verificar una restauración en una base aparte. El MD de respaldo actual es una exportación parcial, no una restauración completa de Auth, Storage y esquema.
- No volver a ejecutar migraciones históricas ni alterar su estado basándose solo en documentación. Una migración aplicada se corrige con una migración nueva y un ensayo previo.

## Etapa 1 — Confianza en las predicciones (completada en local)

1. **Exactos:** identificar el marcador exacto por los goles, no por superar un umbral de puntos. Mostrar los puntos guardados sin recalcularlos. Cubrir reglas personalizadas, ×2, penales y resultados incompletos.
2. **Efectividad de una quiniela:** usar como denominador las predicciones de partidos terminados; las futuras no reducen el porcentaje. Mantener el contador total de predicciones como dato independiente.
3. **Perfil global:** contar cada partido una sola vez y clasificar exactos por goles. Mantener el historial por fila sin eliminar predicciones. Probar partidos presentes en varias quinielas, con elecciones distintas, futuros y anulados.
4. **Votaciones:** mostrar puntos del asistidor y cada cambio de cupo por fase, incluidas altas, bajas y cero. Distinguir quitar un cupo específico de fijarlo en cero. No cambiar la propuesta guardada ni la forma de votar.
5. **Llenar jornada:** permitir elegir penales desde el lote, preservar elecciones anteriores válidas y exigir la elección en los empates que pueden tener tanda. No exigirla en idas ni fase regular. Mantener la transacción, los cupos y la propagación a las tarjetas. Invalidar también el indicador de pendientes al guardar.

**Aceptación:** pruebas que fallen con el comportamiento anterior, suite unitaria, compilación y pruebas de interfaz de los flujos afectados con respuestas interceptadas. Revisar diferencias y documentar cualquier limitación de ejecución. No enviar escrituras reales para verificar.

## Etapa 2 — Herramientas administrativas y sincronización

Orden: aislamiento entre torneos → guardas de sincronización → panel de llaves → herramientas auxiliares.

- Reparar `BracketAdmin` y comprobar el flujo completo de lectura/guardado, permisos y selección de torneo; corregir solo el estado no basta para prometer que funciona.
- Retirar o aislar el respaldo legado del Mundial. Nunca emparejar partidos de distintos torneos por posición de una lista. Probar que una operación del Mundial no modifica Liga Tica ni Champions.
- Eliminar el respaldo de lectura que omite `score_locked` en `live_sync`. Ante una lectura incompleta, abortar la escritura. Limitar el resolvedor y sync del Mundial al torneo correspondiente y omitir peticiones externas sin partidos relevantes.
- Separar anulación manual definitiva de aplazamiento recuperable. No activar un candado irreversible para todos los aplazamientos sin definir cómo se reanudan.
- Revisar permisos de `external-games` y `verify-scores`, sus consumidores y exposición real; validar con fixtures que usuarios sin permiso no disparen consultas externas.
- Mejorar el push final con equipos y marcador; revisar deduplicación del resumen diario reutilizando el mecanismo de entregas existente.

**Aceptación:** pruebas de backend con proveedores simulados para lectura fallida, partido bloqueado, aislamiento de torneo, reanudación y autorización; pruebas de interfaz del panel. Si hace falta cambiar datos o permisos SQL, hacer primero el ensayo y respaldo indicados arriba.

## Etapa 3 — Flujos de uso y administración de quinielas

- Corregir contraste en ambos temas y permitir salir de la pantalla de correo sin verificar mediante el cierre de sesión existente.
- Conservar la quiniela y pestaña de origen en el detalle del partido; cubrir también acceso por enlace directo y partido inexistente. El retorno `/matches` defectuoso pertenece al estado de error; no asumir que falla toda la navegación.
- Hacer recuperable una invitación fallida; no perder el código silenciosamente.
- Completar edición de nombre y contraseña reutilizando los permisos de cuenta, con errores recuperables y prueba de cambio de usuario.
- Usar el helper de escudos/banderas en el perfil.
- Mover los editores a Admin conservando permisos, votaciones y estados sin guardar. Mantener las reglas visibles al grupo.
- Definir la transferencia de titularidad antes de crear su RPC. Decidir expresamente qué ocurre con aportes de miembros expulsados; no modificar el pozo por una suposición sobre devoluciones.

**Aceptación:** pruebas móviles de registro/invitación, ambos temas, retorno, perfil y roles. Para dinero o titularidad, matriz de permisos y ensayo SQL con datos sintéticos antes de producción.

## Etapa 4 — Participación y evolución

1. Tarjeta de ganador de jornada: reutilizar el ganador y desempates de `league_jornadas`; incluir jornadas sin ganador y correcciones posteriores.
2. Simulador: diseñar contrato con la fórmula oficial y desempates; `puntosPorQuiniela` es un objeto, no una función reutilizable. Evitar sumar dos veces puntos ya contabilizados y no exponer predicciones antes del destape. Estimar después del diseño.
3. Chat por quiniela: validar interés frente a WhatsApp antes de crear tablas/políticas.
4. Rendimiento: medir consultas y conexiones antes de optimizar o eliminar rutas, vistas e índices. Permitir zoom y corregir el idioma de la página como mejoras separadas.

## Entrega, observación y reversión

- Cada bloque debe indicar archivos, comportamiento, pruebas y limitaciones. Mantener el checklist actualizado en este documento.
- Antes de integrar: revisar el diff, ejecutar controles y confirmar que no se incorporaron secretos, cambios de dependencias ni datos personales.
- Revertir cambios de código mediante un commit inverso o una versión anterior revisada; no usar `reset --hard` sobre trabajo ajeno. Una reversión de código no deshace datos escritos por usuarios.
- Un despliegue posterior exige comprobar compatibilidad con el esquema real. Revisar errores de guardado y coherencia de cifras; cualquier incremento detiene el avance a la siguiente etapa.

## Registro de ejecución

- [x] Repositorio limpio al inicio y rama de trabajo creada desde `9e33076`.
- [x] Plan escrito con separación de cambios de interfaz, operativos y de datos.
- [x] Etapa 1 implementada y verificada en local.
- [ ] Etapa 2: código y ensayo PostgreSQL sintético listos; falta ensayo del esquema completo y activación de la RPC de cruces.
- [x] Etapa 3: flujos de cuenta, invitación, navegación y administración implementados en local. Titularidad y aportes quedan como decisiones explícitas pendientes.
- [x] Etapa 4: tarjeta de ganador y accesibilidad implementadas; contratos y orden de evolución documentados.
- [ ] Simulador y chat: validar datos, necesidad y decisiones antes de implementarlos. Medición de rendimiento real pendiente.

Los puntos sin marcar y las decisiones de negocio indicadas siguen pendientes; no se presentan como funciones activas.

### Resultado de la primera entrega

- Exactos por goles en `MatchCard`; clasificación y conteos sin duplicados por partido en `ProfilePage`; efectividad sobre terminados en `SummaryTab`.
- Comparador de votaciones con asistidor y altas, bajas y cambios de cupos por fase. Una baja dice «Cupo general» y cero sigue siendo cero.
- Selector de penales en el lote; elección anterior válida conservada; idas y marcadores sin empate envían null. Confirmación explícita de marcadores nuevos 0–0 sin editar.
- No se ofrece LLENAR mientras las predicciones iniciales no terminaron de cargar o fallaron. Al guardar se invalidan también los pendientes.
- Una sola petición para el lote, desactivaciones de ×2 primero. Mientras se guarda se deshabilita la edición. Un rechazo muestra el motivo y mantiene abierto el formulario.

### Evidencia de validación

| Control | Resultado |
| --- | --- |
| Suite unitaria previa a cambios | 32 archivos, 357 pruebas aprobadas |
| Suite unitaria final (`npm test`) | 34 archivos, 374 pruebas aprobadas |
| Suite móvil completa (`npm run test:ui -- --workers=2`) | 255 pruebas aprobadas, sin reintentos, 3,1 minutos |
| Compilación (`npm run build`) | Correcta, incluido el service worker PWA |
| ESLint sobre módulos modificados y pruebas nuevas/modificadas | 0 errores; 4 advertencias existentes de hooks en MatchCard, GroupPage y ProfilePage |
| Revisión visual | Modal de penales a 390 × 844, con datos ficticios: controles y confirmación legibles, sin recorte |
| `git diff --check` | Correcto |
| Backend, SQL, Edge Functions y dependencias | Sin cambios |

En Windows, Vitest necesitó TEMP/TMP dentro de `frontend/node_modules/.cache/codex-vitest-temp` para evitar un EPERM del directorio temporal aislado. Playwright necesitó ejecutar el servidor local fuera del aislamiento que impedía conectar a localhost; mantuvo la URL ficticia `pruebas.supabase.co` y respuestas interceptadas. No se usaron credenciales ni datos reales.

Las pruebas verifican interfaz, peticiones, respuestas simuladas y regresiones de las pantallas compartidas. No certifican las políticas, migraciones aplicadas ni el estado del servicio en producción. El historial del perfil conserva sus consultas y límite de lectura actuales; la revisión de paginación/agregados para historiales grandes queda en la etapa de rendimiento. No se han creado commits, publicado cambios ni desplegado.

### Segunda entrega — Administración y sincronización

Implementado en la misma rama, conservando los cambios de la primera entrega:

- Retirado el respaldo del navegador que emparejaba eliminatorias por índice. Retirados su proxy de Vite y rewrite `/api/games`; el respaldo del servidor exige admin.
- `verify-scores` exige admin antes de consultar fuentes y devuelve errores genéricos al cliente.
- El snapshot y las escrituras del sincronizador del Mundial y su resolvedor se acotan al torneo 1. Sin partidos cercanos no se consulta al proveedor. Lectura fallida: no se intenta otra con menos columnas. Resultado incompleto o emparejamiento ambiguo: no se sobrescribe el partido.
- Las escrituras comparan el candado y el resultado leídos; una corrección del admin durante la petición al proveedor impide sobrescribir y re-puntuar esa fila.
- Anulación manual fijada por defecto; aplazamiento recuperable por la fuente, con control explícito de `score_locked`. No cambia el motor de puntaje ni la política existente de compensaciones de ×2.
- Panel de cruces por torneo, con fechas/estados protegidos, petición autenticada al backend, conservación de edición ante errores y protección al cambiar de torneo.
- Resumen diario con reclamación persistente por persona/quiniela/partido/día; solo anuncia unidades nuevas y permite recuperar las fallidas. Si no puede reclamar no envía. No promete entrega exactamente una vez si el proceso muere entre push y cierre.
- Push final con equipos, resultado y enlace al partido. Escudos de clubes corregidos en resultados del admin.

**Activación de cambios de equipos pendiente:** dos peticiones separadas (comprobar predicciones y luego cambiar equipos) no excluyen una inserción concurrente. Por eso el endpoint final requiere una RPC transaccional y no tiene UPDATE directo de respaldo. La propuesta `docs/sql/actualizar_equipos_cruce.propuesta.sql` bloquea temporalmente escrituras de predicciones y la fila del partido, ambos con NOWAIT, verifica el estado y escribe solo los cuatro campos de equipos. Si hay actividad rechaza, sin esperar ni introducir un ciclo de candados.

En la primera búsqueda Docker no estaba activo y PostgreSQL no aparecía en PATH. En la continuación se encontró PostgreSQL 17 en `C:\Program Files\PostgreSQL\17` y se pudo ensayar la propuesta en un clúster nuevo de localhost, con datos sintéticos. El resultado se detalla al final. No se le asignó un número de migración ni se aplicó en producción. La aplicación rechaza el guardado si la función no existe; no se acepta una ruta menos segura para hacerla funcionar.

Antes de activar esta RPC:

1. Ensayar en PostgreSQL aislado con datos sintéticos: cambio permitido; rechazo por estado, cierre, predicciones, torneo o versión; permisos de anon/authenticated; y conservación de goles, puntos y filas.
2. Probar dos conexiones concurrentes: una inserción en curso impide el cambio; una llamada con el candado impide que se inserte antes del chequeo; un recálculo que ya bloqueó el partido produce rechazo inmediato, sin deadlock.
3. Revisar privilegios necesarios de `service_role`, columnas de la 106 y comportamiento de triggers reales. Mantener cerrados los permisos de la RPC a clientes.
4. Registrar una migración nueva con la CLI, incluir la función en el inventario de verificación que corresponda y cumplir el respaldo/ensayo definidos al inicio del plan. No aplicar automáticamente esta propuesta sobre producción.

Validación de aplicación realizada:

| Control | Resultado |
| --- | --- |
| Backend completo | 523 pruebas aprobadas; 1 advertencia de dependencia |
| Frontend unitario completo | 374 pruebas aprobadas |
| Interfaz móvil completa | 259 pruebas aprobadas, sin reintentos, 3,1 minutos |
| Compilación y PWA | Correcta |
| ESLint de los componentes de esta etapa y prueba nueva | 0 errores; 1 advertencia existente en MatchResultsAdmin |
| Revisión visual del panel | 390 × 844, datos ficticios; controles legibles y sin recorte |
| Escrituras reales / despliegues / migraciones aplicadas | Ninguno |

Las pruebas de la RPC en el backend verifican el contrato con un doble en memoria, incluido el rechazo ante una predicción concurrente y la ausencia de UPDATE si falta la función. **No son un ensayo de SQL ni certifican sus candados.** Las demás correcciones no necesitan esa función nueva; la activación de la edición de equipos permanece separada.

### Continuación individual: etapas 3 y 4

- Edición de nombre limitada a `display_name`, con identidad y valor anterior comprobados. Un rechazo conserva el formulario. Cambiar de cuenta descarta el borrador anterior. Contraseña reutiliza la recuperación por correo y la pantalla existente de nueva contraseña.
- Correo sin verificar: contraste corregido en ambos temas, fallo de reenvío visible y cierre de sesión local mediante AuthContext. No se relaja la comprobación del correo.
- Invitación fallida visible con su código y reintento explícito tanto en el Hub como en `/unirse`. El código del enlace directo prevalece sobre una invitación vieja guardada. Una respuesta de la cuenta anterior no redirige a la nueva.
- Detalle: conserva grupo/pestaña/jornada desde tarjetas, resumen y llaves; enlaces directos regresan al grupo o al Hub. El partido inexistente deja de enviar a `/matches`. Destinos de retorno restringidos a rutas internas de quiniela.
- Marcador legible sin foto de estadio; escudos del perfil tomados de partidos, con iniciales cuando falta información. Idioma español y zoom habilitado.
- Editores y gestión de miembros trasladados a Admin; Reglas mantiene consulta y votación. Los borradores de Admin sobreviven al cambio de pestaña y se detienen su sondeo/canal de reglas cuando queda oculto. Se conservan roles del servidor y confirmaciones de pagos/salida/expulsión.
- Tarjeta del ganador oficial en Histórico, con nueva consulta antes de exportar. Se probó una corrección de ganador entre lectura y clic, una reapertura y una jornada sin ganador; no se escribe ningún resultado.
- Simulador, chat por grupo, titularidad, aportes y mediciones: diseño y criterios de avance en `docs/EVOLUCION_PARTICIPACION_2026-10-16.md`. No se implementan ni activan esos cambios de datos por suposición.

### Ensayo SQL complementario

Se localizó PostgreSQL 17 fuera de PATH y se inicializó un clúster nuevo en localhost:55483, dentro de la caché ignorada del proyecto. Las 23 pruebas de `backend/tests/test_rpc_cruces_postgres_local.py` ejecutaron la propuesta real, incluidas tres situaciones con dos conexiones. El arnés verifica la ruta de la instancia antes de crear tablas sintéticas. El servidor de ensayo quedó detenido al terminar; no se conectó a ninguna base de Supabase.

El ensayo detectó un contrato incompleto: los códigos NOT NULL podían llegar como null/vacíos. Se rechazan ahora tanto en Pydantic como dentro de SQL, sin llegar al UPDATE. Las pruebas comprueban conservación de otros torneos, resultados y puntos, versión, permisos y bloqueos NOWAIT. Detalle y límites en `docs/sql/README_ENSAYO_CRUCES.md`.

Sigue pendiente ensayar el **esquema completo vigente**, incluidos los demás triggers, privilegios y PostgREST, registrar una migración y cumplir el respaldo/restauración antes de activarla. El ensayo sintético no equivale a esa integración ni habilita cambios en producción.

### Validación de la continuación

| Control | Resultado |
| --- | --- |
| Backend completo con ensayo PostgreSQL optativo habilitado | 549 pruebas aprobadas; 1 advertencia de dependencia |
| Frontend unitario completo | 37 archivos, 396 pruebas aprobadas |
| Interfaz móvil final | 274 pruebas aprobadas, sin reintentos, 3,6 minutos |
| Compilación de producción y PWA | Correcta |
| ESLint de fuentes y pruebas modificadas | 0 errores; 11 advertencias en componentes existentes |
| Revisión visual | Correo sin verificar en ambos temas y PNG del ganador revisados; legibles y sin recorte |
| `git diff --check` | Correcto |
| Cambios de dependencias, migraciones de producción, despliegues, push a GitHub | Ninguno |

La primera corrida completa de interfaz detectó cuatro pruebas que aún buscaban los controles trasladados en Reglas (270/274). Se actualizaron para comprobar Admin y se verificaron de nuevo las 20 pruebas de pagos, salida y cruces. No se cambió la lógica de pagos para hacerlas pasar.

La corrida completa posterior aprobó las 274 pruebas. Todos los cambios siguen locales y sin commit en la rama de trabajo. No se enviaron a GitHub ni se desplegaron. El servidor PostgreSQL de ensayo y el servidor de pruebas de interfaz quedaron detenidos.

### Vista local solicitada

Frontend abierto en `http://localhost:5173` y API local en `127.0.0.1:8000`, ambos en segundo plano. Vite reenvía `/_backend` a esa API; se comprobó la respuesta raíz y salud `ok` con una lectura mínima de Supabase. El navegador quedó en el inicio de sesión y sin errores de consola al abrir.

La configuración existente apunta al Supabase actual: no es una copia de sus datos. El servidor de desarrollo intercepta únicamente el POST automático `/_backend/api/matches/refresh-live` y responde `local_preview` sin sincronizar ni puntuar; se comprobó esa respuesta. Los guardados manuales y los RPC del frontend conservan su comportamiento y pueden modificar datos reales. No se guardó nada desde la vista para comprobarla. El proxy y la interceptación son de desarrollo y no se incluyen como servidor en la compilación de producción.

### Continuación: lecturas completas y Histórico acotado

Guía de pruebas para la persona usuaria: `docs/GUIA_PRUEBAS_LOCALES_2026-10-16.md`.

Primero se consultaron únicamente los conteos de las tablas, mediante HEAD con `count=exact`, sin descargar registros ni modificar datos:

| Tabla | Filas totales en el momento de la consulta | Rango de una petición sin paginar |
| --- | --- | --- |
| matches | 429 | 0–428 |
| predictions | 1.250 | 0–999 |
| tournament_predictions | 21 | 0–20 |

Estos son conteos globales de diagnóstico, no los conteos visibles de una persona. Confirman el límite de 1.000 filas de esa API; **no demuestran que un perfil o grupo concreto estuviera truncado**. No se atribuye una mejora de latencia de producción a las respuestas artificiales de las pruebas.

Cambios implementados:

- Helper de lectura con conteo exacto, orden estable e IDs únicos. Avanza por las filas recibidas para tolerar una página real menor a la solicitada. Ante error, filas repetidas, falta de filas o cambio de conteo rechaza la lectura sin devolver el prefijo. Una lista vacía exitosa es válida.
- Perfil: paginación de partidos, predicciones propias y elecciones globales; unión por Map; estadísticas publicadas solo al completar las lecturas. Error visible y reintento. Se reinicia por cuenta y cancela páginas pendientes al salir o cambiar de persona.
- El perfil muestra inicialmente 50 tarjetas con opción de ampliar, mientras las estadísticas usan todas las filas. Actividad declara el límite de hasta 50 movimientos recientes.
- Histórico: filtra por quiniela y los IDs destapados de la jornada seleccionada. La caché incluye esos IDs y la cuenta. Cambiar de jornada cambia la consulta. Un fallo muestra reintento y no ofrece exportar una matriz parcial.
- Se mantienen RLS, destape y puntajes guardados. No se añade service_role al navegador ni otro motor de puntaje. La paginación no garantiza una instantánea transaccional de campos que cambien durante la lectura; ese requisito sigue siendo previo al simulador.

Validación del bloque:

| Control | Resultado |
| --- | --- |
| Unitarias completas | 38 archivos, 405 pruebas aprobadas |
| Nuevas pruebas móviles de volumen, fallo, filtro y exportación | 4 aprobadas |
| Suite móvil completa posterior | 278 pruebas aprobadas, sin reintentos, 3,4 minutos |
| Compilación y PWA | Correcta |
| ESLint de los módulos y pruebas de este bloque | 0 errores; 1 advertencia existente de pureza en Histórico |
| Cambios en backend, esquema, datos o dependencias | Ninguno |

El ensayo de volumen recupera 1.201 partidos/predicciones desde páginas de 200 y comprueba el exacto posterior a la fila 1.000; un fallo en una página intermedia no se presenta como un total. No se crearon datos reales para probarlo.

**Integración SQL pendiente:** se revisó la disponibilidad de las conexiones de Supabase, y ninguna incluye el proyecto de esta quiniela. No se ejecutó SQL en los otros proyectos. La propuesta sigue lista y ensayada con datos sintéticos, pero falta acceso de lectura al esquema correcto para completar su revisión antes de registrar y activar una migración. El simulador y los cambios de dinero/titularidad conservan sus condiciones previas.
