#!/usr/bin/env node

require('dotenv').config();

const {
  GetBucketCorsCommand,
  S3Client,
  PutBucketCorsCommand,
} = require('@aws-sdk/client-s3');
const {
  buildS3UploadCorsConfiguration,
  S3_UPLOAD_CORS_RULE_ID,
} = require('../utils/s3UploadCorsConfig');

async function getExistingCorsRules(client, bucket) {
  try {
    const current = await client.send(
      new GetBucketCorsCommand({
        Bucket: bucket,
      })
    );

    return current.CORSRules || [];
  } catch (error) {
    if (
      error?.name === 'NoSuchCORSConfiguration' ||
      error?.$metadata?.httpStatusCode === 404
    ) {
      return [];
    }

    throw error;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const corsConfiguration = buildS3UploadCorsConfiguration(process.env);

  if (!apply) {
    console.log(JSON.stringify(corsConfiguration, null, 2));
    console.log(
      'Dry run only. Re-run with --apply to write this CORS configuration to the S3 bucket.'
    );
    return;
  }

  if (!process.env.AWS_S3_BUCKET) {
    throw new Error('AWS_S3_BUCKET is required');
  }

  const client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const existingRules = await getExistingCorsRules(client, process.env.AWS_S3_BUCKET);
  const managedRule = corsConfiguration.CORSRules[0];
  const mergedConfiguration = {
    CORSRules: [
      ...existingRules.filter((rule) => rule.ID !== S3_UPLOAD_CORS_RULE_ID),
      managedRule,
    ],
  };

  await client.send(
    new PutBucketCorsCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      CORSConfiguration: mergedConfiguration,
    })
  );

  console.log(
    `Applied S3 upload CORS configuration with ${managedRule.AllowedOrigins.length} allowed browser origins.`
  );
}

main().catch((error) => {
  if (error.message === 'AWS_S3_BUCKET is required') {
    console.error(error.message);
  } else {
    const status = error?.$metadata?.httpStatusCode
      ? ` status=${error.$metadata.httpStatusCode}`
      : '';
    console.error(`Failed to apply S3 upload CORS: ${error.name || 'Error'}${status}`);
  }
  process.exit(1);
});
