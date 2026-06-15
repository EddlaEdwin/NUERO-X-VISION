import os
from pymongo import MongoClient
from google import genai
from dotenv import load_dotenv
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

# 1. Load API Key
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
if api_key:
    api_key = api_key.strip() 

gemini_client = genai.Client(api_key=api_key)

# 2. Setup File Vault
UPLOAD_FOLDER = os.path.join(os.getcwd(), 'health_vault')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# 3. Setup Database
mongo_client = MongoClient('mongodb://localhost:27017/')
db = mongo_client['neurox_phr']
records_collection = db['medical_records']
users_collection = db['users']

# 4. Setup NLP Privacy Engine
print("Booting up Microsoft Presidio NLP Engine...")
try:
    analyzer = AnalyzerEngine()
    anonymizer = AnonymizerEngine()
    print("✅ NLP Privacy Shield Online!")
except Exception as e:
    print(f"⚠️ NLP Warning: Could not load Presidio. Ensure 'en_core_web_sm' is downloaded. Error: {e}")
    analyzer = None
    anonymizer = None