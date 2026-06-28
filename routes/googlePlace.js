const { default: axios } = require('axios');
const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const GOOGLE_PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function normalizeInput(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function resolveSessionToken(value) {
    const token = normalizeInput(value);
    return SESSION_TOKEN_PATTERN.test(token) ? token : crypto.randomUUID();
}

// Route to get Google Places autocomplete suggestions.
router.post('/', async (req, res) => {
    const input = normalizeInput(req.body?.input);
    const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;

    if (!input) {
        return res.status(400).json({ error: 'Input is required' });
    }

    if (!apiKey) {
        return res.status(503).json({ error: 'Google Places is not configured' });
    }

    try {
        const response = await axios.post(GOOGLE_PLACES_AUTOCOMPLETE_URL, {
            input,
            sessionToken: resolveSessionToken(req.body?.sessionToken),
            includedPrimaryTypes: ['street_address', 'premise'],
            languageCode: 'en',
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
            },
        });

        return res.status(200).json(response.data);
    } catch (error) {
        console.error('Error fetching Google Places API:', error?.message || error);
        return res.status(502).json({ error: 'Failed to fetch from Google Places API' });
    }
});


module.exports = router;
