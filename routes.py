from flask import Blueprint, request, jsonify, send_from_directory, send_file
from werkzeug.utils import secure_filename
import os
import io
import base64
import uuid
import datetime
import shutil
import pydicom
import fitz  # PyMuPDF
import numpy as np
import zipfile
import random
from PIL import Image

# Import from custom modules
from config import records_collection, users_collection, UPLOAD_FOLDER, gemini_client
from utils import get_slice_order_from_meta, anonymize_text, send_verification_email

api_blueprint = Blueprint('api', __name__)
active_otps = {}

# ==========================================
# ENDPOINT: OTP VERIFICATION & AUTH
# ==========================================
@api_blueprint.route('/api/send-otp', methods=['POST'])
def send_otp():
    data = request.get_json()
    email = data.get('email')
    action = data.get('action', 'login') # 'login' or 'register'
    
    if not email:
        return jsonify({"error": "Email is required"}), 400

    user_exists = users_collection.find_one({"email": email})

    if action == 'login' and not user_exists:
        return jsonify({"error": "Account not found. Please switch to 'Create Account'."}), 404
    if action == 'register' and user_exists:
        return jsonify({"error": "Account already exists. Please switch to 'Sign In'."}), 400

    otp_code = str(random.randint(100000, 999999))
    active_otps[email] = otp_code
    success = send_verification_email(email, otp_code)
    
    if success:
        return jsonify({"message": "OTP sent to your inbox!"})
    else:
        return jsonify({"error": "Failed to send email. Check server logs."}), 500

@api_blueprint.route('/api/verify-otp', methods=['POST'])
def verify_otp():
    data = request.get_json()
    email = data.get('email')
    user_otp = data.get('otp')
    action = data.get('action')

    if active_otps.get(email) == user_otp:
        del active_otps[email] 

        if action == 'register':
            user_data = {
                "email": email,
                "name": data.get('name'),
                "age": data.get('age'),
                "sex": data.get('sex'),
                "blood": data.get('blood'),
                "total_records": 0
            }
            users_collection.insert_one(user_data)
            return jsonify({"message": "Registered successfully!", "user": user_data})
        
        elif action == 'login':
            user = users_collection.find_one({"email": email}, {"_id": 0})
            if "blood_group" in user: user["blood"] = user.pop("blood_group")
            return jsonify({"message": "Logged in successfully!", "user": user})
    else:
        return jsonify({"error": "Invalid or expired OTP."}), 401

