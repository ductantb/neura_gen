export default () => ({
  storage: {
    driver: process.env.STORAGE_DRIVER || 's3',
    s3: {
      region: process.env.AWS_REGION || 'us-east-1',
      bucket: process.env.AWS_S3_BUCKET,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      keyPrefix: process.env.S3_KEY_PREFIX || 'neuragen',
    },
  },
});