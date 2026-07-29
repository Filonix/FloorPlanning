"""
Floor Planner — Flask backend
Advanced floor plan / apartment / house layout editor.
Pure Python + Flask + HTML/Canvas (vanilla JS). No Node, no Prisma.
"""
import os
import json
import time
import uuid
import re
import logging
from functools import wraps
from flask import Flask, render_template, request, jsonify, send_from_directory, g

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["JSON_SORT_KEYS"] = False
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5MB max JSON size
app.config["PORT"] = int(os.environ.get("PORT", 5050))
PORT = app.config["PORT"]

# Security constants
MAX_NAME_LENGTH = 200
MAX_ID_LENGTH = 50
ALLOWED_JSON_KEYS = {'id', 'name', 'updated', 'thumbnail', 'walls', 'openings', 
                      'rooms', 'furniture', 'texts', 'measures', 'symbols', 
                      'layers', 'pxPerMeter', 'gridCm', 'wallThickness', 'ceilingHeight'}


@app.context_processor
def inject_port():
    return {"PORT": PORT}


# ---------- Security & Validation ----------
def validate_json_schema(data, strict=False):
    """Validate JSON structure and content."""
    if not isinstance(data, dict):
        return False, "JSON must be an object"
    
    # Check size
    json_size = len(json.dumps(data))
    if json_size > 4 * 1024 * 1024:  # 4MB limit for actual data
        return False, f"JSON too large: {json_size} bytes"
    
    # Validate ID if present
    if 'id' in data:
        if not isinstance(data['id'], str):
            return False, "ID must be a string"
        if len(data['id']) > MAX_ID_LENGTH:
            return False, f"ID too long: max {MAX_ID_LENGTH} chars"
        if not re.match(r'^[a-zA-Z0-9_-]+$', data['id']):
            return False, "ID contains invalid characters"
        if '..' in data['id'] or '/' in data['id'] or '\\' in data['id']:
            return False, "ID contains path traversal characters"
    
    # Validate name if present
    if 'name' in data:
        if not isinstance(data['name'], str):
            return False, "Name must be a string"
        if len(data['name']) > MAX_NAME_LENGTH:
            return False, f"Name too long: max {MAX_NAME_LENGTH} chars"
    
    # Check for unexpected keys in strict mode
    if strict:
        extra_keys = set(data.keys()) - ALLOWED_JSON_KEYS
        if extra_keys:
            logger.warning(f"Unexpected keys in JSON: {extra_keys}")
    
    return True, "OK"


def sanitize_id(pid: str) -> str:
    """Sanitize and validate plan ID for safe filename usage."""
    if not pid or not isinstance(pid, str):
        return ""
    
    # Limit length first
    pid = pid[:MAX_ID_LENGTH]
    
    # Block path traversal attempts early
    if '..' in pid or '/' in pid or '\\' in pid:
        logger.warning(f"Path traversal attempt detected: {pid[:20]}...")
        return ""
    
    # Allow only safe characters
    sanitized = "".join(c for c in pid if c.isalnum() or c in "-_")
    
    # Ensure not empty after sanitization
    if not sanitized:
        return ""
    
    return sanitized


def rate_limit(max_requests=100, window_seconds=60):
    """Simple in-memory rate limiting decorator."""
    request_history = {}
    
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            client_ip = request.remote_addr or "unknown"
            current_time = time.time()
            
            if client_ip not in request_history:
                request_history[client_ip] = []
            
            # Clean old requests
            request_history[client_ip] = [
                t for t in request_history[client_ip] 
                if current_time - t < window_seconds
            ]
            
            if len(request_history[client_ip]) >= max_requests:
                logger.warning(f"Rate limit exceeded for {client_ip}")
                return jsonify({"error": "Too many requests"}), 429
            
            request_history[client_ip].append(current_time)
            return f(*args, **kwargs)
        
        return wrapped
    return decorator