# ==========================================
# ENDPOINT: DELETE ENTIRE ACCOUNT
# ==========================================
@api_blueprint.route('/api/delete-account/<email>', methods=['DELETE'])
def delete_account(email):
    try:
        records_collection.delete_many({"user_email": email})
        users_collection.delete_one({"email": email})
        
        safe_email = secure_filename(email)
        user_vault = os.path.join(UPLOAD_FOLDER, safe_email)
        if os.path.exists(user_vault):
            shutil.rmtree(user_vault)
            
        return jsonify({"message": "Account and all medical data permanently deleted."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==========================================
# ENDPOINT: UPLOAD
# ==========================================
@api_blueprint.route('/api/upload', methods=['POST'])
def upload_record():
    if 'files' not in request.files:
        return jsonify({"error": "No files uploaded"}), 400

    uploaded_files = request.files.getlist('files')
    record_category = request.form.get('recordCategory', 'general')
    record_type = request.form.get('recordType', 'mri') 
    record_title = request.form.get('recordTitle', 'Untitled Document')
    document_date = request.form.get('documentDate', '') 
    user_email = request.form.get('userEmail', 'guest@mail.com')
    user_name = request.form.get('userName', 'Guest')
    blood_group = request.form.get('bloodGroup', 'Unknown')

    safe_email = secure_filename(user_email)
    record_id = str(uuid.uuid4())[:8]
    
    user_vault = os.path.join(UPLOAD_FOLDER, safe_email)
    record_folder = os.path.join(user_vault, f"{record_type}_{record_id}")
    os.makedirs(record_folder, exist_ok=True)

    try:
        for file in uploaded_files:
            filename = secure_filename(file.filename)
            file.save(os.path.join(record_folder, filename))

        if not document_date:
            document_date = datetime.datetime.now().strftime('%Y-%m-%d')

        record_data = {
            "record_id": record_id,
            "user_email": user_email,
            "category": record_category,
            "record_type": record_type,
            "title": record_title,
            "document_date": document_date, 
            "folder_path": record_folder,
            "file_count": len(uploaded_files),
            "timestamp": datetime.datetime.now(), 
            "ai_summary": None,
            "has_summary": False
        }
        records_collection.insert_one(record_data)

        users_collection.update_one(
            {"email": user_email},
            {"$set": {"name": user_name, "blood_group": blood_group}, "$inc": {"total_records": 1}},
            upsert=True
        )

        return jsonify({"message": "Record securely saved!", "record_id": record_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==========================================
# ENDPOINT: GET RECORDS
# ==========================================
@api_blueprint.route('/api/records/<email>', methods=['GET'])
def get_records(email):
    try:
        cursor = records_collection.find({"user_email": email}).sort("timestamp", -1)
        records = []
        for doc in cursor:
            records.append({
                "record_id": doc["record_id"],
                "category": doc.get("category", "general"),
                "record_type": doc["record_type"],
                "title": doc["title"],
                "document_date": doc.get("document_date", "Unknown"), 
                "timestamp": doc["timestamp"].isoformat(), 
                "has_summary": doc.get("has_summary", False)
            })
        return jsonify({"records": records})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==========================================
# ENDPOINT: LOAD FILES
# ==========================================
@api_blueprint.route('/api/load_file/<record_id>', methods=['GET'])
def load_file(record_id):
    try:
        record = records_collection.find_one({"record_id": record_id})
        if not record: return jsonify({"error": "Record not found"}), 404
            
        folder_path = record.get("folder_path")
        if not os.path.exists(folder_path): return jsonify({"error": "Files are missing from the vault"}), 404

        files = os.listdir(folder_path)
        if not files: return jsonify({"error": "Folder is empty"}), 404

        r_type = record.get("record_type")

        if r_type == 'lab':
            file_path = os.path.join(folder_path, files[0])
            with open(file_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode('utf-8')
            return jsonify({"type": "pdf", "data": f"data:application/pdf;base64,{encoded}"})

        elif r_type == 'prescription':
            file_path = os.path.join(folder_path, files[0])
            with open(file_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode('utf-8')
            return jsonify({"type": "image", "data": f"data:image/jpeg;base64,{encoded}"})

        elif r_type in ['mri', 'ct', 'xray', 'ultrasound']:
            base64_images = []
            dcm_files = []
            
            for filename in files:
                file_path = os.path.join(folder_path, filename)
                if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                    with open(file_path, "rb") as f:
                        encoded = base64.b64encode(f.read()).decode('utf-8')
                        base64_images.append(f"data:image/jpeg;base64,{encoded}")
                else:
                    dcm_files.append(file_path)

            if dcm_files:
                metadata_list = []
                for file_path in dcm_files:
                    try:
                        dcm_meta = pydicom.dcmread(file_path, stop_before_pixels=True)
                        metadata_list.append((file_path, dcm_meta))
                    except Exception: pass

                metadata_list.sort(key=get_slice_order_from_meta)
                MAX_RENDER = 300
                if len(metadata_list) > MAX_RENDER:
                    step = len(metadata_list) / MAX_RENDER
                    sampled_files = [metadata_list[int(i * step)][0] for i in range(MAX_RENDER)]
                else:
                    sampled_files = [item[0] for item in metadata_list]

                for file_path in sampled_files:
                    try:
                        dcm = pydicom.dcmread(file_path)
                        if hasattr(dcm, 'pixel_array'):
                            raw_pixels = dcm.pixel_array
                            normalized = raw_pixels - np.min(raw_pixels)
                            if np.max(normalized) != 0:
                                normalized = (normalized / np.max(normalized) * 255).astype(np.uint8)
                            else:
                                normalized = np.zeros_like(normalized, dtype=np.uint8)
                            
                            scan_image = Image.fromarray(normalized).convert("RGB")
                            scan_image.thumbnail((1024, 1024))
                            buffered = io.BytesIO()
                            scan_image.save(buffered, format="JPEG")
                            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
                            base64_images.append(f"data:image/jpeg;base64,{img_str}")
                    except Exception: pass
            return jsonify({"type": "dicom", "images": base64_images})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==========================================
# ENDPOINT: AI ANALYZER
# ==========================================
@api_blueprint.route('/api/analyze/<record_id>', methods=['POST'])
def analyze_record(record_id):
    try:
        data = request.get_json(silent=True) or {}
        slice_index = int(data.get("slice_index", 0))

        record = records_collection.find_one({"record_id": record_id})
        if not record: return jsonify({"error": "Record not found"}), 404

        folder_path = record["folder_path"]
        record_type = record["record_type"]
        files = os.listdir(folder_path)
        if not files: return jsonify({"error": "No files found."}), 404
            
        if record_type in ['mri', 'ct', 'xray', 'ultrasound']:
            dcm_files = []
            for filename in files:
                if not filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                    dcm_files.append(os.path.join(folder_path, filename))
                    
            if dcm_files:
                metadata_list = []
                for file_path in dcm_files:
                    try:
                        dcm_meta = pydicom.dcmread(file_path, stop_before_pixels=True)
                        metadata_list.append((file_path, dcm_meta))
                    except Exception: pass
                
                metadata_list.sort(key=get_slice_order_from_meta)
                
                MAX_RENDER = 300
                if len(metadata_list) > MAX_RENDER:
                    step = len(metadata_list) / MAX_RENDER
                    sampled_files = [metadata_list[int(i * step)][0] for i in range(MAX_RENDER)]
                else:
                    sampled_files = [item[0] for item in metadata_list]
                
                safe_index = min(slice_index, len(sampled_files) - 1)
                target_file = sampled_files[safe_index]
            else:
                target_file = os.path.join(folder_path, files[0])
        else:
            target_file = os.path.join(folder_path, files[0])

        cache_key = f"ai_summary_{os.path.basename(target_file).replace('.', '_')}"
        if record.get(cache_key):
            return jsonify({"report": record[cache_key]})

        # YOUR CUSTOM PROMPTS - UNTOUCHED
        if record_type == 'prescription':
            doc_date = record.get("document_date", "Unknown Date")
            prompt = f"""You are an expert medical assistant. Read this handwritten prescription. 
            The date this prescription was written is: {doc_date}.
            Please extract the information and strictly format it into these 3 exact sections using Markdown headers:
            ### 1. 💊 Medicine List
            Extract all medications, dosages, frequency, and duration. Format as a clean bulleted list.
            ### 2. 🔬 Recommended Tests
            List any lab tests, blood work, or scans ordered by the doctor. If none are written, state "No tests prescribed."
            ### 3. 👨‍⚕️ Doctor's Notes & Next Visit
            Extract any clinical notes, symptoms, or lifestyle advice. Format it as a clean list with clear headings. 
            CRITICAL CALENDAR MATH: Look for instructions about the next visit (e.g., "next Saturday", "in 5 days", "after 2 weeks"). Use the prescription date ({doc_date}) to calculate the exact future calendar date. Format it clearly like "Next Visit: 21-03-2026 (Saturday)".
            CRITICAL PRIVACY RULE: Completely ignore and exclude any patient names, doctor names, or personal identifiers.
            """
            img = Image.open(target_file) 
            content = [img, prompt]
                
        elif record_type == 'lab':
            prompt = "You are a helpful doctor. Read this anonymized lab test report. Summarize the results in simple English. Highlight any values out of normal range using bullet points."
            try:
                doc = fitz.open(target_file)
                raw_text = ""
                for page in doc:
                    raw_text += page.get_text() + "\n"
                doc.close()
                safe_redacted_text = anonymize_text(raw_text)
                content = [f"Lab Report Text:\n{safe_redacted_text}", prompt]
            except Exception as pdf_e:
                with open(target_file, "rb") as f:
                    pdf_data = {"inline_data": {"mime_type": "application/pdf", "data": f.read()}}
                    content = [pdf_data, prompt]
                
        elif record_type in ['mri', 'ct', 'xray', 'ultrasound']:
            prompt = f"You are a radiologist AI. Look at slice #{slice_index + 1} of this medical scan. Give a brief, professional technical observation. Use bold text for key findings. CRITICAL: Ignore any patient data visible on the edges of the scan."
            if target_file.lower().endswith(('.jpg', '.jpeg', '.png')):
                img = Image.open(target_file)
                content = [img, prompt]
            else:
                dcm = pydicom.dcmread(target_file)
                raw_pixels = dcm.pixel_array
                norm = (raw_pixels - np.min(raw_pixels)) / (np.max(raw_pixels) - np.min(raw_pixels)) * 255
                img = Image.fromarray(norm.astype(np.uint8)).convert("RGB")
                content = [img, prompt]

        try:
            response = gemini_client.models.generate_content(model='gemini-2.5-flash', contents=content)
            clean_report = response.text.replace("Gemini", "AI").replace("gemini", "AI")
            disclaimer_text = "\n\n---\n**⚠️ MEDICAL DISCLAIMER:** *This report was generated by an AI system for educational and informational purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult with a qualified healthcare provider regarding any medical conditions or test results.*"
            final_report = clean_report + disclaimer_text
            records_collection.update_one({"record_id": record_id}, {"$set": {cache_key: final_report, "has_summary": True}})
            return jsonify({"report": final_report})
            
        except Exception as api_error:
            return jsonify({"error": f"API Blocked: {str(api_error)}"}), 429

    except Exception as e:
        return jsonify({"error": str(e)}), 500
# ==========================================
# ENDPOINT: DOWNLOAD ORIGINAL FILES
# ==========================================
@api_blueprint.route('/api/download/<record_id>', methods=['GET'])
def download_record(record_id):
    try:
        record = records_collection.find_one({"record_id": record_id})
        if not record: return jsonify({"error": "Record not found"}), 404
            
        folder_path = record.get("folder_path")
        if not folder_path or not os.path.exists(folder_path):
            return jsonify({"error": "Files missing from vault"}), 404

        files = os.listdir(folder_path)
        if not files: return jsonify({"error": "Folder is empty"}), 404

        if len(files) == 1:
            return send_from_directory(folder_path, files[0], as_attachment=True)
        
        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            for f in files:
                file_path = os.path.join(folder_path, f)
                zf.write(file_path, arcname=f)
        memory_file.seek(0)
        
        safe_title = "".join([c for c in record['title'] if c.isalpha() or c.isdigit() or c==' ']).rstrip()
        zip_name = f"{safe_title.replace(' ', '_')}_Scans.zip"
        
        return send_file(memory_file, download_name=zip_name, as_attachment=True)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==========================================
# ENDPOINT: DELETE SCAN
# ==========================================
@api_blueprint.route('/api/delete_scan/<record_id>', methods=['DELETE'])
def delete_scan(record_id):
    try:
        record = records_collection.find_one({"record_id": record_id})
        if not record: return jsonify({"error": "Record not found"}), 404
            
        folder_path = record.get("folder_path")
        if folder_path and os.path.exists(folder_path):
            shutil.rmtree(folder_path) 
            
        records_collection.delete_one({"record_id": record_id})
        
        user_email = record.get("user_email")
        if user_email:
            users_collection.update_one({"email": user_email}, {"$inc": {"total_records": -1}})
            
        return jsonify({"message": "Record deleted successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500