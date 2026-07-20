"""Rutas administrativas para gestionar resultados y puntuación."""

import io
import secrets
import time

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import require_admin
from app.models import MatchResultUpdate, MatchStatusUpdate
from app.services.supabase_client import get_supabase
from app.services.scoring import calculate_and_update_scores

router = APIRouter(prefix="/api/admin", tags=["Administración"])


@router.post("/update-match")
async def update_match_result(
    result: MatchResultUpdate,
    admin: dict = Depends(require_admin),
):
    """Actualiza el resultado real de un partido y calcula los puntos."""
    supabase = get_supabase()

    # Actualizar resultado y estado del partido
    response = (supabase.table("matches")
        .update({
            "home_goals_actual": result.home_goals_actual,
            "away_goals_actual": result.away_goals_actual,
            "goes_to_penalties": result.goes_to_penalties,
            "penalties_winner_real": result.penalties_winner_real,
            "status": "finished"
        })
        .eq("id", result.match_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=404, detail="Partido no encontrado")

    # Ejecutar el motor de puntuación para calcular y asignar puntos
    await calculate_and_update_scores(supabase, result.match_id)

    return {
        "message": "Resultado actualizado y puntos calculados",
        "match": response.data[0],
    }


@router.post("/set-match-status")
async def set_match_status(
    payload: MatchStatusUpdate,
    admin: dict = Depends(require_admin),
):
    """Cambia el estado de un partido (in_progress, finished)."""
    if payload.status not in ("in_progress", "finished"):
        raise HTTPException(status_code=400, detail="Estado inválido")

    supabase = get_supabase()
    response = (
        supabase.table("matches")
        .update({"status": payload.status})
        .eq("id", payload.match_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(status_code=404, detail="Partido no encontrado")

    return {
        "message": f"Estado del partido actualizado a '{payload.status}'"
    }


def _norm_email(email: str) -> str:
    return (email or "").strip().lower()


@router.post("/delete-user")
async def delete_user(
    user_id: str = Body(..., embed=True),
    ban: bool = Body(False, embed=True),
    admin: dict = Depends(require_admin),
):
    """Elimina por completo a un usuario y todos sus datos.

    Borra al usuario de Supabase Auth, lo que elimina en cascada su fila en
    public.users y todo lo dependiente (predicciones, predicciones de torneo,
    membresías de liga, suscripciones push, chat, etc.).

    Si ban=True, además agrega su correo a la lista negra (banned_emails) para
    que NO pueda volver a registrarse.

    Guardas:
    - Un admin no puede borrarse a sí mismo.
    - Solo accesible para usuarios con is_admin = true.
    """
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id requerido")
    if user_id == admin.get("sub"):
        raise HTTPException(status_code=400, detail="No puedes borrarte a ti mismo")

    supabase = get_supabase()

    # Nombre y correo (best-effort, ANTES de borrar) para mensaje y ban.
    display_name = None
    email = None
    try:
        info = supabase.table("users").select("display_name, email").eq("id", user_id).single().execute()
        display_name = (info.data or {}).get("display_name")
        email = (info.data or {}).get("email")
    except Exception:  # noqa: BLE001
        pass

    banned_email = None
    if ban and email:
        try:
            supabase.table("banned_emails").upsert({
                "email": _norm_email(email),
                "reason": "Baneado al eliminar la cuenta",
                "banned_by": admin.get("sub"),
            }).execute()
            banned_email = _norm_email(email)
        except Exception:  # noqa: BLE001 - no bloquear el borrado si falla el ban
            pass

    # Limpieza explícita de tablas que apuntan a auth.users (NO se borran al
    # eliminar solo la fila de public.users): evita predicciones globales
    # "huérfanas" que quedaban en la portada como "Jugador".
    for tbl in ("tournament_predictions", "push_subscriptions"):
        try:
            supabase.table(tbl).delete().eq("user_id", user_id).execute()
        except Exception:  # noqa: BLE001
            pass

    # Borrar de Auth → cascada a public.users y dependientes
    deleted_via = "auth"
    try:
        supabase.auth.admin.delete_user(user_id)
    except Exception:  # noqa: BLE001 - p.ej. el usuario ya no existe en Auth
        # Respaldo: borrar la fila de public.users (también cascada)
        res = supabase.table("users").delete().eq("id", user_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        deleted_via = "users_table"

    return {
        "status": "ok",
        "deleted": user_id,
        "display_name": display_name,
        "banned_email": banned_email,
        "via": deleted_via,
    }


@router.post("/ban-email")
async def ban_email(
    email: str = Body(..., embed=True),
    reason: str = Body("", embed=True),
    admin: dict = Depends(require_admin),
):
    """Agrega un correo a la lista negra (no podrá registrarse)."""
    norm = _norm_email(email)
    if not norm or "@" not in norm:
        raise HTTPException(status_code=400, detail="Correo inválido")
    supabase = get_supabase()
    supabase.table("banned_emails").upsert({
        "email": norm,
        "reason": (reason or "").strip() or None,
        "banned_by": admin.get("sub"),
    }).execute()
    return {"status": "ok", "email": norm}


@router.post("/unban-email")
async def unban_email(
    email: str = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Quita un correo de la lista negra (podrá registrarse de nuevo)."""
    norm = _norm_email(email)
    supabase = get_supabase()
    supabase.table("banned_emails").delete().eq("email", norm).execute()
    return {"status": "ok", "email": norm}


@router.post("/update-user")
async def update_user(
    payload: dict = Body(...),
    admin: dict = Depends(require_admin),
):
    """Edita el perfil de un usuario: nombre visible y/o rol de admin.

    Usa la service key (salta RLS), por eso vive en el backend. Un admin no puede
    quitarse a sí mismo el rol de admin (para no quedar sin administradores por
    error)."""
    user_id = (payload.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id requerido")

    updates: dict = {}
    if "display_name" in payload:
        name = (payload.get("display_name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
        if len(name) > 40:
            raise HTTPException(status_code=400, detail="El nombre es demasiado largo (máx. 40)")
        updates["display_name"] = name
    if "is_admin" in payload:
        is_admin = bool(payload.get("is_admin"))
        if not is_admin and user_id == admin.get("sub"):
            raise HTTPException(status_code=400, detail="No puedes quitarte a ti mismo el rol de admin")
        updates["is_admin"] = is_admin

    if not updates:
        raise HTTPException(status_code=400, detail="Nada que actualizar")

    supabase = get_supabase()
    res = supabase.table("users").update(updates).eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"status": "ok", "user": res.data[0]}


@router.post("/adjust-points")
async def adjust_points(
    user_id: str = Body(..., embed=True),
    points_adjustment: int = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Ajuste manual de puntos (bonus o penalización) para un usuario.

    Guarda el ajuste en users.points_adjustment; el total autoritativo lo
    recalcula la BD (recompute_user_total lo suma). Reemplaza el ajuste anterior
    (no es acumulativo) para que sea fácil de revisar/revertir."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id requerido")
    try:
        adj = int(points_adjustment)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="points_adjustment debe ser un entero")

    supabase = get_supabase()
    res = supabase.table("users").update({"points_adjustment": adj}).eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    # Forzar recálculo del total autoritativo (la función incluye el ajuste).
    try:
        supabase.rpc("recompute_user_total", {"p_user_id": user_id}).execute()
    except Exception:  # noqa: BLE001 - si falta la función, el trigger lo hará al próximo cambio
        pass
    return {"status": "ok", "user_id": user_id, "points_adjustment": adj}


@router.post("/set-temp-password")
async def set_temp_password(
    user_id: str = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Genera una contraseña temporal para un usuario (sin necesidad de SMTP).

    El admin se la comparte a la persona para que entre y la cambie. Usa la
    service key (auth.admin)."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id requerido")
    temp = secrets.token_urlsafe(9)
    supabase = get_supabase()
    try:
        supabase.auth.admin.update_user_by_id(user_id, {"password": temp})
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"No se pudo actualizar la contraseña: {exc}")
    return {"status": "ok", "user_id": user_id, "temp_password": temp}


@router.post("/update-match-events")
async def update_match_events(
    match_id: int = Body(..., embed=True),
    events: list = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Reemplaza los eventos (goles) de un partido en events_json.

    Sirve para cargar/corregir goleadores a mano cuando ESPN falla o falta un
    dato. Cada evento: {player, side ('home'|'away'), penalty, own_goal, minute}.
    De esto depende 'goles del goleador' de la vista. Usa la service key."""
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="events debe ser una lista")

    clean = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        player = (ev.get("player") or "").strip()
        if not player:
            continue
        clean.append({
            "type": "goal",
            "player": player,
            "side": "away" if ev.get("side") == "away" else "home",
            "penalty": bool(ev.get("penalty")),
            "own_goal": bool(ev.get("own_goal")),
            "minute": (ev.get("minute") or "").strip() or None,
        })

    supabase = get_supabase()
    res = supabase.table("matches").update({"events_json": clean}).eq("id", match_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    return {"status": "ok", "match_id": match_id, "events": clean}


@router.post("/broadcast")
async def broadcast(
    title: str = Body(..., embed=True),
    body: str = Body(..., embed=True),
    url: str = Body("/", embed=True),
    admin: dict = Depends(require_admin),
):
    """Envía una notificación push a TODOS los usuarios con suscripción activa."""
    from app.services.notifications import broadcast_push_to_users

    title = (title or "").strip()
    body = (body or "").strip()
    if not title or not body:
        raise HTTPException(status_code=400, detail="Título y mensaje son obligatorios")

    supabase = get_supabase()
    users = supabase.table("users").select("id").execute().data or []
    user_ids = [u["id"] for u in users]
    try:
        result = await broadcast_push_to_users(supabase, user_ids, title, body, url or "/")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Error enviando push: {exc}")
    return {"status": "ok", "result": result}


@router.post("/recalc-scores")
async def admin_recalc_scores(admin: dict = Depends(require_admin)):
    """Recalcula los puntos de los partidos de ELIMINATORIA finalizados con las
    reglas actuales (backend = service role, así sí actualiza las predicciones de
    todos). No toca la fase de grupos.

    Útil tras cambiar una regla de puntaje de eliminatoria (penales): los
    points_earned viejos no se recalculan solos, y el auto-sync solo re-puntúa
    cuando cambian los datos. Es idempotente (aplica solo la diferencia)."""
    supabase = get_supabase()
    finished = (
        supabase.table("matches")
        .select("id")
        .eq("status", "finished")
        .neq("phase", "groups")
        .execute()
        .data
        or []
    )
    recalculated = 0
    errors = []
    for m in finished:
        try:
            await calculate_and_update_scores(supabase, m["id"])
            recalculated += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"match {m['id']}: {exc}")

    return {
        "status": "ok",
        "finished": len(finished),
        "recalculated": recalculated,
        "errors": errors,
    }


@router.post("/optimize-avatars")
async def optimize_avatars(admin: dict = Depends(require_admin)):
    """Optimiza (redimensiona + comprime) los avatares YA subidos.

    Las fotos viejas se subían sin procesar (varios MB) y se descargaban una y
    otra vez en el ranking/podio, disparando el Cached Egress de Supabase. Esto
    recorre los avatares actuales de cada usuario, los reduce a ~256px webp con
    cache de 1 año, actualiza la URL y borra el archivo grande anterior.

    Idempotente: salta los que ya están livianos (< 60KB y .webp).
    Requiere la service key (salta RLS), por eso vive en el backend.
    """
    from PIL import Image  # import perezoso para no romper si falta Pillow

    supabase = get_supabase()
    users = supabase.table("users").select("id, avatar_url").execute().data or []

    optimized, errors = [], []
    skipped = 0
    bytes_before = bytes_after = 0

    for u in users:
        url = u.get("avatar_url") or ""
        if "/avatars/" not in url:
            continue
        old_path = url.split("/avatars/")[1].split("?")[0]

        try:
            data = supabase.storage.from_("avatars").download(old_path)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{old_path}: download {exc}")
            continue

        # Ya optimizado: saltar.
        if len(data) < 60_000 and old_path.lower().endswith(".webp"):
            skipped += 1
            continue

        try:
            img = Image.open(io.BytesIO(data)).convert("RGB")
            img.thumbnail((256, 256))
            out = io.BytesIO()
            img.save(out, format="WEBP", quality=82, method=6)
            new_bytes = out.getvalue()
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{old_path}: resize {exc}")
            continue

        new_path = f"{u['id']}-{int(time.time() * 1000)}.webp"
        try:
            supabase.storage.from_("avatars").upload(
                new_path,
                new_bytes,
                {"content-type": "image/webp", "cache-control": "31536000", "upsert": "true"},
            )
            public = supabase.storage.from_("avatars").get_public_url(new_path)
            new_url = public if isinstance(public, str) else (public or {}).get("publicUrl", public)
            supabase.table("users").update({"avatar_url": new_url}).eq("id", u["id"]).execute()
            if old_path != new_path:
                try:
                    supabase.storage.from_("avatars").remove([old_path])
                except Exception:  # noqa: BLE001
                    pass
            bytes_before += len(data)
            bytes_after += len(new_bytes)
            optimized.append({"user": u["id"], "before": len(data), "after": len(new_bytes)})
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{old_path}: upload {exc}")

    return {
        "status": "ok",
        "optimized": len(optimized),
        "skipped": skipped,
        "errors": errors,
        "kb_before": round(bytes_before / 1024),
        "kb_after": round(bytes_after / 1024),
    }
