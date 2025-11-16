# Radio LOS Calculator

FastAPI backend + React (Vite + TypeScript) frontend for planning point-to-point radio links. The application combines geometric Earth curvature modelling with Fresnel zone clearance and can optionally enrich results with AI-generated insights via a local Ollama model. The React SPA adds in-browser coordinate conversion (DMS, DDM, UTM, MGRS, GARS, Plus Codes, Geohash, What3Words), OpenStreetMap plotting of Site A/B, and responsive layouts for phones, tablets, and desktops.

- Computes great-circle distance (Haversine) between any two geodetic coordinates.
- Estimates line-of-sight (LOS) feasibility using an effective Earth radius (k-factor) model.
- Evaluates first-Fresnel clearance at path midpoint to highlight marginal microwave links.
- Provides frequency band recommendations and optional AI commentary on results.
- Offers a detailed `/los-analysis` endpoint that samples DEMs/obstacles for terrain-aware studies.
- Renders Site A and Site B on an OpenStreetMap preview so you can visually confirm positions.

## Demo

[![Watch the demo](https://img.youtube.com/vi/zQoGK-9Vv_Y/hqdefault.jpg)](https://youtu.be/zQoGK-9Vv_Y)


## How It Works

1. **Frontend (React)** collects site parameters, antenna heights, radio band/frequency selections, and converts multiple coordinate formats into decimal degrees.
2. **Backend (FastAPI)** receives the request, computes distance via `backend.services.haversine`, and runs `evaluate_basic_los` to combine Earth curvature, k-factor refraction, and Fresnel clearance.
3. **Frequency Suggestion** derives an appropriate band (VHF/UHF/SHF/EHF) based on the computed distance.
4. **AI Insight (Optional)** packages the numeric results into a prompt for an Ollama-hosted model (`gpt-oss:120b-cloud` by default) and returns the generated narrative alongside the numeric fields.
5. **Detailed Analysis (Optional)** uses `backend.los.analyze_los` to sample DEM rasters, apply k-factor curvature along the full path, and evaluate Fresnel clearance across all samples when terrain/obstacle files are supplied.


## Quick Start

Prerequisites: Python 3.10+ and pip for the backend, Node.js 18+ for the frontend.

1) Create and activate a virtual environment:

```bash
python -m venv .venv
# Linux / macOS
source .venv/bin/activate
# Windows (PowerShell)
.\.venv\Scripts\Activate.ps1
```

2) Install dependencies:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

3) Run the backend (port 8000):

```bash
uvicorn backend.main:app --reload --port 8000
```

4) Run the frontend (Vite + React, default port 4173):

```bash
cd frontend
npm install
npm run dev -- --host --port 4173   # or npm run preview after npm run build
```

Open http://localhost:4173 and click “Calculate”. The page calls the FastAPI backend directly (CORS is enabled). For production, run `npm run build` then `npm run preview` (or serve `frontend/dist` behind any static server).

**One-command launcher:** From the repo root you can also run `./run_app.sh` (Linux/macOS) or `powershell -ExecutionPolicy Bypass -File .\run_app.ps1` (Windows) to start both backend (Uvicorn) and the frontend preview server. The script builds the frontend before serving.


## Frontend Controls

| Control | Default | Description |
| --- | --- | --- |
| `Backend URL` | `http://localhost:8000` | Base URL for the FastAPI server. Adjust if hosting remotely. |
| `Timeout (ms)` | `8000` | HTTP request timeout (milliseconds) for calls from the React app to FastAPI. |
| `Band selector` | `UHF` | Preloads a sensible frequency for UHF/SHF/EHF/VHF; still overrideable. |
| `Frequency (MHz)` | `900` | Carrier frequency used to compute Fresnel radius. |
| `k-factor (Refraction)` | `1.3333…` | Effective Earth radius multiplier modelling atmospheric refraction (standard atmosphere ≈4/3). |
| `Fresnel clearance ratio` | `0.6` | Minimum acceptable clearance relative to the Fresnel radius at midpoint. |
| `Coordinate converter` | *none* | Convert DMS, DDM, UTM, MGRS, GARS, Geohash, Plus Codes, or What3Words (with API key) to Decimal Degrees and push into Site A/B. |
| `Tabs` | *Calculator / Geo tools / Settings* | Calculator tab holds LOS inputs + OSM map; Geo tools tab hosts the converter; Settings tab holds backend URL & timeout. |


## Backend Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Base URL for the Ollama REST API. Leave empty to disable AI summaries. |
| `OLLAMA_MODEL` | `gpt-oss:120b-cloud` | Model tag served by Ollama. Replace with any locally available model. |
| `OLLAMA_TIMEOUT` | `20` | Timeout (seconds) for Ollama generation requests. Increase for larger models. |


## Request Parameters

### `/distance`

