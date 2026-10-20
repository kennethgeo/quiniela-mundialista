"""Arma el MD de respaldo de Tico Games (ver README.md de esta carpeta).

Uso:  python3 generar.py <resultado_consulta_1> <resultado_consulta_2> <salida.md>

Los resultados son los archivos donde la herramienta de Supabase guardó cada
respuesta (JSON con `result` y el bloque <untrusted-data-…>), o un JSON plano
con la clave `datos`. Solo lee y escribe el MD: no toca la base.

Es una FOTO DE DATOS, no un dump restaurable: ver «Qué NO es» en el README.

Si aparece en `public` una tabla que no viene en los datos ni está excluida a
propósito, NO se escribe el MD y sale con código 2: un respaldo que se calla
una tabla nueva parece completo y no lo es (así se perdía `live_sync_state`).
"""
import hashlib
import json
import re
import sys
from collections import defaultdict

# Primero las que importan para reconstruir quinielas y plata; las demás
# (incluidas las que se agreguen a la base) van después, por nombre.
PRIMERO = ['users', 'leagues', 'league_members', 'historial_pagos', 'predictions',
           'tournament_predictions', 'matches', 'tournaments', 'powerup_credits',
           'compensaciones_x2', 'rule_proposals', 'rule_votes', 'rule_proposal_electores']

POR_QUE_EXCLUIDA = {
    'banned_emails': 'correos: viven en Supabase Auth',
    'push_subscriptions': 'llaves de los dispositivos; cada persona las recrea al activar los avisos',
    'prediction_logs': 'bitácora de cambios, no afecta puntos',
    'players': 'se regenera desde ESPN',
    'match_details_cache': 'se regenera desde ESPN',
    'notification_deliveries': 'bitácora de avisos enviados',
    'powerup_limits': 'de solo lectura, ya no se usa',
}


class RespaldoIncompleto(Exception):
    pass


def cargar(ruta):
    crudo = open(ruta, encoding="utf-8").read()
    try:
        obj = json.loads(crudo)
    except json.JSONDecodeError:
        obj = {"result": crudo}
    if isinstance(obj, dict) and "result" in obj:
        m = re.search(r"<untrusted-data-[^>]+>\n(.*)\n</untrusted-data", obj["result"], re.S)
        filas = json.loads(m.group(1))
        datos = filas[0]["datos"]
    else:
        datos = obj["datos"] if isinstance(obj, dict) else obj[0]["datos"]
    return json.loads(datos) if isinstance(datos, str) else datos


def combinar(consulta_1, consulta_2):
    """Une las dos consultas y comprueba que no falte ninguna tabla."""
    d = dict(consulta_2)
    datos = dict(d.get('datos') or {})
    if 'predictions' not in consulta_1:
        raise RespaldoIncompleto("La consulta 1 no trae `predictions`.")
    datos['predictions'] = consulta_1.get('predictions') or []
    excluidas = set(d.get('excluidas') or []) - {'predictions'}
    publicas = set(d.get('tablas_publicas') or [])
    if not publicas:
        raise RespaldoIncompleto("La consulta 2 no trae `tablas_publicas`: ¿es la versión vieja de consultas.sql?")
    faltan = sorted(publicas - set(datos) - excluidas)
    if faltan:
        raise RespaldoIncompleto(f"Tablas de `public` que no vienen en el respaldo: {', '.join(faltan)}")
    d['datos'] = datos
    d['excluidas'] = sorted(excluidas)
    return d


def orden_de(datos):
    return [k for k in PRIMERO if k in datos] + sorted(k for k in datos if k not in PRIMERO)


