const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

function normalizeBusinessTags(input) {
  const rawList = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  const seen = new Set();
  const tags = [];

  for (const item of rawList) {
    const value = String(item ?? '').trim();
    if (!value) continue;

    const clipped = value.slice(0, MAX_TAG_LENGTH);
    const key = clipped.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    tags.push(clipped);
    if (tags.length >= MAX_TAGS) break;
  }

  return tags;
}

module.exports = {
  MAX_TAGS,
  MAX_TAG_LENGTH,
  normalizeBusinessTags,
};
