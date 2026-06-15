from config import analyzer, anonymizer

def get_slice_order_from_meta(item):
    """Sorts DICOM slices correctly based on their physical spatial location."""
    dcm_meta = item[1]
    try:
        if 'InstanceNumber' in dcm_meta and dcm_meta.InstanceNumber != '':
            return int(dcm_meta.InstanceNumber)
        elif 'SliceLocation' in dcm_meta and dcm_meta.SliceLocation != '':
            return float(dcm_meta.SliceLocation)
    except Exception:
        pass
    return 0

def anonymize_text(text):
    """Scans text for PII (Names, Phones, Locations) and redacts it before sending to the cloud."""
    if not analyzer or not anonymizer:
        return text # Failsafe if NLP isn't loaded
        
    target_entities = ["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "LOCATION"]
    
    results = analyzer.analyze(text=text, entities=target_entities, language='en')
    anonymized_result = anonymizer.anonymize(text=text, analyzer_results=results)
    
    return anonymized_result.text
import smtplib
import random
from email.mime.text import MIMEText

def send_verification_email(receiver_email, otp_code):
    # REPLACE THESE WITH YOUR DETAILS
    sender_email = "neurox.support@gmail.com" 
    app_password = "uvxlncswvpxjcizs" # No spaces!

    msg = MIMEText(f"Your Neuro X Vision secure login code is: {otp_code}\n\nDo not share this code with anyone.")
    msg['Subject'] = 'Neuro X Vision - Security OTP'
    msg['From'] = "Neuro X Vision Security"
    msg['To'] = receiver_email

    try:
        # Connect securely to Gmail's server
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(sender_email, app_password)
        server.send_message(msg)
        server.quit()
        return True
    except Exception as e:
        print(f"Email Error: {e}")
        return False