def armar_md(d):
    datos = d['datos']
    orden = orden_de(datos)
    nombre = {u['id']: u.get('display_name') for u in datos.get('users') or []}
    torneo = {t['id']: t.get('name') for t in datos.get('tournaments') or []}
    fecha = d['generado_at'][:16].replace('T', ' ') + ' UTC'
    L = []
    w = L.append
    w(f"# Respaldo de datos — Tico Games\n\nGenerado: **{fecha}** · lectura de producción (`wifjwtbzstbuiistcxkf`), sin modificar nada.\n")
    w("> **Contiene datos personales** (nombres, predicciones, pagos). Guardalo en un lugar privado; **no lo subas al repositorio** ni lo compartas en grupos.\n")
    w("> **Es una foto de los datos, no un respaldo restaurable**: no trae el esquema, las funciones, las políticas, los triggers, Auth ni Storage. Ver el README de `scripts/respaldo`.\n")
    w("## Qué incluye y qué no\n")
    w("| Tabla | Filas |\n|---|---|")
    for k in orden:
        w(f"| `{k}` | {len(datos.get(k) or [])} |")
    w("\n**Excluido a propósito:**\n")
    ex = d.get('conteos_excluidos') or {}
    for t in d['excluidas']:
        if t not in ex:
            continue  # excluida en consultas.sql pero no existe en esta base
        w(f"- `{t}` ({ex.get(t, '?')} filas): {POR_QUE_EXCLUIDA.get(t, 'excluida en consultas.sql')}.")
    w("- **Correos** de `users`: viven en Supabase Auth.")
    w("- De `matches`: los eventos en vivo (`events_json`), minuto y URLs de escudos, que vuelve a traer el sync.\n")

    w("## Resumen legible\n")
    for lg in datos.get('leagues') or []:
        mem = [m for m in datos.get('league_members') or [] if m['league_id'] == lg['id']]
        pts = defaultdict(int)
        for p in datos['predictions']:
            if p['league_id'] == lg['id']:
                pts[p['user_id']] += p.get('points_earned') or 0
        glob = {g['user_id']: g for g in datos.get('tournament_predictions') or [] if g['league_id'] == lg['id']}
        for u, g in glob.items():
            pts[u] += (g.get('champion_points') or 0) + (g.get('top_scorer_points') or 0) + (g.get('top_assist_points') or 0)
        pagos = [m for m in mem if m.get('pago_confirmado_at')]
        total = sum(float(m.get('pago_confirmado_monto') or 0) for m in pagos)
        moneda = lg.get('moneda') or ''
        w(f"### {lg['name']}\n")
        w(f"Torneo: {torneo.get(lg['tournament_id'], '?')} · creador: {nombre.get(lg['admin_id'], '?')} · código: `{lg.get('invitation_code')}` · cuota: {lg.get('cuota')} {moneda} · miembros: {len(mem)} · **pagos confirmados: {len(pagos)} ({total:,.0f} {moneda})**\n")
        w("| # | Persona | Puntos (predicciones + globales) | Admin | Pago confirmado | Monto | Campeón | Goleador | Asistidor |\n|---|---|---|---|---|---|---|---|---|")
        for i, m in enumerate(sorted(mem, key=lambda m: -pts[m['user_id']]), 1):
            g = glob.get(m['user_id'], {})
            w(f"| {i} | {nombre.get(m['user_id'], m['user_id'])} | {pts[m['user_id']]} | {'sí' if (m.get('es_admin') or m['user_id'] == lg['admin_id']) else ''} | {(m.get('pago_confirmado_at') or '')[:10]} | {m.get('pago_confirmado_monto') or ''} | {g.get('champion_team') or ''} | {g.get('top_scorer_name') or ''} | {g.get('top_assist_name') or ''} |")
        w("")
    w("> Los puntos de esta tabla son la suma cruda de `points_earned` más las globales, para verificar. El orden oficial (con desempates) lo calcula la base con `group_standings`.\n")

    w("## Cómo usar este respaldo\n")
    w("- Cada tabla va abajo en un bloque JSON **completo**, con los mismos nombres de columna que la base: sirve para comparar o para recuperar filas puntuales.")
    w("- **Nunca sobre producción a ciegas**: primero cargarlo en una base aparte, comparar y copiar solo lo que falte.")
    w("- No reemplaza un dump (`pg_dump`) del esquema y los datos: sin el esquema, este archivo no reconstruye la base.")
    cs = hashlib.sha256(json.dumps({k: datos.get(k) for k in orden}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    w(f"- Huella SHA-256 de los datos (para comprobar que nadie lo editó): `{cs}`\n")

    w("## Datos completos\n")
    for k in orden:
        w(f"### `{k}` ({len(datos.get(k) or [])} filas)\n")
        w("```json")
        w("[" + ",\n".join(json.dumps(r, ensure_ascii=False) for r in (datos.get(k) or [])) + "]")
        w("```\n")
    return "\n".join(L), sum(len(datos.get(k) or []) for k in orden)


def main(argv):
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 1
    a, b, salida = argv[1], argv[2], argv[3]
    try:
        d = combinar(cargar(a), cargar(b))
    except RespaldoIncompleto as exc:
        print(f"RESPALDO INCOMPLETO, no se escribió nada: {exc}", file=sys.stderr)
        return 2
    md, filas = armar_md(d)
    open(salida, 'w', encoding='utf-8').write(md)
    print(salida, filas, 'filas')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
