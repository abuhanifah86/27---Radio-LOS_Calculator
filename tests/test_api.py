from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)


def test_health_endpoint():
    r = client.get("/")
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "ok"


def test_distance_endpoint_basic():
    payload = {
        "pointA": {"lat": 0.0, "lon": 0.0, "height": 0.0},
        "pointB": {"lat": 0.0, "lon": 1.0, "height": 0.0},
    }
    r = client.post("/distance", json=payload)
    assert r.status_code == 200
    data = r.json()
    # Expect approx 111.319 km with 3-decimal rounding
    assert abs(data["distance_km"] - 111.319) < 0.5
    assert data["los"] in (True, False)
    assert isinstance(data["recommendation"], str)
    assert "horizon_limit_km" in data
    assert "midpoint_clearance_m" in data
    assert "fresnel_radius_m" in data
    assert "fresnel_ratio" in data