# ---------- Error Handlers ----------
@app.errorhandler(400)
def bad_request(e):
    logger.warning(f"Bad request: {e}")
    return jsonify({"error": "Bad request"}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(413)
def request_entity_too_large(e):
    logger.warning("Request too large")
    return jsonify({"error": "Payload too large (max 5MB)"}), 413


@app.errorhandler(500)
def internal_error(e):
    logger.error(f"Internal error: {e}")
    return jsonify({"error": "Internal server error"}), 500


@app.before_request
def before_request():
    """Log all requests for debugging."""
    g.start_time = time.time()
    logger.debug(f"{request.method} {request.path} from {request.remote_addr}")


@app.after_request
def after_request(response):
    """Add security headers and log response time."""
    # Security headers
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com"
    
    # Log response time
    if hasattr(g, 'start_time'):
        elapsed = time.time() - g.start_time
        logger.debug(f"Response time: {elapsed:.3f}s")
    
    return response


# ---------- Routes ----------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/plans", methods=["GET"])
@rate_limit(max_requests=200, window_seconds=60)
def list_plans():
    plans = []
    try:
        for fname in sorted(os.listdir(DATA_DIR)):
            if not fname.endswith(".json"):
                continue
            path = os.path.join(DATA_DIR, fname)
            # Prevent path traversal
            if not os.path.abspath(path).startswith(os.path.abspath(DATA_DIR)):
                logger.warning(f"Path traversal attempt: {fname}")
                continue
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                plans.append({
                    "id": data.get("id", fname[:-5]),
                    "name": data.get("name", "Untitled"),
                    "updated": data.get("updated", 0),
                    "thumbnail": data.get("thumbnail", None),
                })
            except Exception as e:
                logger.error(f"Error reading {fname}: {e}")
                continue
    except Exception as e:
        logger.error(f"Error listing plans: {e}")
        return jsonify({"error": "Failed to list plans"}), 500
    plans.sort(key=lambda p: p.get("updated", 0), reverse=True)
    return jsonify(plans)


@app.route("/api/plans", methods=["POST"])
@rate_limit(max_requests=100, window_seconds=60)
def save_plan():
    try:
        body = request.get_json(force=True, silent=True) or {}
    except Exception as e:
        logger.warning(f"Invalid JSON in request: {e}")
        return jsonify({"error": "Invalid JSON format"}), 400
    
    # Validate JSON schema
    valid, msg = validate_json_schema(body, strict=True)
    if not valid:
        logger.warning(f"Validation failed: {msg}")
        return jsonify({"error": msg}), 400
    
    # Generate or sanitize ID
    if not body.get("id"):
        body["id"] = uuid.uuid4().hex[:12]
    else:
        sanitized_id = sanitize_id(body["id"])
        if not sanitized_id:
            return jsonify({"error": "Invalid plan ID"}), 400
        body["id"] = sanitized_id
    
    body["updated"] = int(time.time() * 1000)
    
    # Ensure filename is safe
    filename = f"{body['id']}.json"
    path = os.path.join(DATA_DIR, filename)
    
    # Double-check path safety
    if not os.path.abspath(path).startswith(os.path.abspath(DATA_DIR)):
        logger.warning(f"Path traversal attempt blocked: {filename}")
        return jsonify({"error": "Invalid plan ID"}), 400
    
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(body, f, ensure_ascii=False)
        logger.info(f"Saved plan: {body['id']}")
        return jsonify({"ok": True, "id": body["id"], "updated": body["updated"]})
    except Exception as e:
        logger.error(f"Error saving plan: {e}")
        return jsonify({"error": "Failed to save plan"}), 500


@app.route("/api/plans/<plan_id>", methods=["GET"])
@rate_limit(max_requests=300, window_seconds=60)
def get_plan(plan_id):
    sanitized_id = sanitize_id(plan_id)
    if not sanitized_id:
        return jsonify({"error": "Invalid plan ID"}), 400
    
    filename = f"{sanitized_id}.json"
    path = os.path.join(DATA_DIR, filename)
    
    # Prevent path traversal
    if not os.path.abspath(path).startswith(os.path.abspath(DATA_DIR)):
        logger.warning(f"Path traversal attempt: {plan_id}")
        return jsonify({"error": "Invalid plan ID"}), 400
    
    if not os.path.exists(path):
        return jsonify({"error": "not found"}), 404
    
    try:
        with open(path, "r", encoding="utf-8") as f:
            return jsonify(json.load(f))
    except Exception as e:
        logger.error(f"Error reading plan {sanitized_id}: {e}")
        return jsonify({"error": "Failed to read plan"}), 500


@app.route("/api/plans/<plan_id>", methods=["DELETE"])
@rate_limit(max_requests=50, window_seconds=60)
def delete_plan(plan_id):
    sanitized_id = sanitize_id(plan_id)
    if not sanitized_id:
        return jsonify({"error": "Invalid plan ID"}), 400
    
    filename = f"{sanitized_id}.json"
    path = os.path.join(DATA_DIR, filename)
    
    # Prevent path traversal
    if not os.path.abspath(path).startswith(os.path.abspath(DATA_DIR)):
        logger.warning(f"Path traversal attempt: {plan_id}")
        return jsonify({"error": "Invalid plan ID"}), 400
    
    try:
        if os.path.exists(path):
            os.remove(path)
            logger.info(f"Deleted plan: {sanitized_id}")
        return jsonify({"ok": True})
    except Exception as e:
        logger.error(f"Error deleting plan: {e}")
        return jsonify({"error": "Failed to delete plan"}), 500


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "service": "floorplanner", "ts": int(time.time())})


@app.route("/favicon.ico")
def favicon():
    return "", 204


def safe_id(pid: str) -> str:
    """Allow only safe filenames. (Legacy alias for sanitize_id)"""
    return sanitize_id(pid)


if __name__ == "__main__":
    # Fixed port (gateway forwards via ?XTransformPort=5050)
    # use_reloader=False because we run as a background service
    logger.info(f"Starting Floor Planner on port {PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=True, use_reloader=False)
