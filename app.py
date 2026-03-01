from flask import Flask, render_template, request, jsonify
from geometry import compute_geometry

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/calculate", methods=["POST"])
def calculate():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Expected JSON body."}), 400

    required = ["teeth1", "teeth2", "center_distance", "pitch"]
    for field in required:
        if field not in data:
            return jsonify({"error": f"Missing field: {field}"}), 400

    try:
        teeth1          = int(data["teeth1"])
        teeth2          = int(data["teeth2"])
        center_distance = float(data["center_distance"])
        pitch           = float(data["pitch"])
    except (ValueError, TypeError) as e:
        return jsonify({"error": f"Invalid value: {e}"}), 400

    if teeth1 < 3 or teeth2 < 3:
        return jsonify({"error": "Chainrings must have at least 3 teeth."}), 400
    if center_distance <= 0 or pitch <= 0:
        return jsonify({"error": "Center distance and pitch must be positive."}), 400

    try:
        result = compute_geometry(teeth1, teeth2, center_distance, pitch)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True)
