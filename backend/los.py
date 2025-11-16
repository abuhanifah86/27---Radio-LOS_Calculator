from __future__ import annotations

import base64
import io
import json
import math
from dataclasses import dataclass
from typing import Iterable, List, Tuple

from .services import haversine


R_EARTH_M = 6371000.0


def _gc_intermediate_points(lat1: float, lon1: float, lat2: float, lon2: float, n: int) -> List[Tuple[float, float, float]]:
    """Great-circle interpolate n+1 points including endpoints.

    Returns list of (lat, lon, frac) with frac in [0,1].
    """
    if n < 1:
        return [(lat1, lon1, 0.0), (lat2, lon2, 1.0)]
    φ1, λ1 = math.radians(lat1), math.radians(lon1)
    φ2, λ2 = math.radians(lat2), math.radians(lon2)
    Δ = 2 * math.asin(
        math.sqrt(
            math.sin((φ2 - φ1) / 2) ** 2
            + math.cos(φ1) * math.cos(φ2) * math.sin((λ2 - λ1) / 2) ** 2
        )
    )
    if Δ == 0:
        return [(lat1, lon1, 0.0), (lat2, lon2, 1.0)]
    sinΔ = math.sin(Δ)
    pts: List[Tuple[float, float, float]] = []
    for i in range(n + 1):
        f = i / n
        A = math.sin((1 - f) * Δ) / sinΔ
        B = math.sin(f * Δ) / sinΔ
        x = A * math.cos(φ1) * math.cos(λ1) + B * math.cos(φ2) * math.cos(λ2)
        y = A * math.cos(φ1) * math.sin(λ1) + B * math.cos(φ2) * math.sin(λ2)
        z = A * math.sin(φ1) + B * math.sin(φ2)
        φi = math.atan2(z, math.sqrt(x * x + y * y))
        λi = math.atan2(y, x)
        pts.append((math.degrees(φi), math.degrees(λi), f))
    return pts


def _load_dem_sampler(dem_path: str):
    try:
        import rasterio
        from rasterio.warp import transform
    except Exception as e:  # pragma: no cover - optional dependency
        raise RuntimeError("rasterio is required to read DEM rasters") from e

    ds = rasterio.open(dem_path)
    crs = ds.crs

    def sample_fn(lats: Iterable[float], lons: Iterable[float]) -> List[float]:
        coords = list(zip(lons, lats))
        if crs and str(crs).lower() not in ("epsg:4326", "wgs84"):
            xs, ys = transform({"init": "epsg:4326"}, crs, [c[0] for c in coords], [c[1] for c in coords])
            coords_crs = list(zip(xs, ys))
        else:
            coords_crs = coords
        vals = []
        for v in ds.sample(coords_crs):
            val = float(v[0])
            if math.isnan(val):
                vals.append(0.0)
            else:
                vals.append(val)
        return vals

    return ds, sample_fn


