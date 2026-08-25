# Auditoría de seguimiento — Quiniela Mundialista (Tico Games)

**Para:** un auditor externo (Codex u otro) que verifique el trabajo hecho.
**Repositorio:** `kennethgeo/quiniela-mundialista`, rama `main`.
**Contexto:** una auditoría previa (25 ago 2026, commit `de6021d`) encontró 2 hallazgos
críticos, 6 altos y 7 medios. Se cerraron todos. Esta segunda auditoría tiene que
**verificar que se cerraron de verdad** y, sobre todo, **que no se rompió nada que
funcionaba**.

La app se va a abrir al público, así que el modelo de amenaza ya no es "17 amigos con
cuenta" sino "cualquiera con la anon key", que es pública por diseño.

---

## 1. Lo que más importa de esta revisión

En orden de prioridad:

1. **Que la app siga funcionando.** Los cambios de permisos son los que más
   fácilmente rompen algo en silencio. Ver §4: ya hubo dos casos así y podría
   haber un tercero que no vimos.
2. **Que los agujeros estén cerrados de verdad** en la base viva, no solo en el
   repo. Las migraciones se corren a mano; el repo puede no reflejar producción.
3. **Que no se haya introducido un agujero nuevo** con el código agregado.
4. **Que el puntaje no haya cambiado** para nadie dentro de su quiniela.

---

## 2. Qué cambió (mapa para revisar)

### Migraciones nuevas — hay que verificar que estén aplicadas

| Archivo | Qué hace |
|---|---|
| `database/61_endurecer_permisos.sql` | Cierra la escalada a admin y el acceso anónimo a las funciones privilegiadas |
| `database/62_ranking_global_sin_duplicados.sql` | El ranking global deja de contar el mismo partido varias veces |
| `database/63_hub_global_y_perfiles.sql` | RPCs nuevas para el hub global y el perfil por quiniela |

Anteriores del mismo día, también recientes: `58` (pozo y pagos), `59` (admins por
quiniela), `60` (jornadas y rachas).

### Hallazgos cerrados

| Id | Hallazgo original | Cómo se cerró |
|---|---|---|
| C-01 | Cualquier usuario podía ponerse `is_admin` (la política `users_update_own` solo validaba la fila, y la fila incluye ese campo) | Privilegios **por columna** sobre `users` + trigger `congelar_campos_sensibles_users` |
| C-02 | Las 44 funciones `SECURITY DEFINER` eran ejecutables por `anon`; `void_cancelled_match` y `resolve_pending_powerup_credits` trataban `auth.uid() IS NULL` como "me llama el backend" | `REVOKE` en bloque + re-grants exactos + `ALTER DEFAULT PRIVILEGES`; nuevo helper `es_backend()` que mira el claim `role` de PostgREST |
| — | `_apply_rule_proposal` no validaba quién llama ni el estado: cualquier miembro aplicaba un cambio de reglas que el grupo había rechazado | Revocada + exige `status = 'open'` |
| A-01 | Correos legibles por cualquier autenticado | `SELECT` por columna, sin `email` |
| A-02 | Los puntos de asistidor no entraban en el total global | `recompute_user_total` los suma y el trigger escucha `top_assist_points` |
| A-03 | La reconciliación de totales corría en el navegador y reportaba éxitos falsos | Endpoint admin con `service_role` que delega en `totales_desalineados()` y **reporta** los fallos |
| A-04 | `/refresh-live` público con `service_role` | Exige sesión; throttle atómico (`UPDATE` condicional); falla cerrada |
| A-05 | Carrera en el cupo de comodines ×2 | `pg_advisory_xact_lock` por (usuario, liga, fase, jornada) |
| A-06 | react-router con 5 CVE altos | 7.18.2; `npm audit` en 0 |
| M-01 | IDOR en `/leagues/{id}` y `/leaderboard/league/{id}` | Comprobación de membresía; 404 en vez de 403 |
| M-02 | `POST /api/predictions` roto desde la migración 37 | Se borró el router entero (nadie lo usaba) |
| M-03 | El ranking global premiaba estar en más quinielas | Cada partido cuenta una vez (el mejor puntaje entre tus quinielas) |
| M-05 | CI hacía `compileall` sin instalar dependencias | Instala `requirements.txt`, importa la app, corre lint y `npm audit --omit=dev` |
| M-07 | Cabeceras declaradas donde Vercel no las lee | Centralizadas en el `vercel.json` raíz; CSP en **Report-Only** |
| — | `/api/health` publicaba qué secretos había y la excepción de la base | Responde `ok`/`degraded`; el detalle va a los logs |
| — | Códigos de invitación con `random` | `secrets`, 32⁸ |
| — | Un comentario en `index.css` rompía el CSS | Corregido |
| — | eslint no estaba en `devDependencies` | Instalado; de 97 errores a 0 |

