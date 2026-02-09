
import os
import requests
import json

# Extracted from supabase.ts (hardcoded fallback)
SUPABASE_URL = "https://zbwsbnqqpkvdhqwavjke.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpid3NibnFxcGt2ZGhxd2F2amtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MzgzMzEsImV4cCI6MjA3MjExNDMzMX0.kjhXkXmmNChw0XqYpXehNckMzHPUYX705aNScavKc8g"

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

def list_sessions():
    url = f"{SUPABASE_URL}/rest/v1/icp_lookalike_sessions?select=*"
    try:
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            data = response.json()
            print(f"Sessions Count: {len(data)}")
            if len(data) > 0:
                print("First Session Sample:")
                print(json.dumps(data[0], indent=2))
            else:
                print("No sessions found in 'icp_lookalike_sessions'.")
        else:
            print(f"Error fetching sessions: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    list_sessions()
