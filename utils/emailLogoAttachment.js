const { getFrontendLogoUrl } = require("./frontendUrl");

async function fetchLogoBuffer(url, timeoutMs = 5000) {
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "image/*,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      console.warn("Email logo fetch failed", {
        url,
        status: response.status,
      });
      return null;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length ? bytes : null;
  } catch (error) {
    console.warn("Email logo fetch error", {
      url,
      message: error?.message || String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve an optional embedded logo for transactional email.
 * Never throws on 404/offline frontend — returns a remote HTML fallback instead.
 */
async function resolvePlatformLogoAttachment(env = process.env) {
  const logoUrl =
    (typeof env.MAIL_LOGO_URL === "string" && env.MAIL_LOGO_URL.trim()) ||
    getFrontendLogoUrl(env);

  const content = await fetchLogoBuffer(logoUrl);
  if (content) {
    return {
      attachment: {
        filename: "logo.png",
        content,
        cid: "platformLogo",
        contentType: "image/png",
      },
      logoSrcForHtml: "cid:platformLogo",
      logoUrl,
    };
  }

  return {
    attachment: null,
    logoSrcForHtml: logoUrl,
    logoUrl,
  };
}

function withOptionalLogoAttachment(attachments = [], logoAttachment) {
  if (!logoAttachment) return attachments;
  return [logoAttachment, ...attachments];
}

module.exports = {
  fetchLogoBuffer,
  resolvePlatformLogoAttachment,
  withOptionalLogoAttachment,
};
