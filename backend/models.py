from pydantic import BaseModel, Field

class Point(BaseModel):
    lat: float = Field(..., ge=-90, le=90, description="Latitude (decimal degree)")
    lon: float = Field(..., ge=-180, le=180, description="Longitude (decimal degree)")
    height: float = Field(0, ge=0, description="Antenna height above ground (meter)")

class DistanceRequest(BaseModel):
    pointA: Point
    pointB: Point
    frequency_hz: float = Field(5.8e9, gt=0, description="Operating frequency in Hz (used for Fresnel clearance check)")
    k_factor: float = Field(4.0/3.0, gt=0, description="Effective Earth radius factor for curvature compensation")
    fresnel_clearance_ratio: float = Field(0.6, gt=0, le=1, description="Required ratio of clearance to first Fresnel radius")

class DistanceResponse(BaseModel):
    distance_km: float
    los: bool
    recommendation: str
    horizon_limit_km: float
    midpoint_clearance_m: float
    fresnel_radius_m: float | None = None
    fresnel_ratio: float | None = None
    ai_summary: str | None = None


class LosAnalysisRequest(BaseModel):
    tx_lat: float = Field(..., ge=-90, le=90)
    tx_lon: float = Field(..., ge=-180, le=180)
    tx_height_m: float = Field(..., ge=0)
    rx_lat: float = Field(..., ge=-90, le=90)
    rx_lon: float = Field(..., ge=-180, le=180)
    rx_height_m: float = Field(..., ge=0)
    frequency_hz: float = Field(..., gt=0, description="Operating frequency in Hz")
    k_factor: float = Field(4.0/3.0, gt=0, description="Effective earth radius factor")
    dem_path: str = Field(..., description="Path to DEM raster file (e.g., GeoTIFF)")
    obstacle_dataset: str | None = Field(None, description="Path to obstacles dataset (CSV or GeoJSON)")
    fresnel_clearance_threshold: float = Field(0.6, gt=0, le=1)
    sample_step_m: int = Field(50, gt=0, description="Sampling step along path in meters")
    profile_plot: bool = Field(False, description="Include base64-encoded PNG profile plot")


class LosAnalysisResponse(BaseModel):
    los: bool
    min_clearance_m: float
    fresnel_percent: float
    max_obstacle_height_m: float
    distance_km: float
    profile_plot: str | None = None
    ai_summary: str | None = None