### Funcionalidad nueva (revisar que no abra nada)

- `ranking_global()`, `mi_resumen_global()`, `perfil_en_quiniela()` (migración 63)
- `frontend/src/components/hub/RankingGlobal.jsx`
- `frontend/src/components/tournament/PerfilEnQuiniela.jsx`

---

## 3. Verificaciones concretas contra la BASE VIVA

`schema.sql` ya **no** representa el estado real (las migraciones se corren a mano),
así que todo hay que comprobarlo contra la base, no leyendo el repo.

```sql
-- 1) ¿Queda alguna SECURITY DEFINER alcanzable por anon?  Debe salir VACÍO.
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- 2) ¿Alguna función usada DENTRO de una política RLS quedó sin permiso?
--    Debe salir VACÍO. Si sale algo, esa política está rota y se caen lecturas.
select distinct m[1] as funcion
from pg_policies pol,
     lateral regexp_matches(coalesce(pol.qual,'') || ' ' || coalesce(pol.with_check,''),
                            '(?:public\.)?([a-z_][a-z0-9_]*)\s*\(', 'g') as m
where pol.schemaname = 'public'
  and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname='public' and p.proname = m[1])
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname = m[1]
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- 3) Privilegios de columna sobre users. 'authenticated' NO debe tener
--    UPDATE sobre is_admin/total_points/points_adjustment/email,
--    ni SELECT sobre email.
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema='public' and table_name='users' and grantee in ('authenticated','anon')
order by grantee, privilege_type, column_name;

-- 4) ¿Alguien se elevó a admin antes del arreglo?
select id, display_name, is_admin, total_points, updated_at
from public.users where is_admin = true;

-- 5) El trigger que congela columnas sensibles debe existir.
select tgname from pg_trigger
where tgrelid = 'public.users'::regclass and not tgisinternal;

-- 6) El lock del cupo de comodines debe estar en la función.
select prosrc like '%pg_advisory_xact_lock%' as tiene_lock
from pg_proc where proname = 'check_powerup_limit';
```

### Pruebas de comportamiento (no solo de configuración)

Con una sesión **anónima** (anon key, sin login), contra la API REST:

- `POST /rest/v1/rpc/void_cancelled_match` → debe fallar por permisos
- `POST /rest/v1/rpc/_apply_rule_proposal` → debe fallar por permisos
- `POST /rest/v1/rpc/resolve_pending_powerup_credits` → debe fallar por permisos

Con una sesión **de usuario normal** (no admin):

- `PATCH /rest/v1/users?id=eq.<su-id>` con `{"is_admin": true}` → debe fallar
- `PATCH /rest/v1/users?id=eq.<su-id>` con `{"total_points": 9999}` → debe fallar
- `PATCH /rest/v1/users?id=eq.<su-id>` con `{"avatar_url": "..."}` → **debe funcionar**
- `GET /rest/v1/users?select=email` → debe fallar
- `GET /rest/v1/users?select=id,display_name` → **debe funcionar**
- `POST /rest/v1/rpc/_apply_rule_proposal` con el UUID de una propuesta de su
  quiniela → debe fallar
- `POST /rest/v1/rpc/perfil_en_quiniela` con el `league_id` de una quiniela
  **ajena** → debe fallar

---

## 4. Riesgos conocidos de regresión — revisar con lupa

Durante el trabajo aparecieron **dos formas en que los cambios rompían la app** que no
se ven leyendo el código, solo probándolo. Ya están corregidas, pero indican dónde
mirar:

1. **`trg_recompute_user_total` era `SECURITY INVOKER`** y lo dispara cada guardado de
   predicción. Al revocar permisos, el `PERFORM` de adentro fallaba con *permission
   denied* y **nadie podía predecir**. Se corrigió pasándola a `SECURITY DEFINER`.
   → *Verificar:* que un usuario normal pueda guardar una predicción.

2. **`select('*')` sobre `users`** dejó de funcionar (el `*` se expande a `email`, que
   ya no es legible). Rompía `AuthContext.fetchProfile`, o sea **el arranque de sesión
   de todo el mundo**. Se corrigió con columnas explícitas.
   → *Verificar:* que no quede ningún `select('*')` ni join embebido `users(*)` en
   todo el código, y que entrar a la app cargue el perfil.

3. **`/refresh-live` dejó de ser público** y las tres pantallas que lo llaman fallan en
   silencio (`.catch` vacío). Se centralizó en `lib/refrescoEnVivo.js`, que adjunta el
   token.
   → *Verificar:* que el marcador en vivo siga avanzando, y que no quede ninguna
   llamada a ese endpoint fuera de ese helper.

**Buscar un cuarto caso de este tipo** es la parte más valiosa de esta auditoría.
Concretamente: cualquier lugar donde el código dependa de un permiso que se revocó,
y donde el fallo sea silencioso.

