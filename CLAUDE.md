# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A bicycle chainring visualizer — a Flask web app that renders two chainrings with an open-wrap chain and computes chain geometry. Stack: Python/Flask backend, vanilla JS + HTML Canvas frontend.

## Running the App

```bash
# First-time setup
python3 -m venv venv
venv/bin/pip install flask

# Run (port 5000 is macOS AirPlay; use 8080 or similar)
venv/bin/python3 -c "from app import app; app.run(port=8080, debug=True)"
# Then open http://localhost:8080
```

## Architecture

```
geometry.py         — Pure math: pitch radii, tangent points, arc angles, chain length
app.py              — Flask: GET / serves page, POST /api/calculate calls geometry.py
templates/index.html — Controls sidebar + <canvas id="chain-canvas">
static/app.js        — Canvas rendering + fetch API calls
static/style.css     — Dark theme, flexbox layout
```

**Data flow:** user inputs → `POST /api/calculate` → `geometry.compute_geometry()` → JSON → `app.js draw()`

## Domain Knowledge

**Configuration:** Open wrap (external tangents — standard bicycle drivetrain).

**Key formulas** (all in `geometry.py`):
- Pitch circle radius: `R = pitch / (2 * sin(π/N))`
- Tangent offset: `a = (R1 - R2) / D`, `b = sqrt(1 - a²)`
- Tangent contact points: `P_top = (R·a, R·b)`, `P_bot = (R·a, -R·b)`
- Span length: `L = sqrt(D² - (R1-R2)²)`
- Wrap angle ring 1 (long arc): `φ1 = π + 2·arcsin((R1-R2)/D)`
- Wrap angle ring 2 (short arc): `φ2 = π - 2·arcsin((R1-R2)/D)`
- Chain length: `2·L + R1·φ1 + R2·φ2`
- Links: round to nearest even integer

**Chain path draw order:** arc1 (ring1, CCW long arc) → upper span → arc2 (ring2, CW short arc) → lower span.

## Canvas Coordinate Transform

`geometry.py` uses math coordinates (y-axis up). `app.js` converts to canvas space (y-axis down):
```
canvas_x = ox + mx * scale
canvas_y = oy − my * scale   ← y negated
```
Arc angles: pass `-math_angle` to `canvas.arc()`. Winding: pass `!arc.counterclockwise` (y-flip reverses winding direction).

## API

`POST /api/calculate`

Request: `{ teeth1, teeth2, center_distance, pitch }`

Response: `{ ring1, ring2, tangents[2], arcs[2], chain_length, num_links, teeth_angles }`

Validation errors return HTTP 400 with `{ "error": "..." }`.
