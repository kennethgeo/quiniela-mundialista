"""Aviso push cuando un admin propone un cambio de reglas.

Pedido del dueño (26 oct 2026): «que haya una notificación a la hora de
proponer un cambio en las reglas, para que puedan darse cuenta». Una votación
se cierra a las 48 h, o antes por mayoría del padrón; si nadie se entera, la
deciden los pocos que abrieron la app.

A QUIÉN: al PADRÓN de la propuesta (`rule_proposal_electores`, migración 89),
que son quienes pueden votarla, menos quien propone (ya votó a favor al
proponer) y menos quien ya no es miembro.

UNA VEZ POR PERSONA Y PROPUESTA, sin migración nueva (decisión del dueño:
«sin cambios de base de datos»). Se usa la bitácora de avisos de la 82,
`notification_deliveries`, con el tipo `propuesta:<id>`. Esa tabla exige un
`match_id` (FK a `matches`), así que el aviso se ANCLA al primer partido del
torneo de la quiniela; el ancla solo sirve para la unicidad
(user, league, match, tipo), no dice nada del partido. No se usa
`claim_notification_deliveries` porque esa RPC solo acepta partidos abiertos.
Nada más lee estas filas: la puerta del cron, el reintento del recordatorio y
las secciones de `verificar_estado.sql` filtran por su propio tipo.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

PREFIJO_TIPO = "propuesta:"
# Costa Rica es UTC-6 todo el año (CLAUDE.md, «Partidos del día»).
_CR = timezone(timedelta(hours=-6))


def tipo_de(proposal_id: str) -> str:
    return f"{PREFIJO_TIPO}{proposal_id}"


def que_se_propone(kind: str | None, payload: dict | None) -> str:
    payload = payload if isinstance(payload, dict) else {}
    if kind == "rules":
        return "un cambio en el texto de las reglas"
    if kind == "scoring" and set(payload) == {"powerup_limits"}:
        return "un cambio en los cupos de ×2 por fase"
    if kind == "scoring":
        return "un cambio en el puntaje"
    return "un cambio en las reglas"


def _hora_cr(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        texto = str(iso).replace("Z", "+00:00")
        momento = datetime.fromisoformat(texto)
        if momento.tzinfo is None:
            momento = momento.replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    local = momento.astimezone(_CR)
    return local.strftime("%d/%m a las %H:%M")


def mensaje(propuesta: dict, nombre_quiniela: str | None, proponente: str | None) -> dict:
    """Título, cuerpo y enlace. Sin el texto de la nota: puede ser largo y el
    detalle se lee al abrir la votación."""
    quien = (proponente or "").strip() or "Un admin"
    que = que_se_propone(propuesta.get("kind"), propuesta.get("payload"))
    hasta = _hora_cr(propuesta.get("expires_at"))
    cuerpo = f"{quien} propone {que}. Entrá a verlo y votá"
    cuerpo += f" antes del {hasta}." if hasta else "."
    return {
        "title": f"🗳️ Nueva propuesta en {nombre_quiniela or 'tu quiniela'}",
        "body": cuerpo,
        "url": f"/q/{propuesta['league_id']}?tab=rules",
    }


def reclamar(supabase, propuesta: dict, ancla: int, user_ids: list[str],
             ahora: datetime | None = None) -> dict[str, str]:
    """Reclama el aviso para cada persona y devuelve {user_id: token} de las
    que GANÓ esta llamada. Las que ya lo tienen (entregado o en curso) no se
    devuelven: así dos toques, o dos admins, no lo mandan dos veces.

    Un aviso que FALLÓ se puede volver a reclamar con otra llamada. Las dos
    escrituras son condicionales fila por fila (`ON CONFLICT DO NOTHING` y
    `status = 'failed'`), así que dos llamadas a la vez no ganan la misma
    persona.
    """
    ahora = ahora or datetime.now(timezone.utc)
    tipo = tipo_de(propuesta["id"])
    ids = sorted({str(u) for u in user_ids if u})
    if not ids:
        return {}
    tokens = {uid: str(uuid4()) for uid in ids}

    nuevas = (
        supabase.table("notification_deliveries")
        .upsert([{
            "user_id": uid, "league_id": str(propuesta["league_id"]), "match_id": int(ancla),
            "tipo": tipo, "status": "claimed", "claim_token": tokens[uid],
            "claimed_at": ahora.isoformat(), "updated_at": ahora.isoformat(),
        } for uid in ids], on_conflict="user_id,league_id,match_id,tipo", ignore_duplicates=True)
        .execute().data or []
    )
    ganadas = {str(f["user_id"]): str(f["claim_token"]) for f in nuevas
               if str(f.get("user_id")) in tokens and str(f.get("claim_token")) == tokens[str(f.get("user_id"))]}

    resto = [uid for uid in ids if uid not in ganadas]
    for uid in resto:
        token = tokens[uid]
        filas = (
            supabase.table("notification_deliveries")
            .update({"status": "claimed", "claim_token": token, "claimed_at": ahora.isoformat(),
                     "delivered_at": None, "updated_at": ahora.isoformat()})
            .eq("user_id", uid).eq("league_id", str(propuesta["league_id"]))
            .eq("match_id", int(ancla)).eq("tipo", tipo).eq("status", "failed")
            .execute().data or []
        )
        if filas:
            ganadas[uid] = token
    return ganadas
