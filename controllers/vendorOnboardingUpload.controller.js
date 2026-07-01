const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
  ALLOWED_VENDOR_ONBOARDING_MIME_TYPES,
  MAX_VENDOR_ONBOARDING_UPLOAD_BYTES,
  isAllowedVendorOnboardingMime,
  parseUploadSizeBytes,
  resolveVendorOnboardingMimeType,
} = require("../utils/vendorOnboardingUploadMimeAllowlist");
const {
  PRESIGNED_S3_UPLOAD_EXPIRES_IN_SECONDS,
  buildPresignedS3UploadContract,
  sanitizeS3UploadFileName,
} = require("../utils/s3PresignedUploadContract");

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ALLOWED_VENDOR_ONBOARDING_DOCUMENT_TYPES = [
  "minority-proof",
  "tax-doc",
  "business-license",
  "business-profile",
  "feature-banner",
  "refund-policy",
  "terms-service",
];

function getVendorOnboardingFolderPath(userId, documentType) {
  switch (documentType) {
    case "minority-proof":
      return `vendor-onboarding/stage1/${userId}/minority-proof`;
    case "tax-doc":
      return `vendor-onboarding/stage1/${userId}/tax-doc`;
    case "business-license":
      return `vendor-onboarding/stage1/${userId}/business-license`;
    case "business-profile":
      return `vendor-onboarding/business-profile/${userId}/logo`;
    case "feature-banner":
      return `vendor-onboarding/business-profile/${userId}/feature-banner`;
    case "refund-policy":
      return `vendor-onboarding/business-profile/${userId}/refund-policy`;
    case "terms-service":
      return `vendor-onboarding/business-profile/${userId}/terms-service`;
    default:
      return `vendor-onboarding/other/${userId}/${documentType}`;
  }
}

function buildVendorOnboardingUploadTarget({
  userId,
  fileName,
  fileType,
  fileSize,
  documentType,
}) {
  if (!fileName || !documentType) {
    return {
      status: 400,
      body: { message: "fileName and documentType are required" },
    };
  }

  if (!ALLOWED_VENDOR_ONBOARDING_DOCUMENT_TYPES.includes(documentType)) {
    return {
      status: 400,
      body: { message: "Invalid document type" },
    };
  }

  const normalizedFileType = resolveVendorOnboardingMimeType(fileType, fileName);
  if (!isAllowedVendorOnboardingMime(fileType, fileName)) {
    return {
      status: 400,
      body: {
        message: `Invalid file type. Allowed types: ${ALLOWED_VENDOR_ONBOARDING_MIME_TYPES.join(", ")}`,
      },
    };
  }

  const uploadSizeBytes = parseUploadSizeBytes(fileSize);
  if (Number.isNaN(uploadSizeBytes)) {
    return {
      status: 400,
      body: { message: "Invalid file size" },
    };
  }

  if (uploadSizeBytes !== null && uploadSizeBytes > MAX_VENDOR_ONBOARDING_UPLOAD_BYTES) {
    return {
      status: 400,
      body: {
        message: `File must be under ${Math.round(
          MAX_VENDOR_ONBOARDING_UPLOAD_BYTES / (1024 * 1024)
        )}MB`,
      },
    };
  }

  const bucketName = process.env.AWS_S3_BUCKET;
  const folderPath = getVendorOnboardingFolderPath(userId, documentType);
  const cleanFileName = sanitizeS3UploadFileName(fileName);
  const timestamp = Date.now();
  const key = `${folderPath}/${timestamp}-${cleanFileName}`;
  const region = process.env.AWS_REGION || "us-east-1";
  const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

  return {
    bucketName,
    documentType,
    fileUrl,
    key,
    normalizedFileType,
  };
}

exports.getStage1UploadUrl = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fileName, fileType, documentType, fileSize } = req.query;

    const target = buildVendorOnboardingUploadTarget({
      userId,
      fileName,
      fileType,
      fileSize,
      documentType,
    });
    if (target.status) {
      return res.status(target.status).json(target.body);
    }

    const command = new PutObjectCommand({
      Bucket: target.bucketName,
      Key: target.key,
      ContentType: target.normalizedFileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGNED_S3_UPLOAD_EXPIRES_IN_SECONDS,
    });

    return res.json({
      success: true,
      uploadUrl,
      fileUrl: target.fileUrl,
      documentType: target.documentType,
      key: target.key,
      ...buildPresignedS3UploadContract(target.normalizedFileType),
    });
  } catch (error) {
    console.error("Presigned URL error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate upload URL",
    });
  }
};

exports.uploadStage1File = async (req, res) => {
  try {
    const userId = req.user._id;
    const { documentType } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "File is required",
      });
    }

    const target = buildVendorOnboardingUploadTarget({
      userId,
      fileName: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size,
      documentType,
    });
    if (target.status) {
      return res.status(target.status).json(target.body);
    }

    const command = new PutObjectCommand({
      Bucket: target.bucketName,
      Key: target.key,
      Body: file.buffer,
      ContentType: target.normalizedFileType,
    });

    await s3Client.send(command);

    return res.json({
      success: true,
      uploadMethod: "api-proxy",
      fileUrl: target.fileUrl,
      documentType: target.documentType,
      key: target.key,
    });
  } catch (error) {
    console.error("Vendor onboarding upload error:", {
      message: error.message,
      name: error.name,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to upload file",
    });
  }
};
