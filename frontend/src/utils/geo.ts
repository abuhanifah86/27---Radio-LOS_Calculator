import mgrsLib from 'mgrs';
// @ts-ignore vendored library without types
import { OpenLocationCode } from '../vendor/openlocationcode-wrapper';

export type Coordinate = { lat: number; lon: number };

const latFirstLetters = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q'];
const latSecondLetters = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S','T','U','V','W','X','Y','Z'];
const keypadOffsets: Record<number, [number, number]> = { 1: [0,2],2:[1,2],3:[2,2],4:[0,1],5:[1,1],6:[2,1],7:[0,0],8:[1,0],9:[2,0] };
const quadrantOffsets: Record<number, [number, number]> = { 1: [0,1],2:[1,1],3:[1,0],4:[0,0] };

export function parseDms(input: string, isLat: boolean): number {
  if (!input?.trim()) throw new Error(`Specify ${isLat ? 'latitude' : 'longitude'} in DMS.`);
  const value = input.trim();
  const match = value.match(/(-?\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)?\D*(\d+(?:\.\d+)?)?\s*([NSEW])?/i);
  if (!match) throw new Error('Unable to read DMS components. Example: 6°12\'30" S');
  const deg = parseFloat(match[1]);
  const min = parseFloat(match[2] ?? '0');
  const sec = parseFloat(match[3] ?? '0');
  const dir = match[4]?.toUpperCase();
  let sign = 1;
  if (dir === 'S' || dir === 'W') sign = -1;
  if (deg < 0) sign = -1;
  const decimal = sign * (Math.abs(deg) + min / 60 + sec / 3600);
  if (isLat && Math.abs(decimal) > 90) throw new Error('Latitude must be between -90 and 90.');
  if (!isLat && Math.abs(decimal) > 180) throw new Error('Longitude must be between -180 and 180.');
  return decimal;
}

export function parseDdm(input: string, isLat: boolean): number {
  if (!input?.trim()) throw new Error(`Specify ${isLat ? 'latitude' : 'longitude'} in DDM.`);
  const match = input.trim().match(/(-?\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\s*([NSEW])?/i);
  if (!match) throw new Error('Use format like 6°12.5\' S');
  const deg = parseFloat(match[1]);
  const min = parseFloat(match[2]);
  const dir = match[3]?.toUpperCase();
  let sign = 1;
  if (dir === 'S' || dir === 'W') sign = -1;
  if (deg < 0) sign = -1;
  const decimal = sign * (Math.abs(deg) + min / 60);
  if (isLat && Math.abs(decimal) > 90) throw new Error('Latitude must be between -90 and 90.');
  if (!isLat && Math.abs(decimal) > 180) throw new Error('Longitude must be between -180 and 180.');
  return decimal;
}

export function utmToLatLon(zoneNumber: number, easting: number, northing: number, hemisphere: 'N' | 'S'): Coordinate {
  const a = 6378137;
  const e = 0.081819191;
  const e1sq = 0.006739497;
  const k0 = 0.9996;

  if (!zoneNumber || zoneNumber < 1 || zoneNumber > 60) throw new Error('UTM zone must be 1–60.');
  if (!easting || !northing) throw new Error('Provide UTM easting and northing.');

  let x = easting - 500000;
  let y = northing;
  if (hemisphere === 'S') y -= 10000000;

  const m = y / k0;
  const mu = m / (a * (1 - (e * e) / 4 - (3 * e ** 4) / 64 - (5 * e ** 6) / 256));
  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));

  const j1 = (3 * e1) / 2 - (27 * e1 ** 3) / 32;
  const j2 = (21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32;
  const j3 = (151 * e1 ** 3) / 96;
  const j4 = (1097 * e1 ** 4) / 512;

  const fp = mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu) + j4 * Math.sin(8 * mu);

  const sinfp = Math.sin(fp);
  const cosfp = Math.cos(fp);
  const tanfp = Math.tan(fp);

  const c1 = e1sq * cosfp * cosfp;
  const t1 = tanfp * tanfp;
  const n1 = a / Math.sqrt(1 - e * e * sinfp * sinfp);
  const r1 = (n1 * (1 - e * e)) / (1 - e * e * sinfp * sinfp);
  const d = x / (n1 * k0);

  const q1 = (n1 * tanfp) / r1;
  const q2 = (d * d) / 2;
  const q3 = ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * e1sq) * Math.pow(d, 4)) / 24;
  const q4 = ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * e1sq - 3 * c1 * c1) * Math.pow(d, 6)) / 720;
  const lat = fp - q1 * (q2 - q3 + q4);

  const q5 = d;
  const q6 = ((1 + 2 * t1 + c1) * Math.pow(d, 3)) / 6;
  const q7 = ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * e1sq + 24 * t1 * t1) * Math.pow(d, 5)) / 120;
  const lon = (q5 - q6 + q7) / cosfp;

  const lonOrigin = (zoneNumber - 1) * 6 - 180 + 3;
  return { lat: (lat * 180) / Math.PI, lon: lonOrigin + (lon * 180) / Math.PI };
}

