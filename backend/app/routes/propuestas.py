"""Aviso push de una propuesta de cambio de reglas (ver services/aviso_de_propuesta)."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import get_current_user
from app.services import aviso_de_propuesta
from app.services.notification_deliveries import cerrar_reclamos
from app.services.notifications import enviar_push_personalizado, usuarios_con_dispositivo
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/propuestas", tags=["Propuestas"])


@router.post("/avisar")
async def avisar_propuesta(
    proposal_id: str = Body(..., embed=True),
    user: dict = Depends(get_current_user),
):
    """Le avisa al padrón de una propuesta ABIERTA que hay algo para votar.

    La llama la app justo después de `propose_rule_change`. Puede llamarla
    quien propuso o un admin de esa quiniela (creador o co-admin); se
    comprueba contra las tablas porque con service_role `auth.uid()` es NULL.
    Cada persona recibe el aviso UNA vez por propuesta, la llame quien la llame.
    """
    supabase = get_supabase()
    uid = user["sub"]
    ahora = datetime.now(timezone.utc)

    filas = (
        supabase.table("rule_proposals")
        .select("id, league_id, kind, payload, status, proposed_by, expires_at")
        .eq("id", proposal_id).limit(1).execute().data or []
    )
    if not filas:
        raise HTTPException(status_code=404, detail="Propuesta no encontrada")
    propuesta = filas[0]
    league_id = propuesta["league_id"]

    liga = (
        supabase.table("leagues").select("id, name, admin_id, tournament_id")
        .eq("id", league_id).limit(1).execute().data or []
    )
    if not liga:
        raise HTTPException(status_code=404, detail="Propuesta no encontrada")
    liga = liga[0]
    es_proponente = propuesta.get("proposed_by") == uid
    es_creador = liga.get("admin_id") == uid
    mia = (
        supabase.table("league_members").select("es_admin")
        .eq("league_id", league_id).eq("user_id", uid).limit(1).execute().data or []
    )
    es_coadmin = bool(mia) and bool(mia[0].get("es_admin"))
    if not (es_proponente or es_creador or es_coadmin):
        # 404 y no 403, como el aviso a la quiniela: no confirma que exista.
        raise HTTPException(status_code=404, detail="Propuesta no encontrada")

    if propuesta.get("status") != "open":
        # Se cerró al crearla (mayoría inmediata) o ya venció: no hay nada que votar.
        return {"status": "ok", "personas": 0, "enviados": 0,
                "mensaje": "La propuesta ya no está abierta: no se avisa."}

    padron = (
        supabase.table("rule_proposal_electores").select("user_id")
        .eq("proposal_id", proposal_id).limit(20000).execute().data or []
    )
    miembros = {
        str(f["user_id"]) for f in (
            supabase.table("league_members").select("user_id")
            .eq("league_id", league_id).limit(20000).execute().data or []
        )
    }
    destinatarios = sorted(({str(f["user_id"]) for f in padron} & miembros)
                           - {str(propuesta.get("proposed_by"))})
    if not destinatarios:
        return {"status": "ok", "personas": 0, "enviados": 0, "mensaje": "No hay a quién avisar."}

    sin_dispositivo = 0
    try:
        con = usuarios_con_dispositivo(supabase, destinatarios)
        sin_dispositivo = len(set(destinatarios) - con)
        destinatarios = [u for u in destinatarios if u in con]
    except Exception:
        logger.exception("Aviso de propuesta: no se pudo filtrar por dispositivo")
    if not destinatarios:
        return {"status": "ok", "personas": 0, "enviados": 0, "sin_dispositivo": sin_dispositivo,
                "mensaje": "Nadie del padrón tiene los avisos activados."}

    ancla = (
        supabase.table("matches").select("id").eq("tournament_id", liga["tournament_id"])
        .order("id").limit(1).execute().data or []
    )
    if not ancla:
        # Sin ancla no hay bitácora, y sin bitácora no se manda: repetir el
        # aviso en cada toque es lo que la bitácora existe para evitar.
        raise HTTPException(status_code=503, detail="No se pudo registrar el aviso. La propuesta quedó igual.")

    try:
        tokens = aviso_de_propuesta.reclamar(supabase, propuesta, ancla[0]["id"], destinatarios, ahora=ahora)
    except Exception:
        logger.exception("Aviso de propuesta: falló el reclamo; no se envía nada")
        raise HTTPException(status_code=503, detail="No se pudo registrar el aviso. La propuesta quedó igual.")

    if not tokens:
        return {"status": "ok", "personas": 0, "enviados": 0, "ya_avisados": len(destinatarios),
                "sin_dispositivo": sin_dispositivo,
                "mensaje": "Ya se les había avisado de esta propuesta: no se repite."}

    proponente = (
        supabase.table("users").select("display_name")
        .eq("id", propuesta.get("proposed_by")).limit(1).execute().data or []
    )
    texto = aviso_de_propuesta.mensaje(propuesta, liga.get("name"),
                                       proponente[0].get("display_name") if proponente else None)
    try:
        resultado = await enviar_push_personalizado(
            supabase, {u: dict(texto) for u in tokens}, detallado=True)
    except Exception:
        logger.exception("Aviso de propuesta: falló el envío después de reclamar")
        cerrar_reclamos(supabase, tokens, {}, ahora=ahora)
        raise HTTPException(status_code=502, detail="No se pudo mandar el aviso. La propuesta quedó igual.")
    por_usuario = resultado.pop("por_usuario", {})
    cierre = cerrar_reclamos(supabase, tokens, por_usuario, ahora=ahora)

    salida = {
        **({"reclamos_sin_cerrar": cierre["sin_cerrar"]} if cierre["sin_cerrar"] else {}),
        "status": "ok",
        "personas": len(tokens),
        "ya_avisados": len(destinatarios) - len(tokens),
        **resultado,
    }
    salida["sin_dispositivo"] = salida.get("sin_dispositivo", 0) + sin_dispositivo
    logger.info("Aviso de propuesta: %s", salida)
    return salida
