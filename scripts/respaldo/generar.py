"""Arma el MD de respaldo de Tico Games (ver README.md de esta carpeta).

Uso:  python3 generar.py <resultado_consulta_1> <resultado_consulta_2> <salida.md>

Los resultados son los archivos donde la herramienta de Supabase guardó cada
respuesta (JSON con `result` y el bloque <untrusted-data-…>), o un JSON plano
con la clave `datos`. Solo lee y escribe el MD: no toca la base.
"""
import hashlib
import json
import re
import sys
from collections import defaultdict


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


a, b, salida = sys.argv[1], sys.argv[2], sys.argv[3]
d = cargar(b)
d["predictions"] = cargar(a)["predictions"]

nombre={u['id']:u['display_name'] for u in d['users']}
torneo={t['id']:t['name'] for t in d['tournaments']}
partido={m['id']:m for m in d['matches']}
fecha=d['generado_at'][:16].replace('T',' ')+' UTC'
L=[]
w=L.append
w(f"# Respaldo de datos — Tico Games\n\nGenerado: **{fecha}** · lectura de producción (`wifjwtbzstbuiistcxkf`), sin modificar nada.\n")
w("> **Contiene datos personales** (nombres, predicciones, pagos). Guardalo en un lugar privado; **no lo subas al repositorio** ni lo compartas en grupos.\n")
w("## Qué incluye y qué no\n")
w("| Tabla | Filas |\n|---|---|")
orden=['users','leagues','league_members','predictions','tournament_predictions','matches','tournaments','powerup_credits','compensaciones_x2','alertas_de_puntaje','user_badges','global_chat','global_settings','tournament_settings','rule_proposals','rule_votes','rule_proposal_electores','match_audit']
for k in orden: w(f"| `{k}` | {len(d.get(k) or [])} |")
w("\n**Excluido a propósito:**\n")
ex=d['conteos_excluidos']
w(f"- **Correos** de `users` y `banned_emails` ({ex['banned_emails']} filas): son datos sensibles; viven en Supabase Auth.")
w(f"- `push_subscriptions` ({ex['push_subscriptions']}): llaves de los dispositivos. Cada persona las recrea al activar los avisos.")
w(f"- `prediction_logs` ({ex['prediction_logs']}): bitácora de cambios, no afecta puntos.")
w(f"- `players` ({ex['players']}), `match_details_cache` ({ex['match_details_cache']}), `notification_deliveries` ({ex['notification_deliveries']}), `powerup_limits` ({ex['powerup_limits']}, de solo lectura): se regeneran desde ESPN o no se usan.")
w("- De `matches`: los eventos en vivo (`events_json`), minuto y URLs de escudos, que vuelve a traer el sync.\n")

w("## Resumen legible\n")
for lg in d['leagues']:
    mem=[m for m in d['league_members'] if m['league_id']==lg['id']]
    pts=defaultdict(int)
    for p in d['predictions']:
        if p['league_id']==lg['id']: pts[p['user_id']]+=p['points_earned'] or 0
    glob={g['user_id']:g for g in d['tournament_predictions'] if g['league_id']==lg['id']}
    for u,g in glob.items(): pts[u]+=(g['champion_points'] or 0)+(g['top_scorer_points'] or 0)+(g['top_assist_points'] or 0)
    pagos=[m for m in mem if m['pago_confirmado_at']]
    total=sum(float(m['pago_confirmado_monto'] or 0) for m in pagos)
    w(f"### {lg['name']}\n")
    w(f"Torneo: {torneo.get(lg['tournament_id'],'?')} · creador: {nombre.get(lg['admin_id'],'?')} · código: `{lg['invitation_code']}` · cuota: {lg['cuota']} {lg['moneda'] or ''} · miembros: {len(mem)} · **pagos confirmados: {len(pagos)} ({total:,.0f} {lg['moneda'] or ''})**\n")
    w("| # | Persona | Puntos (predicciones + globales) | Admin | Pago confirmado | Monto | Campeón | Goleador | Asistidor |\n|---|---|---|---|---|---|---|---|---|")
    for i,m in enumerate(sorted(mem,key=lambda m:-pts[m['user_id']]),1):
        g=glob.get(m['user_id'],{})
        w(f"| {i} | {nombre.get(m['user_id'],m['user_id'])} | {pts[m['user_id']]} | {'sí' if (m['es_admin'] or m['user_id']==lg['admin_id']) else ''} | {(m['pago_confirmado_at'] or '')[:10]} | {m['pago_confirmado_monto'] or ''} | {g.get('champion_team') or ''} | {g.get('top_scorer_name') or ''} | {g.get('top_assist_name') or ''} |")
    w("")
w("> Los puntos de esta tabla son la suma cruda de `points_earned` más las globales, para verificar. El orden oficial (con desempates) lo calcula la base con `group_standings`.\n")

w("## Cómo usar este respaldo\n")
w("- Cada tabla va abajo en un bloque JSON **completo**, con los mismos nombres de columna que la base: sirve para comparar o para restaurar filas puntuales.")
w("- Para restaurar, **nunca sobre producción a ciegas**: primero cargarlo en una base aparte, comparar y copiar solo lo que falte.")
w("- Este archivo es una foto semanal: en el plan gratis de Supabase no hay respaldos descargables, así que esta es la copia. Guardá las últimas semanas.")
cs=hashlib.sha256(json.dumps({k:d.get(k) for k in orden},ensure_ascii=False,sort_keys=True).encode()).hexdigest()
w(f"- Huella SHA-256 de los datos (para comprobar que nadie lo editó): `{cs}`\n")

w("## Datos completos\n")
for k in orden:
    w(f"### `{k}` ({len(d.get(k) or [])} filas)\n")
    w("```json")
    w("[" + ",\n".join(json.dumps(r,ensure_ascii=False) for r in (d.get(k) or [])) + "]")
    w("```\n")
open(salida, 'w', encoding='utf-8').write("\n".join(L))
print(salida, sum(len(d.get(k) or []) for k in orden), 'filas')
