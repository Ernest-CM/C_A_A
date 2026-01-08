import os

import requests


api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise SystemExit("Missing GEMINI_API_KEY in environment (.env)")

url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"

try:
    response = requests.get(url)
    response.raise_for_status()
    data = response.json()
    models = data.get('models', [])
    print(f"Found {len(models)} models.")
    for m in models:
        print(f"- {m['name']} (supported methods: {m.get('supportedGenerationMethods')})")
        if "generateContent" in m.get('supportedGenerationMethods', []):
            print(f"  -> Good candidate")

except Exception as e:
    print(f"Error: {e}")
    if "response" in locals():
        print(response.text)
