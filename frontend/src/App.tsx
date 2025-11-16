import { useEffect, useMemo, useState } from 'react';
import {
  Coordinate,
  decodeGars,
  decodeGeohash,
  decodeMGRS,
  decodePlusCode,
  parseDdm,
  parseDms,
  utmToLatLon,
} from './utils/geo';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './styles/map.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const bandOptions = [
  { id: 'vhf', label: 'VHF (30-300 MHz)', min: 30, max: 300, defaultMHz: 150 },
  { id: 'uhf', label: 'UHF (300-3000 MHz)', min: 300, max: 3000, defaultMHz: 900 },
  { id: 'shf', label: 'SHF (3-30 GHz)', min: 3000, max: 30000, defaultMHz: 5800 },
  { id: 'ehf', label: 'EHF (>30 GHz)', min: 30000, max: 100000, defaultMHz: 40000 },
] as const;

type BandId = (typeof bandOptions)[number]['id'];

type Site = {
  lat: string;
  lon: string;
  height: string;
};

type LosResponse = {
  distance_km: number;
  los: boolean;
  recommendation: string;
  horizon_limit_km: number;
  midpoint_clearance_m: number;
  fresnel_radius_m?: number | null;
  fresnel_ratio?: number | null;
  ai_summary?: string | null;
};

type ConverterFormat =
  | 'dms'
  | 'ddm'
  | 'utm'
  | 'mgrs'
  | 'gars'
  | 'plus'
  | 'geohash'
  | 'what3words';

type ConvertInputs = {
  dmsLat: string;
  dmsLon: string;
  ddmLat: string;
  ddmLon: string;
  utmZone: string;
  utmHemisphere: 'N' | 'S';
  utmEasting: string;
  utmNorthing: string;
  mgrs: string;
  gars: string;
  plusCode: string;
  geohash: string;
  what3words: string;
  w3wApiKey: string;
};

const defaultBackend = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function formatNumber(val: number | undefined | null, digits = 3) {
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return Number(val).toFixed(digits);
}

function AiSummary({ text }: { text?: string | null }) {
  if (!text) return null;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const bullets = lines.every((l) => l.startsWith('- ') || l.startsWith('•'));
  if (bullets) {
    return (
      <ul>
        {lines.map((line, idx) => (
          <li key={idx}>{line.replace(/^[-•]\s*/, '')}</li>
        ))}
      </ul>
    );
  }
  return (
    <div>
      {lines.map((line, idx) => (
        <p key={idx} style={{ margin: '6px 0' }}>
          {line}
        </p>
      ))}
    </div>
  );
}

