import os
import time
import requests
from supabase import create_client, Client
from dotenv import load_dotenv

# Cargar variables de entorno (asume que existe un .env en backend/)
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") # Se necesita la key con privilegios para escribir

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ ERROR: Faltan credenciales de Supabase en el .env (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# URL de la API secreta de ESPN (100% Gratuita, sin API KEY, devuelve JSON)
# fifa.world es el código de liga para la Copa del Mundo
ESPN_API_URL = "http://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"

def fetch_live_matches():
    """Obtiene los partidos de hoy desde la API de ESPN"""
    try:
        response = requests.get(ESPN_API_URL)
        response.raise_for_status()
        data = response.json()
        return data.get("events", [])
    except Exception as e:
        print(f"❌ Error conectando a ESPN API: {e}")
        return []

def map_status(espn_state):
    """Mapea el estado de ESPN a nuestro Enum en Supabase"""
    # ESPN states: "pre" (No ha empezado), "in" (En vivo), "post" (Finalizado)
    if espn_state == "in":
        return "in_progress"
    elif espn_state == "post":
        return "finished"
    else:
        return "scheduled"

def sync_scores():
    print("⚽ Sincronizando resultados desde ESPN...")
    events = fetch_live_matches()
    
    if not events:
        print("ℹ️ No hay partidos disponibles en la API en este momento.")
        return

    for event in events:
        competition = event["competitions"][0]
        competitors = competition["competitors"]
        
        # Encontrar equipos local y visitante
        home_comp = next((c for c in competitors if c["homeAway"] == "home"), None)
        away_comp = next((c for c in competitors if c["homeAway"] == "away"), None)
        
        if not home_comp or not away_comp:
            continue
            
        home_team = home_comp["team"]["name"]
        away_team = away_comp["team"]["name"]
        kickoff_at_utc = event.get("date")
        
        espn_state = event["status"]["type"]["state"]
        status = map_status(espn_state)
        
        # Construir el payload de actualización base (estado y fecha en UTC)
        update_payload = {
            "status": status,
        }
        
        if kickoff_at_utc:
            update_payload["kickoff_at"] = kickoff_at_utc

        # Solo actualizar los goles y eventos si el partido ya está en progreso o finalizado
        if status != "scheduled":
            home_goals = int(home_comp.get("score", 0))
            away_goals = int(away_comp.get("score", 0))
            update_payload["home_goals_actual"] = home_goals
            update_payload["away_goals_actual"] = away_goals

            # Extraer eventos de gol (goalscorers)
            events_json = []
            if "details" in event["competitions"][0]:
                for detail in event["competitions"][0]["details"]:
                    if detail.get("type", {}).get("text") == "goal":
                        try:
                            athlete_name = detail["participants"][0]["athlete"]["shortName"]
                            time_clock = detail["clock"]["displayValue"]
                            team_id = detail["team"]["id"]
                            
                            home_team_id = home_comp["team"]["id"]
                            team_side = "home" if team_id == home_team_id else "away"
                            
                            events_json.append({
                                "athlete": athlete_name,
                                "time": time_clock,
                                "team": team_side
                            })
                        except Exception as e:
                            print(f"Error parseando detalle de gol: {e}")
                            
            update_payload["events_json"] = events_json

        print(f"🔄 Actualizando: {home_team} vs {away_team} ({status})")

        # Buscar el ID del partido en nuestra BD basado en los nombres de los equipos
        query = supabase.table("matches")\
            .select("id")\
            .ilike("home_team", f"%{home_team}%")\
            .ilike("away_team", f"%{away_team}%")\
            .execute()
            
        if len(query.data) > 0:
            match_id = query.data[0]["id"]
            
            # Actualizar la base de datos
            supabase.table("matches").update(update_payload).eq("id", match_id).execute()
            
            print("✅ Actualizado en Supabase")
        else:
            print(f"⚠️ No se encontró el partido en la BD local: {home_team} vs {away_team}")

if __name__ == "__main__":
    while True:
        try:
            sync_scores()
        except Exception as e:
            print(f"❌ Error fatal en el worker: {e}")
        
        print("⏳ Esperando 60 segundos para la próxima actualización...")
        time.sleep(60)
