const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { buildS3ClientConfig } = require("./s3ClientConfig");
const { v4: uuidv4 } = require("uuid");

// Initialize S3 Client
const s3 = new S3Client(buildS3ClientConfig());

exports.uploadFile = async (file, folder = "business") => {
  if (!file) throw new Error("No file provided");

  const fileName = `${folder}/${uuidv4()}-${file.originalname}`;

  const params = {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  try {
    await s3.send(new PutObjectCommand(params));

    // Construct public URL (for public-read files)
    return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
  } catch (err) {
    console.error("S3 Upload Error:", err);
    throw err;
  }
};
