# Avatares: inventario y recuperación sin pérdida de archivos

Base de código: c69acc7. Revisión: 2026-09-05.
Proyecto: wifjwtbzstbuiistcxkf. Este lote NO modifica producción.

## Resultado del inventario de solo lectura

`database/auditar_avatares.sql` consulta objetos, referencias exactas en
`public.users.avatar_url`, referencias alternativas en esa columna, metadatos
de Auth e identidades. No imprime correos, credenciales ni metadatos de Auth.

| Clasificación | Objetos | Bytes |
| --- | ---: | ---: |
| Foto en uso sin owner ni owner_id; URL exacta y prefijo coinciden con un usuario existente en Auth | 12 | 109780 |
| Foto en uso con propietario coincidente | 2 | 8878 |
| Sin referencia en las fuentes comprobadas; candidatos a revisión | 7 | 6277319 |

Los 21 objetos se conservaron. El candidato sin propietario SÍ tiene un prefijo
UUID válido; el nombre no sirve para decidir propiedad ni eliminación por sí solo.
Una referencia en un perfil también es editable por su usuario: no convierte a
esa persona en propietaria histórica del archivo.

## Corrección del enfoque propuesto anteriormente

No preparar un UPDATE/DELETE masivo sobre `storage.objects` para reparar estos
datos. Supabase indica que las operaciones de objetos se realizan por Storage
API; la tabla contiene metadatos y no el archivo físico. `owner` está deprecado;
el campo de propietario vigente es `owner_id`.

- https://supabase.com/docs/guides/storage/schema/design
- https://supabase.com/docs/guides/storage/security/ownership

La migración 70 ya está aplicada. No volver a ejecutarla ni alterar su historial.

## Recuperación revisable de las 12 fotos activas

La opción disponible sin reasignar objetos ajenos es que cada usuario cargue
su foto desde su sesión normal: Storage crea un objeto nuevo con el sub del JWT
como propietario. El cliente de este lote:

1. Optimiza y valida el archivo; respeta el MIME que devuelve realmente el navegador.
2. Usa un nombre nuevo UUID y `upsert: false` para no sobrescribir archivos.
3. Cambia `avatar_url` solo si la URL anterior sigue siendo la misma
   (comparación y actualización atómicas en la fila).
4. Exige que PostgREST devuelva la fila actualizada con la URL esperada.
5. Conserva ambas imágenes si la respuesta se pierde o no se confirma una fila.
6. Solo después intenta borrar la copia anterior a través de Storage API.
7. Si RLS devuelve cero objetos eliminados, informa que la limpieza queda pendiente.

No falsificar un JWT ni usar service_role para fingir la sesión de un usuario.
Una carga hecha con service_role vuelve a crear objetos sin propietario.
El endpoint existente `optimize-avatars` carga con service_role: no usarlo como
reparación de propietarios. Requiere su propia revisión antes de volver a
procesar fotos; no se invocó durante esta tarea.

## Limpieza administrativa separada

Los 7 candidatos NO constituyen una lista autorizada para borrado automático.
Antes de cualquier eliminación:

1. Repetir el inventario; revisar posibles URLs codificadas o dominios alternativos.
2. Comprobar enlaces en textos, archivos exportados, respaldos y otros consumidores
   relevantes. El SQL no demuestra ausencia de referencias fuera de sus fuentes.
3. Descargar mediante Storage API un respaldo de cada objeto aprobado y conservar
   un manifiesto con nombre, tamaño y SHA-256; verificar que el respaldo se abre.
4. Preparar una lista explícita de objetos revisados, sin comodines ni borrado
   recursivo. Revalidar referencias justo antes de ejecutar.
5. Eliminar exclusivamente por Storage API, comparar su resultado con la lista
   aprobada y comprobar que todas las URLs activas siguen respondiendo.

Esta entrega no incluye un borrado masivo ni afirma que la limpieza esté hecha.
El ahorro potencial observado es 6277319 bytes (~5,99 MiB), no un motivo para
arriesgar una foto válida.

## Prueba real pendiente

Con una cuenta de prueba normal ya autorizada: guardar una predicción abierta
con el marcador existente, verificar al recargar, y luego subir/reemplazar/quitar
una imagen de prueba sin sustituir fotos personales. Registrar cada efecto.
La sesión del navegador de Codex no estaba iniciada y el ingreso seguro sufrió
una desconexión; no se ejecutaron esas escrituras.
