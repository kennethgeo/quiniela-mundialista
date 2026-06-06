import os
import time
import requests
from supabase import create_client, Client
from dotenv import load_dotenv

# Cargar variables de entorno (asume que existe un .env en backend/)
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") # Se necesita la key con privilegios para escribir
API_FOOTBALL_KEY = os.getenv("API_FOOTBALL_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ ERROR: Faltan credenciales de Supabase en el .env")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Configuración de API-FOOTBALL (https://www.api-football.com/)
API_HOST = "v3.football.api-sports.io"
HEADERS = {
    "x-rapidapi-host": API_HOST,
    "x-rapidapi-key": API_FOOTBALL_KEY
}
LEAGUE_ID = "1"  # ID de la Copa del Mundo en API-FOOTBALL
SEASON = "2026"

def fetch_live_matches():
    """Obtiene los partidos en vivo o terminados hoy desde la API"""
    if not API_FOOTBALL_KEY:
        print("⚠️ AVISO: No hay API_FOOTBALL_KEY configurada. Usando datos mock para demostración.")
        return mock_api_data()

    url = f"https://{API_HOST}/fixtures?league={LEAGUE_ID}&season={SEASON}&live=all"
    try:
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()
        return data.get("response", [])
    except Exception as e:
        print(f"❌ Error conectando a API-FOOTBALL: {e}")
        return []

def mock_api_data():
    """Datos simulados para probar la UI sin gastar cuota de API"""
    return [
        {
            "fixture": {"id": 999, "status": {"short": "1H", "long": "First Half"}},
            "teams": {"home": {"name": "Mexico"}, "away": {"name": "South Africa"}},
            "goals": {"home": 1, "away": 0}
        }
    ]

def map_status(api_status_short):
    """Mapea el status de la API a nuestro Enum en la base de datos"""
    in_progress_codes = ["1H", "HT", "2H", "ET", "P", "BT", "LIVE"]
    finished_codes = ["FT", "AET", "PEN"]
    
    if api_status_short in in_progress_codes:
        return "in_progress"
    elif api_status_short in finished_codes:
        return "finished"
    else:
        return "scheduled"

def sync_scores():
    print("⚽ Sincronizando resultados en vivo...")
    live_matches = fetch_live_matches()
    
    if not live_matches:
        print("ℹ️ No hay partidos en vivo en este momento.")
        return

    for api_match in live_matches:
        home_team = api_match["teams"]["home"]["name"]
        away_team = api_match["teams"]["away"]["name"]
        home_goals = api_match["goals"]["home"]
        away_goals = api_match["goals"]["away"]
        status = map_status(api_match["fixture"]["status"]["short"])
        
        print(f"🔄 Actualizando: {home_team} {home_goals} - {away_goals} {away_team} ({status})")

        # Buscar el ID del partido en nuestra BD basado en los nombres de los equipos
        # (Idealmente, tendríamos una columna 'api_fixture_id' para un mapeo exacto)
        query = supabase.table("matches")\
            .select("id")\
            .eq("home_team", home_team)\
            .eq("away_team", away_team)\
            .execute()
            
        if len(query.data) > 0:
            match_id = query.data[0]["id"]
            
            # Actualizar la base de datos
            supabase.table("matches").update({
                "status": status,
                "home_goals_actual": home_goals,
                "away_goals_actual": away_goals
            }).eq("id", match_id).execute()
            
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
