import math

from backend.services import evaluate_basic_los, haversine, horizon_distance, is_los


def test_haversine_one_degree_longitude_at_equator():
    # 0,0 to 0,1 degree should be about 111.319 km for R=6378.137 km
    d = haversine(0.0, 0.0, 0.0, 1.0)
    assert math.isclose(d, 111.319, rel_tol=0, abs_tol=0.2)


def test_horizon_distance_monotonic():
    assert horizon_distance(0.0) == 0.0
    assert horizon_distance(10.0) < horizon_distance(100.0)


def test_is_los_threshold():
    # Pick two identical towers; LOS true just below combined horizon, false just above
    h = 50.0  # meters
    k = 4.0 / 3.0
    dh = horizon_distance(h, k_factor=k) * 2
    assert is_los(dh - 0.001, h, h, k_factor=k) is True
    assert is_los(dh + 0.001, h, h, k_factor=k) is False


def test_evaluate_basic_los_fresnel_blocked():
    result = evaluate_basic_los(
        dist_km=10.0,
        h1_m=5.0,
        h2_m=5.0,
        frequency_hz=5.8e9,
        fresnel_clearance_ratio=0.6,
    )
    assert result.los is False
    assert result.fresnel_ratio is not None
    assert result.fresnel_ratio < 0.6


def test_evaluate_basic_los_passes_with_taller_masts():
    result = evaluate_basic_los(
        dist_km=10.0,
        h1_m=60.0,
        h2_m=60.0,
        frequency_hz=5.8e9,
        fresnel_clearance_ratio=0.6,
    )
    assert result.los is True
    assert result.midpoint_clearance_m > 0.0
