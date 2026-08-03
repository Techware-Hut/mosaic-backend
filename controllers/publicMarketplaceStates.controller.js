/**
 * GET /api/public/locations/states
 *
 * Public contract for the homepage/marketplace "Filter by state" dropdown.
 * Returns unique normalized state labels derived only from approved, active,
 * publicly visible businesses that own at least one eligible public listing.
 * Draft, rejected, inactive, deleted, or hidden records never contribute a
 * value, and states with no eligible public results are absent.
 */
const {
  getPublicMarketplaceStates,
} = require('../lib/listing/publicMarketplaceStates');

exports.getPublicMarketplaceStates = async (req, res) => {
  try {
    const states = await getPublicMarketplaceStates();

    res.set('Cache-Control', 'public, max-age=300');
    return res.json({
      success: true,
      data: states,
    });
  } catch (err) {
    console.error('Error fetching public marketplace states:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};
