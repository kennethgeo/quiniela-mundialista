"""Rutas administrativas para gestionar resultados y puntuación."""

import io
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


@router.post("/delete-user")
async def delete_user(
    user_id: str = Body(..., embed=True),
    admin: dict = Depends(require_admin),
):
    """Elimina por completo a un usuario y todos sus datos.

    Borra al usuario de Supabase Auth, lo que elimina en cascada su fila en
    public.users y todo lo dependiente (predicciones, predicciones de torneo,
    membresías de liga, suscripciones push, chat, etc.).

    Guardas:
    - Un admin no puede borrarse a sí mismo.
    - Solo accesible para usuarios con is_admin = true.
    """
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id requerido")
    if user_id == admin.get("sub"):
        raise HTTPException(status_code=400, detail="No puedes borrarte a ti mismo")

    supabase = get_supabase()

    # Nombre para el mensaje de confirmación (best-effort)
    display_name = None
    try:
        info = supabase.table("users").select("display_name").eq("id", user_id).single().execute()
        display_name = (info.data or {}).get("display_name")
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
        "via": deleted_via,
    }


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
