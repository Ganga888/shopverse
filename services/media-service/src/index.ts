import { randomUUID } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticate, badRequest, counter, createBreaker, forbidden, loadConfig, main, notFound, parse, runService } from '@shopverse/common';
import { z } from 'zod';
import { buildObjectKey, canRead, PURPOSES, validateUpload } from './keys.js';

const config = loadConfig({
  S3_BUCKET: z.string().min(1),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().default('false').transform((v) => v === 'true'),
  CDN_BASE_URL: z.string().optional(),
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  PRESIGN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(300),
  /** GitOps alias for PRESIGN_TTL_SEC. */
  PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).optional(),
});
const presignTtl = config.PRESIGNED_URL_TTL_SECONDS ?? config.PRESIGN_TTL_SEC;
const presigned = counter('media_presigned_urls_total', 'Presigned URLs issued', ['op']);

const s3 = new S3Client({ region: config.AWS_REGION, endpoint: config.S3_ENDPOINT, forcePathStyle: config.S3_FORCE_PATH_STYLE });
// Presigning may resolve IRSA credentials (STS call); HeadObject is a network call. Both behind breakers.
const presignPut = createBreaker('s3-presign', (key: string, contentType: string, contentLength: number) =>
  getSignedUrl(s3, new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ContentType: contentType, ContentLength: contentLength }), {
    expiresIn: presignTtl,
  }),
);
const presignGet = createBreaker('s3-presign-get', (key: string) => getSignedUrl(s3, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: presignTtl }));
const headObject = createBreaker('s3-head', (key: string) => s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: key })), {
  errorFilter: (err: unknown) => (err as { name?: string }).name === 'NotFound',
});

const keyQuery = z.object({ key: z.string().min(1).max(512) });

main(() =>
  runService({
    config,
    onShutdown: async () => s3.destroy(),
    routes: (app, { verifyToken }) => {
      const auth = authenticate(verifyToken);

      app.post('/api/v1/media/uploads', { preHandler: auth }, async (req, reply) => {
        const b = parse(
          z.object({ filename: z.string().min(1).max(200), contentType: z.string().min(1), contentLength: z.number().int().positive(), purpose: z.enum(PURPOSES).default('review') }),
          req.body,
        );
        const err = validateUpload(b.contentType, b.contentLength, config.MEDIA_MAX_BYTES);
        if (err) throw badRequest(err);
        const user = req.user!;
        if (b.purpose === 'product' && !user.roles.includes('admin')) throw forbidden('only admins can upload product images');
        const key = buildObjectKey(b.purpose, user.sub, randomUUID(), b.filename, b.contentType);
        const uploadUrl = await presignPut.fire(key, b.contentType, b.contentLength);
        presigned.inc({ op: 'put' });
        return reply.code(201).send({
          key,
          uploadUrl,
          method: 'PUT',
          headers: { 'content-type': b.contentType },
          expiresIn: presignTtl,
          publicUrl: b.purpose === 'product' && config.CDN_BASE_URL ? `${config.CDN_BASE_URL.replace(/\/$/, '')}/${key}` : null,
        });
      });

      app.get('/api/v1/media/download', { preHandler: auth }, async (req) => {
        const { key } = parse(keyQuery, req.query);
        if (!canRead(key, req.user!.sub, req.user!.roles.includes('admin'))) throw notFound('object');
        presigned.inc({ op: 'get' });
        return { key, url: await presignGet.fire(key), expiresIn: presignTtl };
      });

      app.get('/api/v1/media/objects', { preHandler: auth }, async (req) => {
        const { key } = parse(keyQuery, req.query);
        if (!canRead(key, req.user!.sub, req.user!.roles.includes('admin'))) throw notFound('object');
        try {
          const head = await headObject.fire(key);
          return { key, contentType: head.ContentType, contentLength: head.ContentLength, lastModified: head.LastModified, etag: head.ETag };
        } catch (err) {
          if ((err as { name?: string }).name === 'NotFound') throw notFound('object');
          throw err;
        }
      });
    },
  }),
);
