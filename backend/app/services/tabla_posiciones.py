"""La tabla de posiciones de un torneo, calculada de NUESTROS partidos.

Se arma desde `matches` y no se le pide a ESPN para que se vea EN VIVO: un
partido `in_progress` ya tiene marcador actualizado por el sync, así que entra
en la tabla con ese marcador parcial en vez de esperar a que la fuente publique
la tabla oficial —que solo se mueve cuando el partido termina—.

La cuenta vive acá y no dentro del endpoint para poder fijarla en pruebas sin
red ni base, que es como está el resto de la lógica del backend.
"""
from typing import Optional

# Cuántos partidos entran en la racha («Últimos 5»).
FORMA_PARTIDOS = 5


def _fila(tabla: dict, nombre: str, escudo: Optional[str]) -> dict:
    if nombre not in tabla:
        tabla[nombre] = {"team": nombre, "logo": escudo, "played": 0, "wins": 0,
                         "draws": 0, "losses": 0, "gf": 0, "ga": 0, "form": []}
    elif escudo and not tabla[nombre]["logo"]:
        tabla[nombre]["logo"] = escudo
    return tabla[nombre]


def armar_tabla(matches: list) -> list:
    """De una lista de partidos a los grupos de la tabla, ya ordenados.

    `matches` tiene que venir ORDENADO POR FECHA: la racha se recorta a los
    cinco últimos al final, así que si llegan desordenados los cinco no serían
    los más recientes.
    """
    grupos = {}
    for m in matches:
        hg, ag = m.get("home_goals_actual"), m.get("away_goals_actual")
        if hg is None or ag is None:
            continue
        tabla = grupos.setdefault(m.get("group_name"), {})

        local = _fila(tabla, m["home_team"], m.get("home_flag_url"))
        visita = _fila(tabla, m["away_team"], m.get("away_flag_url"))
        local["played"] += 1
        visita["played"] += 1
        local["gf"] += hg
        local["ga"] += ag
        visita["gf"] += ag
        visita["ga"] += hg

        if hg > ag:
            local["wins"] += 1
            visita["losses"] += 1
        elif hg < ag:
            visita["wins"] += 1
            local["losses"] += 1
        else:
            local["draws"] += 1
            visita["draws"] += 1

        # LA RACHA SOLO CUENTA PARTIDOS TERMINADOS, aunque la tabla de arriba
        # sí sume el marcador parcial de los que están en curso. Un partido en
        # marcha pasa de G a E y a P según quién marque: una racha que
        # parpadea no dice nada. Los puntos en vivo, en cambio, son justo lo
        # que la gente quiere ver mientras se juega.
        if m.get("status") == "finished":
            if hg == ag:
                local["form"].append("E")
                visita["form"].append("E")
            else:
                gano, perdio = (local, visita) if hg > ag else (visita, local)
                gano["form"].append("G")
                perdio["form"].append("P")

    salida = []
    # None (liga sin grupos) al final si conviviera con grupos reales, aunque
    # en la práctica un torneo tiene uno u otro, no ambos.
    for nombre in sorted(grupos.keys(), key=lambda k: (k is None, k or "")):
        filas = list(grupos[nombre].values())
        for r in filas:
            r["points"] = r["wins"] * 3 + r["draws"]
            r["gd"] = r["gf"] - r["ga"]
            # Los más recientes, del más viejo al más nuevo: así se leen de
            # izquierda a derecha como una línea de tiempo.
            r["form"] = r["form"][-FORMA_PARTIDOS:]
        # El desempate que la pantalla explica al pie: puntos, diferencia de
        # gol, goles a favor. El nombre al final para que el orden sea estable
        # y la tabla no baile entre dos cargas iguales.
        filas.sort(key=lambda r: (-r["points"], -r["gd"], -r["gf"], r["team"]))
        for i, r in enumerate(filas, start=1):
            r["rank"] = i
        salida.append({"name": nombre, "rows": filas})
    return salida