def _load_obstacles(obstacle_path: str | None):
    if not obstacle_path:
        return []
    if obstacle_path.lower().endswith(".csv"):
        import csv

        items = []
        with open(obstacle_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    items.append(
                        {
                            "lat": float(row["lat"]),
                            "lon": float(row["lon"]),
                            "height_m": float(row.get("height_m") or row.get("height") or 0.0),
                            "radius_m": float(row.get("radius_m") or 0.0),
                        }
                    )
                except Exception:
                    continue
        return items
    if obstacle_path.lower().endswith(".geojson") or obstacle_path.lower().endswith(".json"):
        try:
            from shapely.geometry import shape, Point  # type: ignore
        except Exception as e:  # pragma: no cover - optional
            raise RuntimeError("shapely is required to read GeoJSON obstacles") from e
        with open(obstacle_path, "r", encoding="utf-8") as f:
            gj = json.load(f)
        feats = gj.get("features", [])
        items = []
        for ft in feats:
            geom = shape(ft.get("geometry"))
            props = ft.get("properties", {}) or {}
            h = float(props.get("height_m") or props.get("height") or 0.0)
            if geom.geom_type == "Point":
                lon, lat = geom.x, geom.y
                items.append({"lat": lat, "lon": lon, "height_m": h, "radius_m": float(props.get("radius_m") or 0.0)})
            else:
                items.append({"polygon": geom, "height_m": h})
        return items
    # Other formats would need geopandas - not supported by default
    raise RuntimeError("Unsupported obstacle dataset format (use CSV or GeoJSON)")


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    return haversine(lat1, lon1, lat2, lon2) * 1000.0


def _earth_bulge_m(x: float, d: float, k_factor: float) -> float:
    Re = R_EARTH_M * k_factor
    return x * (d - x) / (2 * Re)


def _distance_m(lat1, lon1, lat2, lon2):
    return _haversine_m(lat1, lon1, lat2, lon2)


def _point_to_point_distance_m(lat1, lon1, lat2, lon2):
    return _haversine_m(lat1, lon1, lat2, lon2)


def _orthodromic_chain(points: List[Tuple[float, float]]) -> List[float]:
    dists = [0.0]
    acc = 0.0
    for i in range(1, len(points)):
        acc += _point_to_point_distance_m(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
        dists.append(acc)
    return dists


def _nearest_obstacle_height_m(sample_lat: float, sample_lon: float, dem_at_sample: float, obstacles) -> float:
    try:
        from shapely.geometry import Point  # type: ignore
    except Exception:
        Point = None  # type: ignore

    obs_top = 0.0
    if not obstacles:
        return 0.0
    for ob in obstacles:
        if "polygon" in ob:
            if Point is None:
                continue
            if ob["polygon"].contains(Point(sample_lon, sample_lat)):
                obs_top = max(obs_top, dem_at_sample + float(ob["height_m"]))
        else:
            lat, lon = float(ob["lat"]), float(ob["lon"])
            r = float(ob.get("radius_m", 0.0)) or 10.0
            d = _distance_m(sample_lat, sample_lon, lat, lon)
            if d <= r:
                obs_top = max(obs_top, dem_at_sample + float(ob["height_m"]))
    return obs_top - dem_at_sample


@dataclass
class AnalysisResult:
    los: bool
    min_clearance_m: float
    fresnel_percent: float
    max_obstacle_height_m: float
    distance_km: float
    profile_plot: str | None


def analyze_los(
    *,
    tx_lat: float,
    tx_lon: float,
    tx_height_m: float,
    rx_lat: float,
    rx_lon: float,
    rx_height_m: float,
    frequency_hz: float,
    k_factor: float,
    dem_path: str,
    obstacle_dataset: str | None,
    fresnel_clearance_threshold: float,
    sample_step_m: int,
    include_plot: bool,
) -> AnalysisResult:
    if frequency_hz <= 0:
        raise ValueError("frequency_hz must be > 0")
    if k_factor <= 0:
        raise ValueError("k_factor must be > 0")
    if sample_step_m <= 0:
        raise ValueError("sample_step_m must be > 0")

    ds, dem_sample = _load_dem_sampler(dem_path)
    obstacles = _load_obstacles(obstacle_dataset) if obstacle_dataset else []

    total_m = _haversine_m(tx_lat, tx_lon, rx_lat, rx_lon)
    distance_km = total_m / 1000.0
    n_steps = max(2, int(round(total_m / sample_step_m)))
    pts = _gc_intermediate_points(tx_lat, tx_lon, rx_lat, rx_lon, n_steps)
    lat_list = [p[0] for p in pts]
    lon_list = [p[1] for p in pts]
    fracs = [p[2] for p in pts]
    d_chain = _orthodromic_chain([(p[0], p[1]) for p in pts])
    elevs = dem_sample(lat_list, lon_list)

    elev_tx = elevs[0]
    elev_rx = elevs[-1]
    alt_tx = elev_tx + tx_height_m
    alt_rx = elev_rx + rx_height_m

    c = 299792458.0
    wavelength = c / frequency_hz

    min_clearance = float("inf")
    min_fresnel_pct = float("inf")
    max_obstacle_top = 0.0

    clear_all = True
    obstruction_profile: List[float] = []
    line_profile: List[float] = []
    buffer_profile: List[float] = []

    for s, frac, lat, lon, dem in zip(d_chain, fracs, lat_list, lon_list, elevs):
        line_h = alt_tx + (alt_rx - alt_tx) * frac
        bulge = _earth_bulge_m(s, total_m, k_factor)
        eff_ground = dem + bulge
        obs_h = _nearest_obstacle_height_m(lat, lon, dem, obstacles)
        top_eff = eff_ground + obs_h

        d1 = s
        d2 = total_m - s
        if d1 <= 0 or d2 <= 0:
            r1 = 0.0
        else:
            r1 = math.sqrt(wavelength * d1 * d2 / (d1 + d2))

        clearance = line_h - top_eff
        fresnel_pct = (clearance / r1) if r1 > 0 else float("inf")

        min_clearance = min(min_clearance, clearance)
        if math.isfinite(fresnel_pct):
            min_fresnel_pct = min(min_fresnel_pct, fresnel_pct)
        max_obstacle_top = max(max_obstacle_top, dem + obs_h)

        if r1 > 0 and clearance < fresnel_clearance_threshold * r1:
            clear_all = False
        if r1 == 0 and clearance < 0:
            clear_all = False

        obstruction_profile.append(top_eff)
        line_profile.append(line_h)
        buffer_profile.append(line_h - fresnel_clearance_threshold * r1)

    los_ok = clear_all
    if not math.isfinite(min_fresnel_pct):
        min_fresnel_pct = 0.0

    img_b64: str | None = None
    if include_plot:
        try:
            import matplotlib.pyplot as plt  # type: ignore

            fig, ax = plt.subplots(figsize=(8, 3))
            xs_km = [d / 1000.0 for d in d_chain]
            ax.plot(xs_km, obstruction_profile, label="Terrain+obs (eff)", color="#555")
            ax.plot(xs_km, line_profile, label="LOS line", color="#0a7")
            ax.plot(xs_km, buffer_profile, label="Fresnel threshold", linestyle="--", color="#a30")
            ax.set_xlabel("Distance (km)")
            ax.set_ylabel("Elevation (m, effective)")
            ax.grid(True, alpha=0.3)
            ax.legend(loc="best", fontsize=8)
            buf = io.BytesIO()
            fig.tight_layout()
            fig.savefig(buf, format="png", dpi=150)
            plt.close(fig)
            img_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        except Exception:  # pragma: no cover - optional
            img_b64 = None

    return AnalysisResult(
        los=los_ok,
        min_clearance_m=float(round(min_clearance, 3)),
        fresnel_percent=float(round(min_fresnel_pct, 3)),
        max_obstacle_height_m=float(round(max_obstacle_top, 3)),
        distance_km=float(round(distance_km, 3)),
        profile_plot=img_b64,
    )

