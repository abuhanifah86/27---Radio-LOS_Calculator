import math
from dataclasses import dataclass
from typing import Final, Optional

# WGS84-equatorial radius in km
R_EARTH: Final[float] = 6378.137
C_LIGHT_M_PER_S: Final[float] = 299_792_458.0


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute great‑circle distance in kilometers.

    Uses the haversine formula on a spherical Earth with radius ``R_EARTH``.
    """
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R_EARTH * c


def horizon_distance(height_m: float, k_factor: float = 1.0) -> float:
    """Geometric radio horizon distance in km for an antenna height (meters).

    ``k_factor`` scales the Earth radius to approximate refraction (typical 4/3).
    """
    effective_radius_km = R_EARTH * max(k_factor, 1e-9)
    return math.sqrt(2 * effective_radius_km * (height_m / 1000.0))


def _earth_bulge_midpoint(distance_m: float, k_factor: float) -> float:
    """Earth curvature bulge (m) at the midpoint of a chord of length distance_m."""
    effective_radius_m = (R_EARTH * 1000.0) * max(k_factor, 1e-9)
    if distance_m <= 0.0:
        return 0.0
    return (distance_m ** 2) / (8.0 * effective_radius_m)


def _fresnel_radius_mid(distance_m: float, frequency_hz: float) -> float:
    """Radius (m) of the first Fresnel zone at the path midpoint."""
    if distance_m <= 0.0 or frequency_hz <= 0.0:
        return 0.0
    wavelength = C_LIGHT_M_PER_S / frequency_hz
    return math.sqrt(wavelength * distance_m / 4.0)


@dataclass
class BasicLosResult:
    los: bool
    horizon_limit_km: float
    meets_horizon: bool
    midpoint_clearance_m: float
    earth_bulge_m: float
    fresnel_radius_m: Optional[float]
    fresnel_ratio: Optional[float]


def evaluate_basic_los(
    *,
    dist_km: float,
    h1_m: float,
    h2_m: float,
    k_factor: float = 4.0 / 3.0,
    frequency_hz: Optional[float] = None,
    fresnel_clearance_ratio: float = 0.6,
) -> BasicLosResult:
    """Evaluate bare-earth LOS with k-factor and Fresnel clearance checks."""
    horizon_sum = horizon_distance(h1_m, k_factor) + horizon_distance(h2_m, k_factor)
    meets_horizon = dist_km <= horizon_sum

    distance_m = dist_km * 1000.0
    bulge_mid = _earth_bulge_midpoint(distance_m, k_factor)
    line_mid_height = h1_m + (h2_m - h1_m) * 0.5
    midpoint_clearance = line_mid_height - bulge_mid

    fresnel_radius = None
    fresnel_ratio = None
    meets_fresnel = True
    if frequency_hz is not None and frequency_hz > 0.0:
        fresnel_radius = _fresnel_radius_mid(distance_m, frequency_hz)
        if fresnel_radius > 0.0:
            fresnel_ratio = midpoint_clearance / fresnel_radius
            meets_fresnel = fresnel_ratio >= fresnel_clearance_ratio
        else:
            meets_fresnel = midpoint_clearance >= 0.0
    else:
        # When no frequency provided, only ensure physical clearance above curvature
        meets_fresnel = midpoint_clearance >= 0.0

    los = meets_horizon and meets_fresnel and midpoint_clearance >= 0.0

    return BasicLosResult(
        los=los,
        horizon_limit_km=horizon_sum,
        meets_horizon=meets_horizon,
        midpoint_clearance_m=midpoint_clearance,
        earth_bulge_m=bulge_mid,
        fresnel_radius_m=fresnel_radius,
        fresnel_ratio=fresnel_ratio,
    )


def is_los(
    dist_km: float,
    h1_m: float = 0.0,
    h2_m: float = 0.0,
    *,
    k_factor: float = 4.0 / 3.0,
    frequency_hz: Optional[float] = None,
    fresnel_clearance_ratio: float = 0.6,
) -> bool:
    """Return True if line‑of‑sight is plausible with bare‑earth horizon.

    Applies Earth curvature adjustment via ``k_factor`` and requires sufficient
    clearance of the first Fresnel zone when ``frequency_hz`` is specified.
    """
    result = evaluate_basic_los(
        dist_km=dist_km,
        h1_m=h1_m,
        h2_m=h2_m,
        k_factor=k_factor,
        frequency_hz=frequency_hz,
        fresnel_clearance_ratio=fresnel_clearance_ratio,
    )
    return result.los
