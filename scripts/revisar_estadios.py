#!/usr/bin/env python3
"""¿Alguna foto de estadio se quedó vieja?

POR QUÉ EXISTE: el dueño notó que varias fotos eran anteriores a las
remodelaciones (el Bernabéu salía con las rampas de hormigón viejas, el Camp
Nou con el graderío anterior al Espai Barça). Comprobarlo a ojo son 48
imágenes; esto lo vuelve un comando.

QUÉ HACE: para cada foto anotada en CREDITOS.md le pregunta a Wikimedia
Commons si en la categoría del estadio hay alguna imagen LIBRE, apaisada y con
resolución decente MÁS NUEVA que la que tenemos. No decide nada: lista
candidatas para que una persona mire y elija.

QUÉ NO HACE: no descarga ni reemplaza nada. Cambiar una foto obliga a
actualizar el crédito —las licencias CC BY y CC BY-SA lo exigen— y eso se hace
a mano, a conciencia.

    python3 scripts/revisar_estadios.py            # solo las que tienen fecha
    python3 scripts/revisar_estadios.py --todas    # incluye las de fecha desconocida
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CREDITOS = RAIZ / "frontend" / "public" / "estadios" / "CREDITOS.md"

# Wikimedia exige un User-Agent que identifique a quien llama, y limita fuerte
# por IP: sin la espera creciente devuelve 429 a la segunda consulta.
UA = ("TicoGames/1.0 (https://tico-games-one.vercel.app; "
      "kgcalderon1997@gmail.com) python-urllib")
LICENCIAS_LIBRES = ("cc0", "cc by", "public domain", "pd-")


def api(params, intentos=6):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    espera = 4
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return json.load(urllib.request.urlopen(req, timeout=45))
        except Exception:
            if i == intentos - 1:
                raise
            time.sleep(espera)
            espera = min(espera * 2, 40)


def anio_de(texto):
    m = re.search(r"(20\d\d)", re.sub(r"<[^>]+>", "", texto or ""))
    return int(m.group(1)) if m else 0


def candidatas(categoria, mas_nuevas_que):
    """Imágenes libres, apaisadas y grandes, posteriores al año dado."""
    d = api({"action": "query", "format": "json", "formatversion": "2",
             "generator": "categorymembers", "gcmtitle": categoria,
             "gcmtype": "file", "gcmlimit": "200",
             "prop": "imageinfo", "iiprop": "url|extmetadata|size"})
    salida = []
    for p in d.get("query", {}).get("pages", []):
        ii = (p.get("imageinfo") or [{}])[0]
        em = ii.get("extmetadata") or {}
        licencia = ((em.get("LicenseShortName") or {}).get("value") or "").lower()
        anio = anio_de((em.get("DateTimeOriginal") or {}).get("value"))
        ancho, alto = ii.get("width", 0), ii.get("height", 0)
        if anio <= mas_nuevas_que or not alto:
            continue
        if ancho < 1200 or ancho / alto < 1.25:      # apaisada y con resolución
            continue
        if not any(l in licencia for l in LICENCIAS_LIBRES):
            continue
        salida.append({
            "anio": anio, "titulo": p["title"][5:], "licencia": licencia,
            "px": f"{ancho}x{alto}",
            "autor": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "",
                            (em.get("Artist") or {}).get("value") or "")).strip()[:40],
            "pagina": ii.get("descriptionurl"),
        })
    return sorted(salida, key=lambda x: -x["anio"])


def buscar_categoria(nombre):
    """Categoría de Commons para un estadio, buscándola por nombre.

    Así el archivo de créditos no tiene que traer la categoría de las 48: se
    anota cuando se conoce y, si no, se busca. Wikimedia limita mucho por IP,
    así que anotarla igual ahorra una consulta por foto.
    """
    d = api({"action": "query", "format": "json", "formatversion": "2",
             "list": "search", "srsearch": nombre, "srnamespace": "14",
             "srlimit": "1"})
    res = d.get("query", {}).get("search", [])
    return res[0]["title"] if res else None


def anotadas():
    """Lee las filas de CREDITOS.md que traen categoría y año."""
    filas = []
    for linea in CREDITOS.read_text(encoding="utf-8").splitlines():
        if not linea.startswith("| `"):
            continue
        # Las celdas vienen con comillas invertidas (`archivo.jpg`,
        # `Category:...`): sin quitarlas, ninguna fila casa y el script dice
        # alegremente que no hay nada que revisar.
        celdas = [c.strip().strip("`") for c in linea.strip("|").split("|")]
        if len(celdas) < 2:
            continue
        archivo = celdas[0]
        cat = next((c for c in celdas if c.startswith("Category:")), None)
        anio = next((int(c) for c in celdas if re.fullmatch(r"20\d\d", c)), 0)
        filas.append({"archivo": archivo, "categoria": cat, "anio": anio,
                      "estadio": celdas[1]})
    return filas


def main():
    filas = anotadas()
    # Sin año no hay con qué comparar: esas quedan fuera hasta que se anote.
    # La CATEGORÍA sí se puede buscar sola, así que no excluye a nadie.
    revisables = [f for f in filas if f["anio"]]
    sin_anio = [f for f in filas if not f["anio"]]

    print(f"{len(filas)} fotos anotadas · {len(revisables)} con año para comparar")
    if sin_anio:
        print(f"{len(sin_anio)} sin año: anotalo en CREDITOS.md y vuelven a entrar")
        for f in sin_anio[:5]:
            print(f"   · {f['archivo']}")
        if len(sin_anio) > 5:
            print(f"   … y {len(sin_anio) - 5} más")

    hallazgos = 0
    for f in revisables:
        if not f["categoria"]:
            try:
                f["categoria"] = buscar_categoria(f["estadio"])
            except Exception:  # noqa: BLE001
                f["categoria"] = None
            if not f["categoria"]:
                print(f"  ? {f['archivo']}: no se encontró categoría para "
                      f"«{f['estadio']}»; anotala a mano")
                continue
        try:
            c = candidatas(f["categoria"], f["anio"])
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {f['archivo']}: no se pudo consultar ({exc})")
            continue
        if not c:
            continue
        hallazgos += 1
        print(f"\n{f['archivo']}  ({f['estadio']}, la nuestra es de {f['anio']})")
        for x in c[:3]:
            print(f"   {x['anio']}  {x['px']:11} {x['licencia'][:12]:12} "
                  f"{x['autor'][:20]:20} {x['titulo'][:50]}")
            print(f"        {x['pagina']}")

    print(f"\n{hallazgos} estadio(s) con alguna foto más nueva disponible.")
    print("Elegir a mano: una foto más reciente no siempre es mejor "
          "(obras, ángulos raros, poca luz).")


if __name__ == "__main__":
    main()
