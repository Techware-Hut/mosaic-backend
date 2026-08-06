/**
 * US state code ↔ full-name matching for vendor directory geo filters.
 * Vendor records may store "VA" or "Virginia"; directory dropdowns send the
 * canonical full name from GET /api/public/locations/states.
 */

const STATE_CODE_TO_NAME = Object.freeze({
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
});

const STATE_NAME_TO_CODE = Object.freeze(
  Object.fromEntries(
    Object.entries(STATE_CODE_TO_NAME).map(([code, name]) => [
      name.toLowerCase(),
      code,
    ])
  )
);

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expandStateMatchValues(input) {
  const trimmed = String(input || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return [];

  const variants = new Set([trimmed]);
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && STATE_CODE_TO_NAME[upper]) {
    variants.add(upper);
    variants.add(STATE_CODE_TO_NAME[upper]);
  }

  const code = STATE_NAME_TO_CODE[trimmed.toLowerCase()];
  if (code) {
    variants.add(code);
    variants.add(STATE_CODE_TO_NAME[code]);
  }

  return [...variants];
}

/**
 * Case-insensitive exact match against full name and/or USPS abbreviation.
 * @returns {RegExp|null}
 */
function buildAddressStateFilter(state) {
  const variants = expandStateMatchValues(state);
  if (!variants.length) return null;

  const pattern = variants.map(escapeRegex).join('|');
  return new RegExp(`^(?:${pattern})$`, 'i');
}

module.exports = {
  STATE_CODE_TO_NAME,
  STATE_NAME_TO_CODE,
  expandStateMatchValues,
  buildAddressStateFilter,
};
