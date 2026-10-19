"""Reutiliza el reclamo persistente de avisos, sin enviar nada sin bitácora.

La unidad es persona/quiniela/partido/día. Un reintento no repite unidades ya
entregadas; si aparecen partidos nuevos, el texto dice que son nuevos. Sigue
siendo entrega al-menos-una-vez si el proceso muere después del push y antes
del cierre, igual que el recordatorio de 45 minutos.
"""
from app.services.notification_deliveries import reclamar_entregas, cerrar_reclamos
from app.services.resumen_diario import armar_mensajes, entregas_recordatorio


async def enviar_resumen_deduplicado(supabase, partidos, membresias, predicciones, ahora, enviar):
    from app.services.resumen_diario import ventana_del_dia

    desde, _ = ventana_del_dia(ahora)
    entregas = entregas_recordatorio(partidos, membresias, predicciones)
    reclamadas, tokens = reclamar_entregas(supabase, entregas, f"resumen-diario:{desde.date()}")
    try:
        completos = armar_mensajes(partidos, membresias, predicciones)
        mensajes = {}
        for uid in tokens:
            suyas = [e for e in reclamadas if str(e["user_id"]) == uid]
            nuevos = {e["match_id"]: e["partido"] for e in suyas}
            ligas = {(e["league_id"], e["partido"]["tournament_id"]) for e in suyas}
            miembros = [{"user_id": uid, "league_id": lid, "tournament_id": tid} for lid, tid in ligas]
            mensaje = armar_mensajes(list(nuevos.values()), miembros, predicciones).get(uid)
            if not mensaje:
                raise RuntimeError("Reclamo sin mensaje de resumen")
            # El cuerpo describe solo los partidos reclamados; los pendientes
            # se cuentan sobre todo el día, incluso si parte ya se anunció.
            cabeza = "⚽ 1 partido nuevo hoy" if len(nuevos) == 1 else f"⚽ {len(nuevos)} partidos nuevos hoy"
            original = completos.get(uid, mensaje)["title"].split(" · ", 1)
            mensaje["title"] = cabeza + (f" · {original[1]}" if len(original) > 1 else "")
            mensajes[uid] = mensaje
        resultado = await enviar(supabase, mensajes, detallado=True) if mensajes else {"enviados": 0}
    except Exception:
        cerrar_reclamos(supabase, tokens, {}, ahora=ahora)
        raise
    detalle = resultado.pop("por_usuario", {})
    cierre = cerrar_reclamos(supabase, tokens, detalle, ahora=ahora)
    return {**resultado, "personas": len(mensajes), "reclamos_sin_cerrar": cierre["sin_cerrar"]}