- `pointA` / `pointB` — latitude, longitude, and antenna height (meters) for each site.
- `frequency_hz` — operating frequency. Determines Fresnel zone size.
- `k_factor` — effective Earth radius multiplier. Common values: 1.0 (no refraction), 1.33 (standard), 2.0 (ducting).
- `fresnel_clearance_ratio` — minimum clearance as a fraction of Fresnel radius. Set to 1.0 for full clearance, or lower for relaxed planning.

```
POST /distance
Content-Type: application/json

{
  "pointA": {"lat": -6.200000, "lon": 106.816666, "height": 30},
  "pointB": {"lat": -6.914744, "lon": 107.609810, "height": 15},
  "frequency_hz": 5800000000,
  "k_factor": 1.3333333333,
  "fresnel_clearance_ratio": 0.6
}
```

Example response:

```json
{
  "distance_km": 123.456,
  "los": true,
  "recommendation": "UHF (300‑3000 MHz) – directional antennas, gain 12‑18 dBi",
  "horizon_limit_km": 152.443,
  "midpoint_clearance_m": 18.421,
  "fresnel_radius_m": 12.308,
  "fresnel_ratio": 1.49,
  "ai_summary": "..."
}
```

### `/los-analysis`

Superset of `/distance`, adding DEM/obstacle inputs for terrain-aware profiling. Key fields:

- `dem_path` — path to a DEM raster (GeoTIFF). Requires `rasterio`.
- `obstacle_dataset` — CSV or GeoJSON with obstacles (optional).
- `fresnel_clearance_threshold` — clearance ratio applied along the full path.
- `sample_step_m` — spacing (meters) for sampling along the path.
- `profile_plot` — boolean; include base64 PNG plot when true.

```
POST /los-analysis
Content-Type: application/json

{
  "tx_lat": -6.2,
  "tx_lon": 106.8167,
  "tx_height_m": 30,
  "rx_lat": -6.9147,
  "rx_lon": 107.6098,
  "rx_height_m": 20,
  "frequency_hz": 5800000000,
  "k_factor": 1.3333333333,
  "dem_path": "path/to/dem.tif",
  "obstacle_dataset": "path/to/obstacles.csv",
  "fresnel_clearance_threshold": 0.6,
  "sample_step_m": 50,
  "profile_plot": true
}
```

Response:

```json
{
  "los": true,
  "min_clearance_m": 12.345,
  "fresnel_percent": 0.78,
  "max_obstacle_height_m": 842.1,
  "distance_km": 151.234,
  "profile_plot": "<base64 PNG>"
}
```


## AI Insights (Optional)

- Ensure Ollama is running and the desired model is pulled: `ollama pull gpt-oss:120b-cloud`.
- The backend posts prompts containing numeric LOS metrics and site details. AI output is returned in the `ai_summary` field and displayed inside the React “AI insight” box as human-readable text (no raw markdown).
- If the Ollama service is unreachable, the calculator still returns numeric results; `ai_summary` remains `null`.


## Architecture

```
.
├─ backend/
│  ├─ main.py       # FastAPI app (CORS + / + /distance)
│  ├─ models.py     # Pydantic schemas with Fresnel/k-factor inputs
│  ├─ services.py   # Haversine, curvature, Fresnel computations
│  └─ los.py        # Terrain-aware LOS analysis using DEM & obstacles
├─ frontend/
│  ├─ index.html    # Vite entrypoint
│  ├─ src/          # React + TypeScript SPA (coordinate converter + LOS UI)
│  ├─ package.json  # Vite + React deps/scripts
│  └─ vite.config.ts
├─ tests/
│  ├─ test_services.py
│  └─ test_api.py
└─ requirements.txt
```


## Testing

```bash
pytest -q
```

The suite covers core geometry calculations and validates `/distance` response structure. Install optional dependencies (rasterio, shapely) for terrain-aware features.


## Troubleshooting

- **Blank page**: ensure you run `npm run dev` or `npm run preview` (or `run_app.sh`/`run_app.ps1`). Serving the raw Vite source with a plain static server will show a white page.
- **Connection error / timeout**: make sure the backend is running and the `Backend URL` field points to it (`http://localhost:8000` by default). Increase the frontend timeout (ms) if the backend is slow.
- **Port in use**: change the Uvicorn port (`--port`) and update the frontend field accordingly.
- **Missing AI summary**: verify Ollama is running locally and the environment variables point to it.
- **Permission issues running tests**: run inside a virtual environment where you have write access (pytest creates `.pytest_cache` directories).


## Notes & Next Steps

- The quick LOS check assumes flat terrain and identical ground elevation. For terrain-aware studies, use `/los-analysis` with DEM/obstacle data, which already incorporates full Fresnel sampling across the path.
- If you need terrain uploads in the UI, extend the React SPA with DEM/obstacle file pickers wired to `/los-analysis`.
- Consider caching DEM samples for repeated analyses along similar paths to reduce latency.
