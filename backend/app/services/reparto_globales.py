"""Reparto de campeón, goleador y asistidor de UNA quiniela (vigésima auditoría).

Antes vivía entero dentro de `calc-tournament-globals` y tenía tres fallos:

- **El goleador se daba por acertado con el APELLIDO.** Con los jugadores
  reales de la liga tica, si el goleador era Anthony, Alonso o Bancy Hernández
  cobraban las 9 personas que pusieron «Marcel Hernández» (90 puntos
  regalados), y cualquier Aguilar que no fuera Elías les pagaba el asistidor a
  las 8 de «Elías Aguilar». Ahora se compara el NOMBRE COMPLETO normalizado
  contra cada alias que escribió el admin, uno por uno y entero. Quien escribió
  solo el apellido o con un error («Harry Keane») queda en 0 salvo que el admin
  lo agregue como alias: por eso existe la vista previa.
- **El campeón se comparaba contra un texto libre** que el admin tipeaba: con
  «LD Alajuelense» nadie cobraba y el panel decía «0» sin ningún error. El
  panel ahora elige de la misma lista que ve la persona; acá además se aceptan
  alias separados por coma, comparados EXACTO: «Madrid» no puede calzar con
  Real Madrid ni con Atlético de Madrid.
- **El reparto recorría todas las quinielas del torneo.** La liga tica corre
  temporada tras temporada sobre el MISMO torneo: repartir el Clausura habría
  reescrito las globales de Bundestica con los reales del Clausura. Ahora se
  reparte en UNA quiniela, que el admin elige.

La cuenta vive acá, sin red ni base, para poder fijarla en pruebas con los
nombres reales.
"""
import re
import unicodedata
from typing import Optional

# Separadores de alias. El campeón NO parte por «/»: en la Champions juega
# «Bodo/Glimt», y partirlo daría dos alias que no son nadie.
SEPARADORES_JUGADOR = r"[,;/]"
SEPARADORES_EQUIPO = r"[,;]"

PUNTOS_POR_DEFECTO = 12


# El iPhone cambia «'» por «’» al escribir (puntuación inteligente), y en
# `players` hay «N'Golo Kanté», «Ange N'Guessan» e «Ian O'Rourke»: sin esto,
# quien lo escribió desde el celular quedaba en 0 contra el real escrito en la
# compu. Los guiones («Marc-Oliver Kempf», «Trent Alexander-Arnold») se leen
# como espacio: con o sin guion es la misma persona.
_APOSTROFOS = re.compile(r"[\u2018\u2019\u02bc\u00b4`]")
_GUIONES = re.compile(r"[-\u2010\u2011\u2012\u2013\u2014]")


def normalizar(texto: Optional[str]) -> str:
    """Sin tildes, en minúsculas, sin espacios a los costados y con los de
    adentro colapsados, apóstrofos unificados y guiones como espacio. Es lo
    único que se le perdona a una pick: «Marcel Hernandez», «Marcel Hernández»
    y «Marcel Hernández » son la misma persona."""
    s = unicodedata.normalize("NFD", texto or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = _GUIONES.sub(" ", _APOSTROFOS.sub("'", s))
    return re.sub(r"\s+", " ", s.lower().strip())


def alias(texto: Optional[str], separadores: str) -> list:
    """Los alias que escribió el admin, ya normalizados y sin vacíos."""
    vistos = []
    for parte in re.split(separadores, texto or ""):
        n = normalizar(parte)
        if n and n not in vistos:
            vistos.append(n)
    return vistos


def acierta(alias_reales: list, pick: Optional[str]) -> bool:
    """Igualdad EXACTA del nombre normalizado contra algún alias. Nada de
    subcadenas ni apellidos: esa tolerancia es la que regalaba puntos."""
    p = normalizar(pick)
    return bool(p) and p in alias_reales


def _puntos(cfg: dict, clave: str) -> int:
    v = (cfg or {}).get(clave)
    return PUNTOS_POR_DEFECTO if v is None else v


def calcular(reales: dict, preds: list, cfg: dict) -> dict:
    """Puntos de cada predicción global de una quiniela y el resumen para la
    vista previa.

    `reales`: `actual_champion`, `actual_top_scorer`, `actual_top_assist` del
    torneo, como los guarda la base. `cfg`: la fila de `leagues` con
    `champion_points`/`scorer_points`/`assist_points`.

    Devuelve `filas` (id, puntos nuevos y si cambian) y, por cada categoría,
    cuántos aciertan y la lista de picks DISTINTAS —tal cual las escribió la
    gente, para que el admin vea las variantes— con cuántas personas y si
    acierta.
    """
    a_campeon = alias(reales.get("actual_champion"), SEPARADORES_EQUIPO)
    a_goleador = alias(reales.get("actual_top_scorer"), SEPARADORES_JUGADOR)
    a_asistidor = alias(reales.get("actual_top_assist"), SEPARADORES_JUGADOR)
    pts = {
        "campeon": _puntos(cfg, "champion_points"),
        "goleador": _puntos(cfg, "scorer_points"),
        "asistidor": _puntos(cfg, "assist_points"),
    }
    categorias = (
        ("campeon", "champion_team", "champion_points", a_campeon),
        ("goleador", "top_scorer_name", "top_scorer_points", a_goleador),
        ("asistidor", "top_assist_name", "top_assist_points", a_asistidor),
    )

    filas = []
    resumen = {c: {"real": reales.get(campo_real), "aciertan": 0, "picks": {}}
               for c, campo_real in (("campeon", "actual_champion"),
                                     ("goleador", "actual_top_scorer"),
                                     ("asistidor", "actual_top_assist"))}
    for p in preds:
        nuevos = {}
        for cat, campo_pick, campo_pts, reales_cat in categorias:
            pick = p.get(campo_pick)
            ok = acierta(reales_cat, pick)
            nuevos[campo_pts] = pts[cat] if ok else 0
            r = resumen[cat]
            if ok:
                r["aciertan"] += 1
            texto = (pick or "").strip()
            if texto:
                d = r["picks"].setdefault(texto, {"pick": texto, "personas": 0, "acierta": ok})
                d["personas"] += 1
        cambia = any(nuevos[k] != (p.get(k) or 0) for k in nuevos)
        filas.append({"id": p["id"], "user_id": p.get("user_id"), "puntos": nuevos, "cambia": cambia})

    for r in resumen.values():
        r["picks"] = sorted(r["picks"].values(), key=lambda d: (-d["personas"], d["pick"]))

    return {
        "filas": filas,
        "puntos": pts,
        "predicciones": len(preds),
        "cambiarian": sum(1 for f in filas if f["cambia"]),
        **resumen,
    }
