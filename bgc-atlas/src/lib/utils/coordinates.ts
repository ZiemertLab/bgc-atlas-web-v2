export interface LatLon {
  latitude?: number | null;
  longitude?: number | null;
}

// 0/0 is a valid location.
export function hasCoordinates(s: LatLon): s is { latitude: number; longitude: number } {
  const { latitude: lat, longitude: lon } = s;
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
  );
}

export function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}
