# Aplicar migraciones en Supabase — Quiniela Mundialista

**Repo:** `kennethgeo/quiniela-mundialista`, rama `main`, commit `f01948e`.
**Para:** Codex u otro agente con acceso a la base.

Los archivos están en el repo, en `database/`. **No los modifiques.** Todos son
idempotentes: si dudás de si algo ya se corrió, se puede volver a correr.

---

## Estado de partida (verificado en la auditoría del 25 ago)

| Migración | ¿Aplicada? | Nota |
|---|---|---|
| `61_endurecer_permisos.sql` | Sí, pero una **versión vieja** | Hay que volver a correrla: la nueva incluye tres RPC que faltaban |
| `62_ranking_global_sin_duplicados.sql` | Sí | No hace falta repetirla |
| `63_hub_global_y_perfiles.sql` | **No** | |
| `64_cerrar_tablas_y_vistas_abiertas.sql` | **No** | Archivo nuevo |

---

## Secuencia

### Paso 0 — Antes de tocar nada

```sql
select id, display_name, is_admin, total_points, updated_at
from public.users where is_admin = true;
```
**Reportá el resultado.** Si aparece alguien que no debería ser administrador,
**pará** y avisá antes de seguir.

### Paso 1 — `database/61_endurecer_permisos.sql`

Correrla **completa**. Ya estaba aplicada, pero esta versión agrega
`ranking_global`, `mi_resumen_global` y `perfil_en_quiniela` al inventario de
permisos. Sin eso, el paso 2 se rompe la próxima vez que alguien re-corra la 61.

**Debe terminar imprimiendo:**
```
NOTICE:  Permisos correctos: ninguna política quedó huérfana y anon no ejecuta ninguna SECURITY DEFINER.
```
Puede imprimir además un `WARNING` sobre "funciones del inventario que no existen
en esta base" — eso es **normal** si alguna función del inventario todavía no fue
creada; reportá la lista pero no es motivo para parar.

Cualquier **otro** `WARNING` → **pará y reportalo**.

### Paso 2 — `database/63_hub_global_y_perfiles.sql`

Crea tres RPC nuevas: `ranking_global`, `mi_resumen_global`, `perfil_en_quiniela`.
No debe imprimir warnings.

Verificación:
```sql
select p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ranking_global','mi_resumen_global','perfil_en_quiniela');
```
Las tres: `authenticated = true`, `anon = false`.

### Paso 3 — `database/64_cerrar_tablas_y_vistas_abiertas.sql`

Cierra `powerup_limits` (era escribible por cualquiera con la anon key) y tres
vistas que permitían enumerar el padrón sin iniciar sesión.

**Debe terminar imprimiendo:**
```
NOTICE:  Correcto: anon ya no alcanza powerup_limits ni las tres vistas.
```
Si imprime `WARNING: REVISAR: anon todavía alcanza ...` → **pará y reportalo**.

---

## Verificación final (correr las cuatro y reportar)

```sql
-- 1) Ninguna SECURITY DEFINER alcanzable por anon.  Debe salir VACÍO.
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- 2) Ninguna función usada dentro de una política RLS sin permiso.  VACÍO.
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

-- 3) Tablas y vistas que estaban abiertas.  anon debe dar false en todo.
select 'powerup_limits' as objeto,
       has_table_privilege('anon','public.powerup_limits','SELECT')          as anon_lee,
       has_table_privilege('anon','public.powerup_limits','UPDATE')          as anon_escribe,
       has_table_privilege('authenticated','public.powerup_limits','SELECT') as auth_lee,
       has_table_privilege('authenticated','public.powerup_limits','UPDATE') as auth_escribe
union all
select 'user_badges_view',
       has_table_privilege('anon','public.user_badges_view','SELECT'), null,
       has_table_privilege('authenticated','public.user_badges_view','SELECT'), null
union all
select 'user_stats_view',
       has_table_privilege('anon','public.user_stats_view','SELECT'), null,
       has_table_privilege('authenticated','public.user_stats_view','SELECT'), null;

-- 4) Totales globales cuadrados.  Debe salir VACÍO.
select u.display_name, u.total_points as guardado,
       public.user_total_calculado(u.id) as calculado
from public.users u
where u.total_points is distinct from public.user_total_calculado(u.id);
```

**Resultados esperados:**

| Consulta | Esperado |
|---|---|
| 1 | vacío |
| 2 | vacío |
| 3 | `anon` en `false` en todo · `powerup_limits`: auth lee `true`, escribe `false` · `user_badges_view`: auth `false` · `user_stats_view`: auth `true` |
| 4 | vacío |

---

## Después: comprobar que la app sigue funcionando

Esto importa más que lo anterior. Con un usuario normal, en la app:

1. **Entrar** — el perfil tiene que cargar (si falla, se rompe el arranque de sesión).
2. **Guardar una predicción** — tiene que guardar sin error.
3. **Abrir una quiniela → pestaña Tabla** — los puntos y posiciones tienen que ser
   los mismos de antes; **nada del puntaje por quiniela debía cambiar**.
4. **Tocar una fila de la Tabla** — abre el perfil de esa persona en esa quiniela.
   Si sale "No se pudo cargar este perfil", el paso 2 falló.
5. **Ir a "Mis quinielas"** — arriba tiene que aparecer la tarjeta "Tu global".
   Si no aparece nada, puede ser que todavía no haya partidos jugados (normal) o
   que la RPC falle (ahí sale un cartel naranja con el error).
6. **Ver un partido en curso** — el marcador tiene que avanzar solo.

---

## Si algo falla

- **No revertir por tu cuenta.** Reportá el error exacto y en qué paso ocurrió.
- El error más probable es `permission denied for function <nombre>`: significa
  que a esa función le falta el `GRANT`. Reportá el nombre — la corrección es
  agregarla al inventario `v_frontend` de la migración 61, no otorgarle permisos
  sueltos por fuera.

## Qué NO hacer

- No modificar los archivos SQL.
- No otorgar permisos a `anon` "para que funcione".
- No cambiar nada más en la base.