function CoordinateConverter({ onApply }: { onApply: (siteKey: 'a' | 'b', coords: Coordinate) => void }) {
  const [format, setFormat] = useState<ConverterFormat>('dms');
  const [inputs, setInputs] = useState<ConvertInputs>({
    dmsLat: '',
    dmsLon: '',
    ddmLat: '',
    ddmLon: '',
    utmZone: '',
    utmHemisphere: 'N',
    utmEasting: '',
    utmNorthing: '',
    mgrs: '',
    gars: '',
    plusCode: '',
    geohash: '',
    what3words: '',
    w3wApiKey: '',
  });
  const [result, setResult] = useState<Coordinate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleChange = (key: keyof ConvertInputs, value: string) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleConvert = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let coords: Coordinate;
      switch (format) {
        case 'dms':
          coords = { lat: parseDms(inputs.dmsLat, true), lon: parseDms(inputs.dmsLon, false) };
          break;
        case 'ddm':
          coords = { lat: parseDdm(inputs.ddmLat, true), lon: parseDdm(inputs.ddmLon, false) };
          break;
        case 'utm':
          coords = utmToLatLon(
            Number(inputs.utmZone),
            Number(inputs.utmEasting),
            Number(inputs.utmNorthing),
            inputs.utmHemisphere || 'N',
          );
          break;
        case 'mgrs':
          coords = decodeMGRS(inputs.mgrs);
          break;
        case 'gars':
          coords = decodeGars(inputs.gars);
          break;
        case 'plus':
          coords = decodePlusCode(inputs.plusCode);
          break;
        case 'geohash':
          coords = decodeGeohash(inputs.geohash);
          break;
        case 'what3words': {
          if (!inputs.what3words) throw new Error('Enter a What3Words phrase.');
          if (!inputs.w3wApiKey) throw new Error('Add your What3Words API key to convert.');
          const url = `https://api.what3words.com/v3/convert-to-coordinates?words=${encodeURIComponent(inputs.what3words)}&key=${encodeURIComponent(inputs.w3wApiKey)}`;
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('What3Words lookup failed. Check the phrase/API key.');
          const data = await resp.json();
          if (!data?.coordinates) throw new Error('What3Words response missing coordinates.');
          coords = { lat: data.coordinates.lat, lon: data.coordinates.lng };
          break;
        }
        default:
          throw new Error('Select a coordinate format to convert.');
      }
      setResult(coords);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Conversion failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" aria-label="Coordinate converter">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: '4px 0' }}>Coordinate converter</h3>
          <div className="helper">Convert many formats into Decimal Degrees and push them into the site fields.</div>
        </div>
        <div className="badge">Geo tools</div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <div>
          <label title="Select the input coordinate format to convert">Input format</label>
          <select value={format} onChange={(e) => setFormat(e.target.value as ConverterFormat)}>
            <option value="dms">DMS (Degrees, Minutes, Seconds)</option>
            <option value="ddm">DDM (Degrees & decimal minutes)</option>
            <option value="utm">UTM</option>
            <option value="mgrs">MGRS</option>
            <option value="gars">GARS</option>
            <option value="plus">Plus Codes / Open Location Code</option>
            <option value="geohash">Geohash</option>
            <option value="what3words">What3Words</option>
          </select>
        </div>
        <div>
          <label title="Hint: conversions happen in-browser so nothing is sent until you press Calculate">Quick note</label>
          <div className="card" style={{ minHeight: 52 }}>
            {format === 'what3words' ? 'Requires an internet connection and a What3Words API key.' : 'Conversion runs locally in your browser.'}
          </div>
        </div>
      </div>

      {format === 'dms' && (
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div>
            <label title={'Example: 6°12\'30" S'}>Latitude (DMS)</label>
            <input
              value={inputs.dmsLat}
              onChange={(e) => handleChange('dmsLat', e.target.value)}
              placeholder={'6°12\'30" S'}
            />
          </div>
          <div>
            <label title={'Example: 106°49\'0" E'}>Longitude (DMS)</label>
            <input
              value={inputs.dmsLon}
              onChange={(e) => handleChange('dmsLon', e.target.value)}
              placeholder={"106°49'0\" E"}
            />
          </div>
        </div>
      )}

      {format === 'ddm' && (
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div>
            <label title="Example: 6°12.5' S">Latitude (DDM)</label>
            <input value={inputs.ddmLat} onChange={(e) => handleChange('ddmLat', e.target.value)} placeholder={"6°12.500' S"} />
          </div>
          <div>
            <label title="Example: 106°49.0' E">Longitude (DDM)</label>
            <input value={inputs.ddmLon} onChange={(e) => handleChange('ddmLon', e.target.value)} placeholder={"106°49.000' E"} />
          </div>
        </div>
      )}

      {format === 'utm' && (
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div>
            <label title="UTM zone number (1-60)">Zone</label>
            <input value={inputs.utmZone} onChange={(e) => handleChange('utmZone', e.target.value)} placeholder="48" />
          </div>
          <div>
            <label title="UTM hemisphere N or S">Hemisphere</label>
            <select value={inputs.utmHemisphere} onChange={(e) => handleChange('utmHemisphere', e.target.value as 'N' | 'S')}>
              <option value="N">Northern</option>
              <option value="S">Southern</option>
            </select>
          </div>
          <div>
            <label title="UTM Easting in meters">Easting (m)</label>
            <input value={inputs.utmEasting} onChange={(e) => handleChange('utmEasting', e.target.value)} placeholder="321000" />
          </div>
          <div>
            <label title="UTM Northing in meters">Northing (m)</label>
            <input value={inputs.utmNorthing} onChange={(e) => handleChange('utmNorthing', e.target.value)} placeholder="9265000" />
          </div>
        </div>
      )}

      {format === 'mgrs' && (
        <div style={{ marginTop: 12 }}>
          <label title="Military Grid Reference System string">MGRS</label>
          <input value={inputs.mgrs} onChange={(e) => handleChange('mgrs', e.target.value)} placeholder="48M WT 1234 5678" />
        </div>
      )}

      {format === 'gars' && (
        <div style={{ marginTop: 12 }}>
          <label title="Global Area Reference System code">GARS</label>
          <input value={inputs.gars} onChange={(e) => handleChange('gars', e.target.value)} placeholder="006AG39" />
        </div>
      )}

      {format === 'plus' && (
        <div style={{ marginTop: 12 }}>
          <label title="Open Location Code / Plus Code (global code preferred)">Plus Code</label>
          <input value={inputs.plusCode} onChange={(e) => handleChange('plusCode', e.target.value)} placeholder="6PH57VP3+PR" />
        </div>
      )}

      {format === 'geohash' && (
        <div style={{ marginTop: 12 }}>
          <label title="Geohash string">Geohash</label>
          <input value={inputs.geohash} onChange={(e) => handleChange('geohash', e.target.value)} placeholder="qqj3np7" />
        </div>
      )}

      {format === 'what3words' && (
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div>
            <label title="Enter a three word address">What3Words phrase</label>
            <input value={inputs.what3words} onChange={(e) => handleChange('what3words', e.target.value)} placeholder="filled.count.soap" />
          </div>
          <div>
            <label title="API key is required to resolve What3Words">What3Words API key</label>
            <input value={inputs.w3wApiKey} onChange={(e) => handleChange('w3wApiKey', e.target.value)} placeholder="YOUR_API_KEY" />
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 16, alignItems: 'center' }}>
        <button style={{ flex: 1 }} onClick={handleConvert} title="Convert the coordinates to Decimal Degrees" disabled={busy}>
          {busy ? (
            <span>
              <span className="loader" /> Converting...
            </span>
          ) : (
            'Convert to Decimal Degrees'
          )}
        </button>
        {result && (
          <>
            <button className="secondary" style={{ flex: 0.6 }} onClick={() => onApply('a', result)} title="Send these coordinates into Site A fields">
              Apply to Site A
            </button>
            <button className="secondary" style={{ flex: 0.6 }} onClick={() => onApply('b', result)} title="Send these coordinates into Site B fields">
              Apply to Site B
            </button>
          </>
        )}
      </div>

      {error && <div className="alert" role="alert">{error}</div>}
      {result && (
        <div className="success" style={{ marginTop: 10 }}>
          <strong>Decimal Degrees</strong>
          <div className="helper">Lat: {formatNumber(result.lat, 6)}°, Lon: {formatNumber(result.lon, 6)}°</div>
        </div>
      )}
    </div>
  );
}

