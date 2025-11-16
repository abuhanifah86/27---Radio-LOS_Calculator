import os
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .models import DistanceRequest, DistanceResponse, LosAnalysisRequest, LosAnalysisResponse
from .services import BasicLosResult, evaluate_basic_los, haversine
from .los import analyze_los

app = FastAPI(title="Radio LOS API")

# Allow local development from Streamlit (or other origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gpt-oss:120b-cloud")
try:
    OLLAMA_TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT", "20"))
except ValueError:
    OLLAMA_TIMEOUT = 20.0


async def _ollama_generate(prompt: str, **options: Any) -> str | None:
    """Call local Ollama API and return plain-text response."""
    if not prompt.strip():
        return None
    if not OLLAMA_BASE_URL:
        return None
    url = f"{OLLAMA_BASE_URL}/api/generate"
    payload: dict[str, Any] = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
    }
    if options:
        payload["options"] = options
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return str(data.get("response", "")).strip() or None
    except Exception:
        return None


async def _summarize_distance(
    req: DistanceRequest,
    distance_km: float,
    analysis: BasicLosResult,
    recommendation: str,
) -> str | None:
    """Generate an AI summary for the basic distance calculation."""
    los_text = "available" if analysis.los else "blocked"
    fresnel_ratio = "n/a"
    if analysis.fresnel_ratio is not None:
        fresnel_ratio = f"{analysis.fresnel_ratio:.2f}"
    fresnel_radius = "n/a"
    if analysis.fresnel_radius_m is not None:
        fresnel_radius = f"{analysis.fresnel_radius_m:.3f} m"
    prompt = f"""
You are a radio link planner. Summarize the feasibility of a point-to-point radio path.

Distance: {distance_km:.3f} km
Horizon limit (k={req.k_factor:.3f}): {analysis.horizon_limit_km:.3f} km
Midpoint clearance above Earth bulge: {analysis.midpoint_clearance_m:.3f} m
First Fresnel radius: {fresnel_radius}
Fresnel clearance ratio: {fresnel_ratio}
LOS status: {los_text}
Recommendation: {recommendation}

Site A: lat {req.pointA.lat:.6f}, lon {req.pointA.lon:.6f}, antenna height {req.pointA.height:.1f} m
Site B: lat {req.pointB.lat:.6f}, lon {req.pointB.lon:.6f}, antenna height {req.pointB.height:.1f} m

Provide a concise explanation (max 3 sentences) highlighting whether LOS is viable, any risk due to antenna heights, and suggested next actions if LOS is blocked.
"""
    return await _ollama_generate(prompt, temperature=0.3)


async def _summarize_los(req: LosAnalysisRequest, result):
    """Generate an AI summary for the detailed LOS analysis."""
    los_text = "clear" if result.los else "blocked"
    prompt = f"""
You are a radio-frequency engineer. Analyse a detailed line-of-sight study and provide actionable feedback.

Transmission site: lat {req.tx_lat:.6f}, lon {req.tx_lon:.6f}, antenna height {req.tx_height_m:.1f} m
Reception site: lat {req.rx_lat:.6f}, lon {req.rx_lon:.6f}, antenna height {req.rx_height_m:.1f} m
Operating frequency: {req.frequency_hz:.0f} Hz
Effective Earth radius factor (k): {req.k_factor:.3f}
Total distance: {result.distance_km:.3f} km
Minimum clearance along path: {result.min_clearance_m:.3f} m
Minimum Fresnel clearance (ratio): {result.fresnel_percent:.3f}
Maximum obstacle apex: {result.max_obstacle_height_m:.3f} m
LOS verdict: {los_text}

Explain the limiting factor, note if Fresnel clearance is sufficient (threshold {req.fresnel_clearance_threshold:.2f}), and recommend specific mitigation (e.g., raise antenna, change frequency, reposition sites). Use 3-4 sentences.
"""
    return await _ollama_generate(prompt, temperature=0.35)


def frequency_recommendation(distance_km: float) -> str:
    """Suggest a frequency band based on link distance (heuristic)."""
    if distance_km < 30:
        return "VHF (30‑300 MHz) – omnidirectional antennas recommended"
    if distance_km < 80:
        return "UHF (300‑3000 MHz) – directional antennas, gain 12‑18 dBi"
    if distance_km < 300:
        return "SHF (3‑30 GHz) – high-gain parabolic antennas (> 30 dBi)"
    return "EHF (> 30 GHz) – use only with clear LOS and favorable weather"

@app.get("/")
async def health():
    return {"status": "ok", "service": "radio-los", "version": "1.0.0"}

@app.post("/distance", response_model=DistanceResponse)
async def calculate(req: DistanceRequest) -> DistanceResponse:
    d = haversine(
        req.pointA.lat, req.pointA.lon,
        req.pointB.lat, req.pointB.lon,
    )
    analysis = evaluate_basic_los(
        dist_km=d,
        h1_m=req.pointA.height,
        h2_m=req.pointB.height,
        k_factor=req.k_factor,
        frequency_hz=req.frequency_hz,
        fresnel_clearance_ratio=req.fresnel_clearance_ratio,
    )
    los = analysis.los
    if not los:
        rec = "No LOS detected – unsuitable for point-to-point radio."
    else:
        rec = frequency_recommendation(d)
    ai_summary = await _summarize_distance(req, d, analysis, rec)
    fresnel_radius = analysis.fresnel_radius_m
    fresnel_ratio = analysis.fresnel_ratio
    return DistanceResponse(
        distance_km=round(d, 3),
        los=los,
        recommendation=rec,
        horizon_limit_km=round(analysis.horizon_limit_km, 3),
        midpoint_clearance_m=round(analysis.midpoint_clearance_m, 3),
        fresnel_radius_m=round(fresnel_radius, 3) if fresnel_radius is not None else None,
        fresnel_ratio=round(fresnel_ratio, 3) if fresnel_ratio is not None else None,
        ai_summary=ai_summary,
    )


@app.post("/los-analysis", response_model=LosAnalysisResponse)
async def los_analysis(req: LosAnalysisRequest) -> LosAnalysisResponse:
    try:
        result = analyze_los(
            tx_lat=req.tx_lat,
            tx_lon=req.tx_lon,
            tx_height_m=req.tx_height_m,
            rx_lat=req.rx_lat,
            rx_lon=req.rx_lon,
            rx_height_m=req.rx_height_m,
            frequency_hz=req.frequency_hz,
            k_factor=req.k_factor,
            dem_path=req.dem_path,
            obstacle_dataset=req.obstacle_dataset,
            fresnel_clearance_threshold=req.fresnel_clearance_threshold,
            sample_step_m=req.sample_step_m,
            include_plot=req.profile_plot,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    ai_summary = await _summarize_los(req, result)

    return LosAnalysisResponse(
        los=result.los,
        min_clearance_m=result.min_clearance_m,
        fresnel_percent=result.fresnel_percent,
        max_obstacle_height_m=result.max_obstacle_height_m,
        distance_km=result.distance_km,
        profile_plot=result.profile_plot if req.profile_plot else None,
        ai_summary=ai_summary,
    )
