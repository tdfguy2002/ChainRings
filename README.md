# ChainRings

A bicycle chainring visualizer. Enter two sprocket sizes, a center distance, and a chain pitch — the app draws the chain path and computes chain length, link count, and the exact center distance that eliminates any remainder in the link calculation.

![ChainRings screenshot](https://github.com/tdfguy2002/ChainRings/raw/main/screenshot.png)

## Setup

```bash
python3 -m venv venv
venv/bin/pip install flask
```

## Running

Port 5000 is reserved by macOS AirPlay; use a different port:

```bash
venv/bin/python3 -c "from app import app; app.run(port=8080, debug=True)"
```

Then open http://localhost:8080.

## Inputs

| Field | Description | Default |
|---|---|---|
| Ring 1 teeth | Number of teeth on the first chainring | 44 |
| Ring 2 teeth | Number of teeth on the second chainring | 22 |
| Center distance | Distance between ring centers (mm) | 300 |
| Chain pitch | Roller-to-roller distance (mm) | 12.7 (standard ½″ chain) |

## Outputs

- **Canvas drawing** — pitch circles (dashed), tooth positions, and the chain path
- **Chain length** — total path length in mm
- **Number of links** — nearest even integer (chain links come in pairs)
- **Adjusted center** — exact center distance that makes the link count a whole even number with no remainder
- **Wrap angles** — degrees of chain contact on each ring (φ₁, φ₂)

## How it works

**Pitch circle radius** — teeth are treated as vertices of a regular polygon inscribed in the pitch circle, so the chord between adjacent teeth equals the chain pitch:

```
R = pitch / (2 · sin(π / N))
```

**Open wrap geometry** — standard bicycle drivetrain configuration (external tangents). With rings at (0, 0) and (D, 0):

```
a = (R₁ − R₂) / D
tangent contact points: (R·a, ±R·√(1−a²))
span length: √(D² − (R₁−R₂)²)
φ₁ = π + 2·arcsin((R₁−R₂)/D)   ← ring 1, long arc
φ₂ = π − 2·arcsin((R₁−R₂)/D)   ← ring 2, short arc
chain length = 2·L_span + R₁·φ₁ + R₂·φ₂
```

**Adjusted center distance** — Newton's method solves for D such that `chain_length(D) = N_links · pitch` exactly. Converges in under 10 iterations.

## Project structure

```
app.py               Flask server (GET /, POST /api/calculate)
geometry.py          Chain geometry math (no Flask dependency)
templates/index.html Controls sidebar + canvas
static/app.js        Canvas rendering, coordinate transform, API calls
static/style.css     Dark theme, flexbox layout
```