---

## 5. Que el puntaje no haya cambiado

Esto es lo que la gente nota y por lo que reclama. Hay dinero de por medio.

- **Dentro de cada quiniela nada debía cambiar.** `league_points`, `league_table`,
  `group_standings`, `league_jornadas` y el pozo siguen igual.
  → *Verificar:* que la Tabla de cada quiniela dé los mismos puntos y las mismas
  posiciones que antes de las migraciones.
- **`users.total_points` sí cambia a propósito** (migración 62): ahora cada partido
  cuenta una vez. Solo afecta a quien esté en más de una quiniela del mismo torneo.
  → *Verificar:* que el cambio sea exactamente ese y no arrastre otra cosa:

```sql
select u.display_name, u.total_points as guardado,
       public.user_total_calculado(u.id) as calculado
from public.users u
where u.total_points is distinct from public.user_total_calculado(u.id);
-- Debe salir vacío después de correr la 62.
```

---

## 6. Lo que quedó fuera a propósito

No son descuidos; son decisiones. Vale la pena una segunda opinión sobre cada una:

1. **`main` no está protegida.** Es un ajuste del repositorio que hay que hacer a mano:
   PR obligatorio y `frontend-build` + `backend-compile` requeridos.
2. **Migraciones a mano.** Hay 66 archivos SQL, `schema.sql` está desactualizado y no
   hay forma de reconstruir la base desde cero. Es un cambio estructural (Supabase CLI)
   que merece su propia tanda.
3. **El CSP va en `Content-Security-Policy-Report-Only`.** Se ajustó contra el build
   real (no hay scripts ni estilos inline, ni `eval`), pero no se pudo comprobar la
   respuesta de producción. Hay que confirmar que no reporta violaciones y **recién
   ahí** renombrar la cabecera para que proteja de verdad.
4. **47 avisos de lint** de las reglas nuevas de `eslint-plugin-react-hooks` v6
   (`set-state-in-effect`, `static-components`, `immutability`, `purity`). Quedaron
   como aviso a propósito: marcan cosas mejorables, no bugs, y reescribir 37 usos de
   hooks dentro de una tanda de seguridad es cómo se cuela una regresión.
5. **`users.email_confirmed_at` no existe** en ninguna migración, así que la consulta
   de `ProtectedRoute` falla, cae al `catch` y **deja pasar igual**: hoy la verificación
   de correo no bloquea nada. Se detectó pero no se arregló. **Con la app abierta al
   público esto sí importa.**
6. **`style-src` conserva `'unsafe-inline'`** porque la app usa `style={{...}}` en todos
   lados; quitarlo exige nonces y tocar cada componente.

---

## 7. Cómo está construido (para leer el código con contexto)

- **Frontend:** React 19 + Vite + Tailwind v4 + TanStack Query. `frontend/`
- **Backend:** FastAPI con `service_role`, desplegado bajo `/_backend`. `backend/`
- **Base:** Supabase Postgres. Toda la lógica de puntaje vive en SQL y en
  `backend/app/services/scoring.py`; hay un espejo en JS (`frontend/src/lib/scoring.js`)
  que se mantiene idéntico con un corpus compartido (`shared/scoring_cases.json`)
  y tests en los dos lenguajes.
- **`CLAUDE.md`** documenta las reglas del proyecto, incluidas las de seguridad que
  no se pueden volver a romper. Leerlo antes de proponer cambios.

### Reglas que el proyecto ya aprendió (no re-romperlas)

- Nunca usar `auth.uid() IS NULL` para decir "me llama el backend": una llamada
  anónima también da NULL. Usar `es_backend()`.
- PostgreSQL otorga `EXECUTE` a `PUBLIC` al crear una función y un `GRANT` posterior
  **no** lo quita. Toda función nueva nace abierta.
- Las funciones usadas dentro de políticas RLS se evalúan como quien consulta:
  necesitan `EXECUTE` para `authenticated` aunque ningún cliente las llame.
- Un solo criterio de desempate (migración 55). No inventar otro en pantallas nuevas.
- El orden del lote al guardar una jornada importa: las desactivaciones del ×2 van
  primero (ver `lib/loteJornada.js`).

---

## 8. Formato de la respuesta

Para cada hallazgo:

- **Qué**, con archivo y línea o la consulta SQL que lo demuestra
- **Impacto real**, distinguiendo "explotable hoy" de "mala práctica"
- **Si es una regresión** de este trabajo o algo que ya estaba
- **Corrección sugerida**, y si tiene riesgo de romper algo, cuál

Y por favor, **verificá antes de reportar**. La auditoría anterior fue buena
precisamente porque cada hallazgo era comprobable; un reporte con falsos positivos
hace perder más tiempo del que ahorra.
