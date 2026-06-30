const multer = require("multer");
const {
  MAX_VENDOR_ONBOARDING_UPLOAD_BYTES,
} = require("../utils/vendorOnboardingUploadMimeAllowlist");

const vendorOnboardingFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_VENDOR_ONBOARDING_UPLOAD_BYTES,
    files: 1,
  },
}).single("file");

function handleVendorOnboardingFileUpload(req, res, next) {
  vendorOnboardingFileUpload(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: `File must be under ${Math.round(
          MAX_VENDOR_ONBOARDING_UPLOAD_BYTES / (1024 * 1024)
        )}MB`,
      });
    }

    return res.status(400).json({
      success: false,
      message: "Invalid upload request",
    });
  });
}

module.exports = handleVendorOnboardingFileUpload;