function SiteForm({ label, values, onChange }: { label: string; values: Site; onChange: (s: Site) => void }) {
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{label}</h3>
        <div className="badge">Endpoint</div>
      </div>
      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <div>
          <label title="Latitude in decimal degrees, negative for south">Latitude (°)</label>
          <input value={values.lat} onChange={(e) => onChange({ ...values, lat: e.target.value })} placeholder="-6.200000" inputMode="decimal" />
        </div>
        <div>
          <label title="Longitude in decimal degrees, negative for west">Longitude (°)</label>
          <input value={values.lon} onChange={(e) => onChange({ ...values, lon: e.target.value })} placeholder="106.816666" inputMode="decimal" />
        </div>
        <div>
          <label title="Antenna height above local ground level in meters">Antenna height (m)</label>
          <input value={values.height} onChange={(e) => onChange({ ...values, height: e.target.value })} placeholder="25" inputMode="decimal" />
        </div>
      </div>
    </div>
  );
}

function pickBandHint(rec: string | undefined) {
  if (!rec) return null;
  const upper = rec.toUpperCase();
  if (upper.includes('VHF')) return { band: 'VHF', range: '30–300 MHz' } as const;
  if (upper.includes('UHF')) return { band: 'UHF', range: '300–3000 MHz' } as const;
  if (upper.includes('SHF')) return { band: 'SHF', range: '3–30 GHz' } as const;
  if (upper.includes('EHF')) return { band: 'EHF', range: '>30 GHz' } as const;
  return null;
}

function parseLatLon(lat: string, lon: string): Coordinate | null {
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if ([latNum, lonNum].some((v) => Number.isNaN(v))) return null;
  if (Math.abs(latNum) > 90 || Math.abs(lonNum) > 180) return null;
  return { lat: latNum, lon: lonNum };
}

function FitBounds({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [12, 12] });
  }, [bounds, map]);
  return null;
}

