const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
    setCookie,
    clearCookie,
    setAuthCookies: setSharedAuthCookies,
    clearAuthCookies,
} = require('../utils/cookieHelper');
const toPublicAuthUser = require('../utils/toPublicAuthUser');
const { buildFrontendUrl, normalizeFrontendUrl } = require('../utils/frontendUrl');

const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    // For localhost:
    API_BASE_URL = 'http://localhost:8080',
    FRONTEND_URL = 'http://localhost:3000',
    JWT_SECRET,

    // profile completion (optional)
    REQUIRE_PROFILE_COMPLETION = 'false',
    TEMP_COOKIE_NAME = 'mbh_tmp',
    TEMP_COOKIE_TTL_SEC = 15 * 60,
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !API_BASE_URL || !FRONTEND_URL || !JWT_SECRET) {
    throw new Error('Missing env: GOOGLE_CLIENT_ID/SECRET, API_BASE_URL, FRONTEND_URL, JWT_SECRET');
}

const oauth = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    `${API_BASE_URL}/api/auth/google/callback`
);
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;
const TEMP_PROFILE_TTL_SEC = Math.max(60, Number(TEMP_COOKIE_TTL_SEC) || 900);
const TEMP_PROFILE_TTL_MS = TEMP_PROFILE_TTL_SEC * 1000;
const frontendEnv = () => ({ ...process.env, FRONTEND_URL });
const frontendUrl = (path = '/') => buildFrontendUrl(path, frontendEnv());

function getServerAssignedOAuthRole(existingUser) {
    if (!existingUser) return 'customer';

    if (['admin', 'business_owner', 'customer'].includes(existingUser.role)) {
        return existingUser.role;
    }

    return 'customer';
}

function mintSessionJWT(user) {
    // session token — 7 days (matches standard login / OTP verify)
    return jwt.sign(
        {
            sub: user._id.toString(),
            role: user.role,
            sessionVersion: user.sessionVersion || 0,
        },
        JWT_SECRET,
        { expiresIn: SESSION_TTL_SEC }
    );
}

function setAuthCookies(res, user, sessionJwt, ttlSeconds = SESSION_TTL_SEC) {
    setSharedAuthCookies(res, sessionJwt, user, ttlSeconds * 1000);
}

/**
 * GET /api/auth/google
 * q: redirect=<absolute URL to send user back to>
 */
exports.startGoogleAuth = (req, res) => {
    const redirect = normalizeFrontendUrl((req.query.redirect || FRONTEND_URL).toString(), frontendEnv());
    const state = Buffer.from(JSON.stringify({ redirect })).toString('base64');

    const url = oauth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['openid', 'email', 'profile'],
        state,
    });

    return res.redirect(url);
};

/**
 * GET /api/auth/google/callback
 * Verify, upsert user, set cookies with same flags as login, redirect back
 */
exports.handleGoogleCallback = async (req, res) => {
    try {
        const code = String(req.query.code || '');
        const rawState = String(req.query.state || '');
        const { redirect } = JSON.parse(Buffer.from(rawState, 'base64').toString());

        const { tokens } = await oauth.getToken(code);
        const idToken = tokens.id_token;
        if (!idToken) return res.redirect(frontendUrl('/?error=no_id_token'));

        const ticket = await oauth.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        if (!payload?.email) return res.redirect(frontendUrl('/?error=no_email_from_google'));

        const googleId = payload.sub;
        const email = payload.email.toLowerCase();
        const name = payload.name || email.split('@')[0];
        const profileImage = payload.picture;

        // upsert by google id or email
        let user = await User.findOne({ $or: [{ provider: 'google', providerId: googleId }, { email }] });
        const assignedRole = getServerAssignedOAuthRole(user);

        if (!user) {
            user = await User.create({
                name,
                email,
                profileImage,
                role: assignedRole,
                provider: 'google',
                providerId: googleId,
                isOtpVerified: true,
            });
        } else {
            user.provider = 'google';
            user.providerId = googleId;
            if (!user.profileImage && profileImage) user.profileImage = profileImage;
            await user.save();
        }

        if (user.isBlocked || user.isDeleted) {
            return res.redirect(frontendUrl('/?error=account_restricted'));
        }

        // (optional) if you must collect mobile/minorityType first
        const mustComplete =
            String(REQUIRE_PROFILE_COMPLETION).toLowerCase() === 'true' &&
            (!user.mobile || !user.minorityType);

        if (mustComplete) {
            const tmp = jwt.sign(
                { sub: user._id.toString(), email: user.email, role: user.role },
                JWT_SECRET,
                { expiresIn: TEMP_PROFILE_TTL_SEC }
            );
            setCookie(res, TEMP_COOKIE_NAME, tmp, {
                httpOnly: true,
                maxAge: TEMP_PROFILE_TTL_MS,
            });
            return res.redirect(frontendUrl('/complete-profile'));
        }

        // set the three cookies the same way as your login route
        const session = mintSessionJWT(user);
        setAuthCookies(res, user, session);

        return res.redirect(redirect || frontendUrl('/'));
    } catch (err) {
        console.error('Google OAuth callback error:', err);
        return res.redirect(frontendUrl('/?error=google_login_failed'));
    }
};

/**
 * POST /api/auth/google/complete
 * Body: { mobile: string, minorityType?: string }
 * Finalize profile, then set cookies (same flags as login)
 */
exports.completeGoogleProfile = async (req, res) => {
    try {
        const tmpToken = req.cookies?.[TEMP_COOKIE_NAME];
        if (!tmpToken) {
            return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
        }

        let decoded;
        try {
            decoded = jwt.verify(tmpToken, JWT_SECRET);
        } catch {
            return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
        }

        const { mobile, minorityType } = req.body || {};
        if (!mobile || !String(mobile).trim()) {
            return res.status(400).json({ success: false, message: 'Mobile number is required.' });
        }

        const user = await User.findById(decoded.sub);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        if (!user.mobile) user.mobile = String(mobile).trim();
        if (minorityType && !user.minorityType) user.minorityType = minorityType;
        await user.save();

        clearCookie(res, TEMP_COOKIE_NAME);

        const session = mintSessionJWT(user);
        setAuthCookies(res, user, session);

        res.json({
            success: true,
            user: toPublicAuthUser(user),
        });
    } catch (err) {
        console.error('Complete profile error:', err);
        res.status(500).json({ success: false, message: 'Unable to complete profile' });
    }
};

/** Optional: logout - clears all three cookies + temp */
exports.logout = async (_req, res) => {
    clearAuthCookies(res);
    clearCookie(res, TEMP_COOKIE_NAME);
    res.json({ success: true });
};
