const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
  ALLOWED_VENDOR_ONBOARDING_MIME_TYPES,
  isAllowedVendorOnboardingMime,
  normalizeMimeType,
} = require("../utils/vendorOnboardingUploadMimeAllowlist");

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Generate presigned URL for Vendor Onboarding Stage-1 documents
 */
exports.getStage1UploadUrl = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fileName, fileType, documentType } = req.query;

    if (!fileName || !fileType || !documentType) {
      return res.status(400).json({
        message: "fileName, fileType, and documentType are required",
      });
    }

    // ✅ ALLOWED DOCUMENT TYPES - INCLUDING BUSINESS PROFILE DOCUMENTS
    const allowedDocTypes = [
      // Stage 1 Documents
      "minority-proof",
      "tax-doc", 
      "business-license",
      
      // Business Profile Documents
      "business-profile",  // For logo/business profile image
      "feature-banner",    // For business profile feature banner image
      "refund-policy",     // For refund & return policy
      "terms-service"      // For terms & conditions / service agreement
    ];

    if (!allowedDocTypes.includes(documentType)) {
      return res.status(400).json({
        message: "Invalid document type",
      });
    }

    if (!isAllowedVendorOnboardingMime(fileType)) {
      return res.status(400).json({
        message: `Invalid file type. Allowed types: ${ALLOWED_VENDOR_ONBOARDING_MIME_TYPES.join(", ")}`,
      });
    }

    const normalizedFileType = normalizeMimeType(fileType);
    const bucketName = process.env.AWS_S3_BUCKET;

    // ✅ ORGANIZED FOLDER STRUCTURE
    let folderPath;
    switch (documentType) {
      // Stage 1 Documents
      case "minority-proof":
        folderPath = `vendor-onboarding/stage1/${userId}/minority-proof`;
        break;
      case "tax-doc":
        folderPath = `vendor-onboarding/stage1/${userId}/tax-doc`;
        break;
      case "business-license":
        folderPath = `vendor-onboarding/stage1/${userId}/business-license`;
        break;
      
      // Business Profile Documents  
      case "business-profile":
        folderPath = `vendor-onboarding/business-profile/${userId}/logo`;
        break;
      case "feature-banner":
        folderPath = `vendor-onboarding/business-profile/${userId}/feature-banner`;
        break;
      case "refund-policy":
        folderPath = `vendor-onboarding/business-profile/${userId}/refund-policy`;
        break;
      case "terms-service":
        folderPath = `vendor-onboarding/business-profile/${userId}/terms-service`;
        break;
      default:
        folderPath = `vendor-onboarding/other/${userId}/${documentType}`;
    }

    // Clean filename - remove special characters, spaces
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = Date.now();
    const key = `${folderPath}/${timestamp}-${cleanFileName}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: normalizedFileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300, // 5 minutes
    });

    // ✅ CONSTRUCT PUBLIC URL
    const region = process.env.AWS_REGION || 'us-east-1';
    const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

    return res.json({
      success: true,
      uploadUrl,
      fileUrl,
      documentType,
      key
    });

  } catch (error) {
    console.error("Presigned URL error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate upload URL",
    });
  }
};

// exports.getStage1UploadUrl = async (req, res) => {
//   try {
//     const userId = req.user._id;
//     const { fileName, fileType, documentType } = req.query;

//     if (!fileName || !fileType || !documentType) {
//       return res.status(400).json({
//         message: "fileName, fileType, and documentType are required",
//       });
//     }

//     const allowedDocTypes = [
//       "minority-proof",
//       "tax-doc",
//       "business-license",
//     ];

//     if (!allowedDocTypes.includes(documentType)) {
//       return res.status(400).json({
//         message: "Invalid document type",
//       });
//     }

//     const bucketName = process.env.AWS_S3_BUCKET;

//     const key = `vendor-onboarding/stage1/${userId}/${documentType}/${Date.now()}-${fileName}`;

//     const command = new PutObjectCommand({
//       Bucket: bucketName,
//       Key: key,
//       ContentType: fileType,
//     });

//     const uploadUrl = await getSignedUrl(s3Client, command, {
//       expiresIn: 300, // 5 minutes
//     });

//     const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

//     return res.json({
//       uploadUrl,
//       fileUrl,
//     });
//   } catch (error) {
//     console.error("Presigned URL error:", error);
//     return res.status(500).json({
//       message: "Failed to generate upload URL",
//     });
//   }
// };
