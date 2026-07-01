const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
    ALLOWED_GENERIC_S3_UPLOAD_MIME_TYPES,
    PRESIGNED_S3_UPLOAD_EXPIRES_IN_SECONDS,
    buildPresignedS3UploadContract,
    isAllowedGenericS3UploadMimeType,
    resolveGenericS3UploadMimeType,
    sanitizeS3UploadFileName,
} = require("../utils/s3PresignedUploadContract");
require("dotenv").config();

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

exports.getPresignedUrl = async (req, res) => {
    // console.log("Generating presigned URL for S3 upload...");
    try {
        const { fileName, fileType } = req.query;

        if (!fileName || !fileType) {
            // console.log("❌ Missing fileName or fileType in query parameters", fileName, fileType);

            return res.status(400).json({ error: "fileName and fileType are required" });
        }

        const normalizedFileType = resolveGenericS3UploadMimeType(fileType, fileName);
        if (!isAllowedGenericS3UploadMimeType(fileType, fileName)) {
            return res.status(400).json({
                error: `Invalid file type. Allowed types: ${ALLOWED_GENERIC_S3_UPLOAD_MIME_TYPES.join(", ")}`,
            });
        }

        const bucketName = process.env.AWS_S3_BUCKET;
        const userId = req.user?._id || "unknown-user";
        const cleanFileName = sanitizeS3UploadFileName(fileName);
        const key = `uploads/${userId}/generic/${Date.now()}-${cleanFileName}`;

        // ✅ Generate Presigned URL for PUT operation
        const command = new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            ContentType: normalizedFileType,
        });

        const uploadUrl = await getSignedUrl(s3Client, command, {
            expiresIn: PRESIGNED_S3_UPLOAD_EXPIRES_IN_SECONDS,
        });
        const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

        // console.log(uploadUrl, "Presigned URL generated successfully" , fileUrl);


        res.json({
            uploadUrl,
            fileUrl,
            key,
            ...buildPresignedS3UploadContract(normalizedFileType),
        });
    } catch (error) {
        console.error("Error generating presigned URL:", error);
        res.status(500).json({ error: "Failed to generate presigned URL" });
    }
};