function SitesMap({ siteA, siteB }: { siteA: Site; siteB: Site }) {
  const coordsA = parseLatLon(siteA.lat, siteA.lon);
  const coordsB = parseLatLon(siteB.lat, siteB.lon);
  const markers = [
    coordsA ? { ...coordsA, label: 'Site A' } : null,
    coordsB ? { ...coordsB, label: 'Site B' } : null,
  ].filter(Boolean) as Array<Coordinate & { label: string }>;

  const center: [number, number] = markers.length ? [markers[0].lat, markers[0].lon] : [0, 0];
  const bounds = markers.length
    ? L.latLngBounds(markers.map((m) => [m.lat, m.lon] as [number, number])).pad(0.5)
    : null;

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Map preview (OpenStreetMap)</h3>
        <div className="badge">Map</div>
      </div>
      {markers.length ? (
        <MapContainer center={center} zoom={13} scrollWheelZoom={false} style={{ height: 320, width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
          {bounds && <FitBounds bounds={bounds} />}
          {markers.map((m) => (
            <Marker key={m.label} position={[m.lat, m.lon]}>
              <Popup>{m.label}</Popup>
            </Marker>
          ))}
        </MapContainer>
      ) : (
        <div className="helper" style={{ marginTop: 8 }}>
          Enter valid decimal coordinates for Site A or B to see them plotted.
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [backendUrl, setBackendUrl] = useState(defaultBackend);
  const [timeoutMs, setTimeoutMs] = useState(8000);
  const [bandChoice, setBandChoice] = useState<BandId>('uhf');
  const [frequencyMHz, setFrequencyMHz] = useState(900);
  const [kFactor, setKFactor] = useState(1.333);
  const [fresnelRatio, setFresnelRatio] = useState(0.6);
  const [siteA, setSiteA] = useState<Site>({ lat: '', lon: '', height: '20' });
  const [siteB, setSiteB] = useState<Site>({ lat: '', lon: '', height: '20' });
  const [result, setResult] = useState<LosResponse | null>(null);
  const [aiText, setAiText] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'calculator' | 'converter' | 'settings'>('calculator');

  const currentBand = useMemo(() => bandOptions.find((b) => b.id === bandChoice), [bandChoice]);
  const frequencyHz = (frequencyMHz || currentBand?.defaultMHz || 1000) * 1e6;

  const handleApplyConversion = (siteKey: 'a' | 'b', coords: Coordinate) => {
    const formatted: Site = {
      lat: formatNumber(coords.lat, 6),
      lon: formatNumber(coords.lon, 6),
      height: siteKey === 'a' ? siteA.height : siteB.height,
    };
    if (siteKey === 'a') setSiteA((prev) => ({ ...prev, ...formatted }));
    if (siteKey === 'b') setSiteB((prev) => ({ ...prev, ...formatted }));
  };

  const handleBandChange = (value: BandId) => {
    setBandChoice(value);
    const band = bandOptions.find((b) => b.id === value);
    if (band) setFrequencyMHz(band.defaultMHz);
  };

  const calculate = async () => {
    setError(null);
    setResult(null);
    setAiText('');
    const payload = {
      pointA: { lat: Number(siteA.lat), lon: Number(siteA.lon), height: Number(siteA.height || 0) },
      pointB: { lat: Number(siteB.lat), lon: Number(siteB.lon), height: Number(siteB.height || 0) },
      frequency_hz: frequencyHz,
      k_factor: Number(kFactor),
      fresnel_clearance_ratio: Number(fresnelRatio),
    };

    if ([payload.pointA.lat, payload.pointA.lon, payload.pointB.lat, payload.pointB.lon].some((v) => Number.isNaN(v))) {
      setError('Please supply valid decimal coordinates for both sites.');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(timeoutMs));
    setLoading(true);
    try {
      const resp = await fetch(`${backendUrl.replace(/\/$/, '')}/distance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`Backend responded with ${resp.status}`);
      const data = (await resp.json()) as LosResponse;
      setResult(data);
      setAiText(data.ai_summary || '');
    } catch (err) {
      if ((err as Error).name === 'AbortError') setError('Request timed out. Increase the timeout or check connectivity.');
      else setError((err as Error).message || 'Calculation failed');
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <header>
        <h1>Radio Point-to-Point LOS Calculator</h1>
        <div className="subhead">LOS & Fresnel analysis and coordinate conversion.</div>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === 'calculator' ? 'active' : ''}`} onClick={() => setTab('calculator')}>
          Calculator
        </button>
        <button className={`tab ${tab === 'converter' ? 'active' : ''}`} onClick={() => setTab('converter')}>
          Geo tools
        </button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
          Settings
        </button>
      </div>

      {tab === 'calculator' && (
        <>
          <div className="panel">
            <div className="grid grid-2">
              <div>
                <label title="Pick the starting radio band; you can still override the exact frequency">Band selector</label>
                <select value={bandChoice} onChange={(e) => handleBandChange(e.target.value as BandId)}>
                  {bandOptions.map((band) => (
                    <option key={band.id} value={band.id}>
                      {band.label}
                    </option>
                  ))}
                </select>
                <div className="helper">The app will still recommend the best band after LOS analysis.</div>
              </div>
              <div>
                <label title="Carrier frequency in MHz used for Fresnel calculations">Frequency (MHz)</label>
                <input value={frequencyMHz} onChange={(e) => setFrequencyMHz(Number(e.target.value))} type="number" min={1} step={10} />
                <div className="helper">Prefilled from the band, but you can override.</div>
              </div>
              <div>
                <label title="Effective Earth radius factor (k)">k-factor (refraction)</label>
                <input value={kFactor} onChange={(e) => setKFactor(Number(e.target.value))} type="number" step={0.05} min={0.5} max={2.0} />
              </div>
              <div>
                <label title="Minimum acceptable clearance vs. first Fresnel radius">Fresnel clearance ratio</label>
                <input value={fresnelRatio} onChange={(e) => setFresnelRatio(Number(e.target.value))} type="number" step={0.05} min={0.1} max={1.5} />
              </div>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <SiteForm label="Site A" values={siteA} onChange={setSiteA} />
            <SiteForm label="Site B" values={siteB} onChange={setSiteB} />
          </div>

          <SitesMap siteA={siteA} siteB={siteB} />

          <div className="panel" style={{ marginTop: 14 }}>
            <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: '4px 0' }}>Run LOS calculation</h3>
                <div className="helper">Checks horizon + Fresnel clearance, then suggests an optimal band/frequency range.</div>
                <div className="helper" style={{ marginTop: 4 }}>
                  Backend: {backendUrl} (edit in Settings) · Timeout: {timeoutMs} ms
                </div>
              </div>
              <button onClick={calculate} title="Send parameters to backend and evaluate" style={{ maxWidth: 220 }} disabled={loading}>
                {loading ? (
                  <span>
                    <span className="loader" /> Calculating...
                  </span>
                ) : (
                  'Calculate'
                )}
              </button>
            </div>

            {error && <div className="alert" role="alert">{error}</div>}

            {result && (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="result-grid">
                  <div className="result-item">
                    <div className="helper">Distance</div>
                    <div>{result.distance_km} km</div>
                  </div>
                  <div className="result-item">
                    <div className="helper">LOS</div>
                    <div className={`status ${result.los ? 'good' : 'bad'}`}>{result.los ? 'Clear' : 'Blocked'}</div>
                  </div>
                  <div className="result-item">
                    <div className="helper">Horizon limit</div>
                    <div>{result.horizon_limit_km} km</div>
                  </div>
                  <div className="result-item">
                    <div className="helper">Midpoint clearance</div>
                    <div>{result.midpoint_clearance_m} m</div>
                  </div>
                  {result.fresnel_radius_m !== null && result.fresnel_radius_m !== undefined && (
                    <div className="result-item">
                      <div className="helper">First Fresnel radius</div>
                      <div>{result.fresnel_radius_m} m</div>
                    </div>
                  )}
                  {result.fresnel_ratio !== null && result.fresnel_ratio !== undefined && (
                    <div className="result-item">
                      <div className="helper">Clearance / Fresnel</div>
                      <div>{result.fresnel_ratio}</div>
                    </div>
                  )}
                </div>
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="helper">Recommended band & range</div>
                  <div style={{ fontWeight: 700 }}>
                    {result.recommendation}
                    {pickBandHint(result.recommendation) && <> · {pickBandHint(result.recommendation)?.range}</>}
                  </div>
                  <div className="helper" style={{ marginTop: 6 }}>
                    You selected {currentBand?.label || 'custom'} at {formatNumber(frequencyMHz, 2)} MHz for this run.
                  </div>
                </div>
                {aiText && (
                  <div className="ai-box" style={{ marginTop: 12 }}>
                    <strong>AI insight</strong>
                    <AiSummary text={aiText} />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'converter' && (
        <div style={{ marginTop: 14 }}>
          <CoordinateConverter onApply={handleApplyConversion} />
        </div>
      )}

      {tab === 'settings' && (
        <div className="panel">
          <div className="grid grid-2">
            <div>
              <label title="Backend FastAPI endpoint">Backend URL</label>
              <input value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} placeholder={defaultBackend} />
            </div>
            <div>
              <label title="HTTP request timeout to the backend">Timeout (ms)</label>
              <input value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} type="number" min={1000} step={500} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
