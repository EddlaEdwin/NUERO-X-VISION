from flask import Flask, send_from_directory
from flask_cors import CORS
import os
from routes import api_blueprint

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024 * 1024  # 2GB Limit

# Register all the API routes from routes.py
app.register_blueprint(api_blueprint)

# ==========================================
# NEW: SERVE THE FRONTEND FILES TO USERS
# ==========================================

# 1. Serve the main HTML page when someone visits the base URL
@app.route('/')
def serve_index():
    return send_from_directory(os.getcwd(), 'app.html')

# 2. Serve the CSS and JS files when the HTML page requests them
@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory(os.getcwd(), filename)

if __name__ == '__main__':
    app.run(debug=True, port=5000)