export function decodeGeohash(hash: string): Coordinate {
  if (!hash?.trim()) throw new Error('Enter a geohash value.');
  const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let evenBit = true;
  const lat = [-90, 90];
  const lon = [-180, 180];
  for (const char of hash.trim().toLowerCase()) {
    const idx = base32.indexOf(char);
    if (idx === -1) throw new Error('Invalid geohash character detected.');
    for (let mask = 16; mask >= 1; mask >>= 1) {
      const bit = idx & mask;
      if (evenBit) lon[bit ? 0 : 1] = (lon[0] + lon[1]) / 2;
      else lat[bit ? 0 : 1] = (lat[0] + lat[1]) / 2;
      evenBit = !evenBit;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 };
}

export function decodeMGRS(value: string): Coordinate {
  if (!value?.trim()) throw new Error('Enter an MGRS string.');
  const point = mgrsLib.toPoint(value.trim());
  if (!point || point.length !== 2) throw new Error('Unable to decode MGRS value.');
  return { lon: point[0], lat: point[1] };
}

export function decodeGars(value: string): Coordinate {
  if (!value?.trim()) throw new Error('Enter a GARS code (e.g., 006AG39).');
  const core = value.trim().toUpperCase().replace(/\s+/g, '');
  const lonBand = parseInt(core.slice(0, 3), 10);
  const latLetters = core.slice(3, 5);
  if (!lonBand || lonBand < 1 || lonBand > 720) throw new Error('GARS longitude band must be 001-720.');
  if (latLetters.length !== 2) throw new Error('GARS latitude letters are missing.');
  const firstIdx = latFirstLetters.indexOf(latLetters[0]);
  const secondIdx = latSecondLetters.indexOf(latLetters[1]);
  if (firstIdx === -1 || secondIdx === -1) throw new Error('Invalid GARS latitude letters.');

  const baseLon = -180 + (lonBand - 1) * 0.5;
  const baseLat = -90 + (firstIdx * latSecondLetters.length + secondIdx) * 0.5;

  const quadrant = core.length >= 6 ? parseInt(core[5], 10) : undefined;
  const keypad = core.length >= 7 ? parseInt(core[6], 10) : undefined;

  let cellWidth = 0.5;
  let cellHeight = 0.5;
  let lon = baseLon;
  let lat = baseLat;

  if (quadrant && quadrantOffsets[quadrant]) {
    cellWidth /= 2;
    cellHeight /= 2;
    const [qx, qy] = quadrantOffsets[quadrant];
    lon += qx * cellWidth;
    lat += qy * cellHeight;
  }

  if (keypad && keypadOffsets[keypad]) {
    cellWidth /= 3;
    cellHeight /= 3;
    const [kx, ky] = keypadOffsets[keypad];
    lon += kx * cellWidth;
    lat += ky * cellHeight;
  }

  return { lat: lat + cellHeight / 2, lon: lon + cellWidth / 2 };
}

export function decodePlusCode(code: string): Coordinate {
  if (!code?.trim()) throw new Error('Enter a Plus Code / Open Location Code.');
  const olc = new OpenLocationCode(code.trim());
  const area = olc.decode();
  return { lat: area.latitudeCenter, lon: area.longitudeCenter };
}
