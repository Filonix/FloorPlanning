"""
Floor Planner — Flask backend
Advanced floor plan / apartment / house layout editor.
Pure Python + Flask + HTML/Canvas (vanilla JS). No Node, no Prisma.
"""
import os
import json
import time
import uuid
from flask import Flask, render_template, request, jsonify, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["JSON_SORT_KEYS"] = False
PORT = 5050


@app.context_processor
def inject_port():
    return {"PORT": PORT}


# ---------- Routes ----------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/plans", methods=["GET"])
def list_plans():
    plans = []
    for fname in sorted(os.listdir(DATA_DIR)):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(DATA_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            plans.append({
                "id": data.get("id", fname[:-5]),
                "name": data.get("name", "Untitled"),
                "updated": data.get("updated", 0),
                "thumbnail": data.get("thumbnail", None),
            })
        except Exception:
            continue
    plans.sort(key=lambda p: p.get("updated", 0), reverse=True)
    return jsonify(plans)


@app.route("/api/plans", methods=["POST"])
def save_plan():
    body = request.get_json(force=True, silent=True) or {}
    if not body.get("id"):
        body["id"] = uuid.uuid4().hex[:12]
    body["updated"] = int(time.time() * 1000)
    path = os.path.join(DATA_DIR, f"{body['id']}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False)
    return jsonify({"ok": True, "id": body["id"], "updated": body["updated"]})


@app.route("/api/plans/<plan_id>", methods=["GET"])
def get_plan(plan_id):
    path = os.path.join(DATA_DIR, f"{safe_id(plan_id)}.json")
    if not os.path.exists(path):
        return jsonify({"error": "not found"}), 404
    with open(path, "r", encoding="utf-8") as f:
        return jsonify(json.load(f))


@app.route("/api/plans/<plan_id>", methods=["DELETE"])
def delete_plan(plan_id):
    path = os.path.join(DATA_DIR, f"{safe_id(plan_id)}.json")
    if os.path.exists(path):
        os.remove(path)
    return jsonify({"ok": True})


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "service": "floorplanner", "ts": int(time.time())})


@app.route("/favicon.ico")
def favicon():
    return "", 204


def safe_id(pid: str) -> str:
    """Allow only safe filenames."""
    return "".join(c for c in pid if c.isalnum() or c in "-_")


if __name__ == "__main__":
    # Fixed port (gateway forwards via ?XTransformPort=5050)
    # use_reloader=False because we run as a background service
    app.run(host="0.0.0.0", port=5050, debug=True, use_reloader=False)
