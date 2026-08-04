const axios = require('axios');

/**
 * Converts a street address string into GeoJSON coordinates.
 * Returns { lat, lng, formatted_address, place_id }.
 * Throws if the API key is missing or geocoding fails.
 */
async function geocodeAddress(address) {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) throw new Error('Google Geocoding API key missing');

  const encoded = encodeURIComponent(address);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${apiKey}`;

  const res = await axios.get(url);

  if (res.data.status !== 'OK' || !res.data.results.length) {
    throw new Error(`Geocoding failed: ${res.data.status}`);
  }

  const result = res.data.results[0];
  const location = result.geometry?.location;

  if (!location) throw new Error('Could not geocode address');

  return {
    lat: location.lat,
    lng: location.lng,
    formatted_address: result.formatted_address,
    place_id: result.place_id,
  };
}

/**
 * Converts lat/lng coordinates back into a human-readable address.
 * Used for "use my location" UX flows.
 * Returns { formatted_address, city, state, country, zip } or null on failure.
 */
async function reverseGeocode(lat, lng) {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) throw new Error('Google Geocoding API key missing');

  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
  const res = await axios.get(url);

  if (res.data.status !== 'OK' || !res.data.results.length) {
    return null;
  }

  const result = res.data.results[0];
  const components = result.address_components || [];

  const getComponent = (type) =>
    components.find((c) => c.types.includes(type))?.long_name || '';

  return {
    formatted_address: result.formatted_address,
    city: getComponent('locality') || getComponent('administrative_area_level_2'),
    state: getComponent('administrative_area_level_1'),
    country: getComponent('country'),
    zip: getComponent('postal_code'),
  };
}

/**
 * Validates that lat and lng are finite numbers within valid ranges.
 */
function isValidCoordinates(lat, lng) {
  const latN = parseFloat(lat);
  const lngN = parseFloat(lng);
  return (
    Number.isFinite(latN) && Number.isFinite(lngN) &&
    latN >= -90 && latN <= 90 &&
    lngN >= -180 && lngN <= 180
  );
}

/**
 * Safely tries to geocode an address string.
 * Returns { coordinates: [lng, lat], address: formatted_address } on success.
 * Returns null silently on failure — callers must handle null gracefully
 * (geocoding failure must NEVER block a listing save).
 */
async function safeGeocodeAddress(address) {
  if (!address || typeof address !== 'string' || !address.trim()) return null;
  try {
    const result = await geocodeAddress(address.trim());
    return {
      coordinates: [result.lng, result.lat], // GeoJSON order: [lng, lat]
      address: result.formatted_address,
    };
  } catch (_err) {
    // Geo enrichment is best-effort — do not block saves
    return null;
  }
}

module.exports = { geocodeAddress, reverseGeocode, isValidCoordinates, safeGeocodeAddress };

