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
      console.warn("Vendor onboarding upload rejected: file too large");
      return res.status(400).json({
        success: false,
        code: "UPLOAD_FILE_TOO_LARGE",
        message: `File must be under ${Math.round(
          MAX_VENDOR_ONBOARDING_UPLOAD_BYTES / (1024 * 1024)
        )}MB`,
      });
    }

    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      console.warn("Vendor onboarding upload rejected: unexpected file field", {
        field: error.field,
      });
      return res.status(400).json({
        success: false,
        code: "UPLOAD_UNEXPECTED_FIELD",
        message: 'Upload file field must be named "file"',
      });
    }

    console.warn("Vendor onboarding upload rejected: invalid multipart request", {
      code: error.code,
      message: error.message,
    });
    return res.status(400).json({
      success: false,
      code: "UPLOAD_INVALID_MULTIPART",
      message: "Invalid upload request",
    });
  });
}

module.exports = handleVendorOnboardingFileUpload;
