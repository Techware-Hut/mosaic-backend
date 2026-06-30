const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const {
    sendOtpEmail,
    sendWelcomeEmail,
    sendPasswordResetOtpEmail,
} = require('../utils/mailer');
const {
    getCookieOptions,
    clearCookie,
    setAuthCookies,
    clearAuthCookies,
} = require('../utils/cookieHelper');
const toPublicAuthUser = require('../utils/toPublicAuthUser');

function getSafePublicRole(role) {
    return role === 'business_owner' ? 'business_owner' : 'customer';
}

function buildSessionToken(user) {
    return jwt.sign(
        {
            sub: user._id.toString(),
            role: user.role,
            sessionVersion: user.sessionVersion || 0,
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

const FORGOT_PASSWORD_RESPONSE = {
    success: true,
    message: 'If an account with that email exists, a password reset OTP will be sent.',
};
const RESET_PASSWORD_MAX_OTP_ATTEMPTS = 5;

function buildDuplicateRegistrationResponse(existingUser, requestedRole) {
    if (existingUser.role === 'customer' && requestedRole === 'business_owner') {
        return {
            status: 409,
            body: {
                success: false,
                code: 'EXISTING_CUSTOMER',
                message:
                    'An account with this email or mobile already exists. Log in to continue vendor setup.',
            },
        };
    }

    if (existingUser.role === 'business_owner') {
        return {
            status: 409,
            body: {
                success: false,
                code: 'EXISTING_VENDOR',
                message:
                    'A vendor account with this email or mobile already exists. Log in to continue onboarding.',
            },
        };
    }

    return {
        status: 409,
        body: {
            success: false,
            code: 'USER_EXISTS',
            message: 'User already exists with email or mobile',
        },
    };
}

function isDuplicateKeyError(err) {
    return err && (err.code === 11000 || err.code === '11000');
}

const OTP_DELIVERY_FAILED_MESSAGES = {
    register:
        'Your account was created, but we could not deliver the verification email. Please try resending the verification code later.',
    resend:
        'We could not deliver the verification email. Please try again later.',
    unverifiedLogin:
        'Your account still needs verification, but we could not send the verification email. Please try again later.',
};

function respondOtpDeliveryFailed(res, context, { user } = {}) {
    const body = {
        success: false,
        code: 'OTP_DELIVERY_FAILED',
        message: OTP_DELIVERY_FAILED_MESSAGES[context],
        otpPending: true,
    };

    if (user) {
        body.user = {
            email: user.email,
            role: user.role,
        };
    }

    if (context === 'register') {
        body.accountCreated = true;
        res.cookie('otpPending', 'true', getCookieOptions(10 * 60 * 1000));
    }

    return res.status(502).json(body);
}

function logOtpDeliveryFailure(context, emailError) {
    const reason = emailError && emailError.code
        ? `code=${String(emailError.code)}`
        : 'delivery_failed';
    console.error(`Auth OTP email delivery failed (${context}):`, reason);
}

exports.registerUser = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
        const { name, email, password, role, mobile, gender, minorityType } = req.body;
        const safeRole = getSafePublicRole(role);

        const existingUser = await User.findOne({ $or: [{ email }, { mobile }] });
        if (existingUser) {
            const duplicate = buildDuplicateRegistrationResponse(existingUser, safeRole);
            return res.status(duplicate.status).json(duplicate.body);
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await bcrypt.hash(otp, 10);
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

        const newUser = new User({
            name,
            email,
            passwordHash,
            mobile,
            role: safeRole,
            gender,
            minorityType,
            otp: otpHash,
            otpExpiry,
            isOtpVerified: false,
        });

        await newUser.save();

        try {
            await sendOtpEmail(email, otp, 'register');
        } catch (emailError) {
            logOtpDeliveryFailure('register', emailError);
            return respondOtpDeliveryFailed(res, 'register', {
                user: { email, role: safeRole },
            });
        }

        res.cookie('otpPending', 'true', getCookieOptions(10 * 60 * 1000));

        return res.status(201).json({
            success: true,
            message: 'User registered successfully. OTP sent to email.',
        });
    } catch (err) {
        console.error('Registration error:', err);
        if (isDuplicateKeyError(err)) {
            return res.status(409).json({
                success: false,
                code: 'DUPLICATE_KEY',
                message: 'User already exists with email or mobile',
            });
        }
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.verifyOtp = async (req, res) => {
    const { email, otp } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user || !user.otp || !user.otpExpiry) {
            return res.status(400).json({
                success: false,
                message: 'OTP not generated or user not found',
            });
        }

        if (user.isDeleted) {
            return res.status(403).json({ success: false, message: 'Account has been deleted' });
        }

        if (user.isBlocked) {
            return res.status(403).json({ success: false, message: 'Account is blocked by admin' });
        }

        if (user.otpExpiry < Date.now()) {
            return res.status(400).json({ success: false, message: 'OTP has expired' });
        }

        const isValid = await bcrypt.compare(otp, user.otp);
        if (!isValid) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }

        user.isOtpVerified = true;
        user.otp = undefined;
        user.otpExpiry = undefined;
        await user.save();

        try {
            const firstName = user.name.split(' ')[0];
            await sendWelcomeEmail(user.email, firstName, user.role);
        } catch (emailError) {
            console.error('Failed to send welcome email:', emailError);
        }

        const token = buildSessionToken(user);

        setAuthCookies(res, token, user, 7 * 24 * 60 * 60 * 1000);
        clearCookie(res, 'otpPending');

        return res.status(200).json({
            success: true,
            message: 'OTP verified and login successful',
            token,
            user: toPublicAuthUser(user),
        });
    } catch (err) {
        console.error('OTP verify error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.resendOtp = async (req, res) => {
    const { email } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (user.isDeleted) {
            return res.status(403).json({ success: false, message: 'Account has been deleted' });
        }

        if (user.isBlocked) {
            return res.status(403).json({ success: false, message: 'Account is blocked by admin' });
        }

        if (user.isOtpVerified) {
            return res.status(400).json({ success: false, message: 'User already verified' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await bcrypt.hash(otp, 10);
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

        user.otp = otpHash;
        user.otpExpiry = otpExpiry;
        await user.save();

        try {
            await sendOtpEmail(user.email, otp, 'resend');
        } catch (emailError) {
            logOtpDeliveryFailure('resend', emailError);
            return respondOtpDeliveryFailed(res, 'resend', { user });
        }

        res.cookie('otpPending', 'true', getCookieOptions(10 * 60 * 1000));

        return res.status(200).json({
            success: true,
            message: 'OTP resent successfully.',
        });
    } catch (err) {
        console.error('Resend OTP error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.forgotPassword = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email } = req.body;

    try {
        const user = await User.findOne({ email });

        if (!user || user.isDeleted || user.isBlocked || !user.passwordHash) {
            return res.status(200).json(FORGOT_PASSWORD_RESPONSE);
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await bcrypt.hash(otp, 10);
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

        user.resetPasswordOtp = otpHash;
        user.resetPasswordOtpExpiry = otpExpiry;
        user.resetPasswordOtpAttempts = 0;
        await user.save();

        try {
            await sendPasswordResetOtpEmail(user.email, otp);
        } catch (emailError) {
            logOtpDeliveryFailure('passwordReset', emailError);
            return res.status(200).json(FORGOT_PASSWORD_RESPONSE);
        }

        return res.status(200).json(FORGOT_PASSWORD_RESPONSE);
    } catch (err) {
        console.error('Forgot password error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.resetPassword = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, otp, newPassword } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user || !user.resetPasswordOtp || !user.resetPasswordOtpExpiry) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset request',
            });
        }

        if (user.isDeleted) {
            return res.status(403).json({ success: false, message: 'Account has been deleted' });
        }

        if (user.isBlocked) {
            return res.status(403).json({ success: false, message: 'Account is blocked by admin' });
        }

        if (user.resetPasswordOtpExpiry < Date.now()) {
            user.resetPasswordOtp = undefined;
            user.resetPasswordOtpExpiry = undefined;
            user.resetPasswordOtpAttempts = 0;
            await user.save();

            return res.status(400).json({ success: false, message: 'Reset OTP has expired' });
        }

        const isValidOtp = await bcrypt.compare(otp, user.resetPasswordOtp);
        if (!isValidOtp) {
            user.resetPasswordOtpAttempts = (user.resetPasswordOtpAttempts || 0) + 1;

            if (user.resetPasswordOtpAttempts >= RESET_PASSWORD_MAX_OTP_ATTEMPTS) {
                user.resetPasswordOtp = undefined;
                user.resetPasswordOtpExpiry = undefined;
                user.resetPasswordOtpAttempts = 0;
                await user.save();

                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired reset request',
                });
            }

            await user.save();

            return res.status(400).json({ success: false, message: 'Invalid reset OTP' });
        }

        user.passwordHash = await bcrypt.hash(newPassword, 12);
        user.resetPasswordOtp = undefined;
        user.resetPasswordOtpExpiry = undefined;
        user.resetPasswordOtpAttempts = 0;
        user.sessionVersion = (user.sessionVersion || 0) + 1;
        await user.save();

        return res.status(200).json({
            success: true,
            message: 'Password reset successful',
        });
    } catch (err) {
        console.error('Reset password error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.loginUser = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user || !user.passwordHash) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (user.isDeleted) {
            return res.status(403).json({ success: false, message: 'Account has been deleted' });
        }

        if (user.isBlocked) {
            return res.status(403).json({ success: false, message: 'Account is blocked by admin' });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (!user.isOtpVerified) {
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const otpHash = await bcrypt.hash(otp, 10);
            const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

            user.otp = otpHash;
            user.otpExpiry = otpExpiry;
            await user.save();

            try {
                await sendOtpEmail(user.email, otp, 'unverifiedLogin');
            } catch (emailError) {
                logOtpDeliveryFailure('unverifiedLogin', emailError);
                return respondOtpDeliveryFailed(res, 'unverifiedLogin', { user });
            }

            res.cookie('otpPending', 'true', getCookieOptions(10 * 60 * 1000));

            return res.status(403).json({
                success: false,
                otpPending: true,
                message: 'OTP not verified. A new OTP has been sent.',
                user: {
                    email: user.email,
                    role: user.role,
                },
            });
        }

        const token = buildSessionToken(user);

        setAuthCookies(res, token, user, 7 * 24 * 60 * 60 * 1000);

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            token,
            user: toPublicAuthUser(user),
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.logout = (req, res) => {
    clearAuthCookies(res);
    clearCookie(res, 'otpPending');

    res.status(200).json({ message: 'Logged out successfully' });
};
