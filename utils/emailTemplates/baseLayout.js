/**
 * utils/emailTemplates/baseLayout.js
 *
 * Shared branded HTML shell for all Mosaic Biz Hub transactional emails.
 * Matches the official Mosaic Biz Hub email design system.
 */

'use strict';

const SUPPORT_EMAIL = 'support@mosaicbizhub.com';
const BRAND_COLOR = '#2563EB';       // Mosaic blue
const BRAND_COLOR_DARK = '#1D4ED8';
const ACCENT_COLOR = '#7C3AED';      // Mosaic purple
const FONT_STACK = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

/**
 * Escape HTML special characters to prevent XSS in email bodies.
 */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Build the full branded email HTML wrapper.
 *
 * @param {object} opts
 * @param {string}  opts.preheader      - Hidden preheader text shown in inbox previews
 * @param {string}  opts.bodyHtml       - Inner HTML content (goes inside the card)
 * @param {string} [opts.footerReason]  - Why the user is receiving this email
 * @param {string} [opts.logoUrl]       - Override logo URL (defaults to mosaicbizhub.com/logo.png)
 * @returns {string} Full HTML email string
 */
function baseLayout({ preheader, bodyHtml, footerReason, logoUrl }) {
  let logo = logoUrl || 'https://mosaicbizhub.com/logo.png';
  if (
    typeof logo !== 'string' ||
    !logo.trim() ||
    logo.includes('localhost') ||
    logo.includes('127.0.0.1') ||
    logo.startsWith('cid:')
  ) {
    logo = 'https://mosaicbizhub.com/logo.png';
  }

  const reason = footerReason || 'You are receiving this email because you have an account with Mosaic Biz Hub.';
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no" />
  <title>Mosaic Biz Hub</title>
  <!--[if mso]>
  <noscript>
    <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F3F4F6;font-family:${FONT_STACK};-webkit-font-smoothing:antialiased;">

  <!-- Preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#F3F4F6;line-height:1px;">
    ${esc(preheader || '')}
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
    style="background-color:#F3F4F6;margin:0;padding:0;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Email Card -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="600"
          style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);border-collapse:collapse;">

          <!-- Top Accent Gradient Bar -->
          <tr>
            <td style="height:6px;background:linear-gradient(135deg,${BRAND_COLOR} 0%,${ACCENT_COLOR} 100%);"></td>
          </tr>

          <!-- ─── HEADER / LOGO ─── -->
          <tr>
            <td align="center"
              style="background:#ffffff;padding:28px 40px 22px;border-bottom:1px solid #F3F4F6;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td align="center">
                    <img src="${logo}"
                      alt="Mosaic Biz Hub"
                      width="170"
                      style="display:block;max-width:170px;height:auto;margin:0 auto;border:0;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ─── MAIN CONTENT ─── -->
          <tr>
            <td style="padding:40px 48px 32px;font-family:${FONT_STACK};">
              ${bodyHtml}
            </td>
          </tr>

          <!-- ─── DIVIDER ─── -->
          <tr>
            <td style="padding:0 48px;">
              <div style="height:1px;background:#E5E7EB;"></div>
            </td>
          </tr>

          <!-- ─── FOOTER ─── -->
          <tr>
            <td align="center" style="padding:32px 40px 32px;background:#F9FAFB;border-top:1px solid #E5E7EB;">

              <!-- Footer Big Logo -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
                <tr>
                  <td align="center">
                    <img src="${logo}"
                      alt="Mosaic Biz Hub"
                      width="180"
                      style="display:block;max-width:180px;height:auto;margin:0 auto;" />
                  </td>
                </tr>
              </table>

              <!-- Brand tagline -->
              <p style="font-family:${FONT_STACK};font-size:13px;font-weight:600;color:#374151;margin:0 0 4px;">
                Mosaic Biz Hub
              </p>
              <p style="font-family:${FONT_STACK};font-size:12px;color:#6B7280;font-style:italic;margin:0 0 16px;">
                Connecting businesses, customers, and community.
              </p>

              <!-- Social links -->
              <p style="font-family:${FONT_STACK};font-size:11px;color:#9CA3AF;margin:0 0 12px;">
                Stay Connected &nbsp;|&nbsp;
                <a href="https://www.facebook.com/mosaicbizhub" style="color:#6B7280;text-decoration:none;">Facebook</a>
                &nbsp;|&nbsp;
                <a href="https://www.instagram.com/mosaicbizhub" style="color:#6B7280;text-decoration:none;">Instagram</a>
                &nbsp;|&nbsp;
                <a href="https://www.linkedin.com/company/mosaicbizhub" style="color:#6B7280;text-decoration:none;">LinkedIn</a>
              </p>

              <!-- Legal links -->
              <p style="font-family:${FONT_STACK};font-size:11px;color:#9CA3AF;margin:0 0 12px;">
                <a href="https://mosaicbizhub.com/terms" style="color:#6B7280;text-decoration:none;">Terms of Use</a>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <a href="https://mosaicbizhub.com/privacy" style="color:#6B7280;text-decoration:none;">Privacy Policy</a>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <a href="https://mosaicbizhub.com/help" style="color:#6B7280;text-decoration:none;">Help &amp; Support</a>
              </p>

              <!-- Support -->
              <p style="font-family:${FONT_STACK};font-size:11px;color:#9CA3AF;margin:0 0 16px;">
                Need assistance? Contact us at
                <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_COLOR};text-decoration:none;">${SUPPORT_EMAIL}</a>
              </p>

              <!-- Why am I receiving this -->
              <p style="font-family:${FONT_STACK};font-size:10px;color:#D1D5DB;margin:0 0 12px;line-height:1.5;">
                ${esc(reason)}
              </p>

              <!-- Address & copyright -->
              <p style="font-family:${FONT_STACK};font-size:10px;color:#D1D5DB;margin:0;">
                Mosaic Biz Hub LLC &bull; www.mosaicbizhub.com<br/>
                &copy; ${year} Mosaic Biz Hub LLC. All rights reserved.
              </p>

            </td>
          </tr>

        </table>
        <!-- /Email Card -->

      </td>
    </tr>
  </table>
  <!-- /Outer wrapper -->

</body>
</html>`;
}

module.exports = { baseLayout, esc, BRAND_COLOR, BRAND_COLOR_DARK, ACCENT_COLOR, FONT_STACK, SUPPORT_EMAIL };
