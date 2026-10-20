import { S3Client } from '@aws-sdk/client-s3';
import type { BackendConfig } from './config';
import './config';
import {publicPhotoUrl} from './asset-urls';
export {safeObjectKey,publicPhotoUrl} from './asset-urls';

export type StorageArea = 'temporary' | 'published';
export interface ImageAsset {
  id: string;
  provider: 'r2';
  bucket: string;
  object_key: string;
  visibility: StorageArea;
  processing_state: 'pending' | 'processed' | 'failed' | 'deleted';
  width: number | null;
  height: number | null;
}

export function resolveAssetUrl(config: BackendConfig, asset: ImageAsset): string {
  if (asset.provider !== 'r2' || asset.visibility !== 'published' || asset.processing_state !== 'processed' || asset.bucket !== config.R2_PUBLISHED_BUCKET) throw new Error('Asset is not public');
  return publicPhotoUrl(config, asset.object_key);
}
// Clients never leave server code. An R2 token must separately enforce bucket scope.
export function createStorageClient(config: BackendConfig, area: StorageArea) {
  const temporary = area === 'temporary';
  return {
    bucket: temporary ? config.R2_TEMPORARY_BUCKET : config.R2_PUBLISHED_BUCKET,
    client: new S3Client({
      region: 'auto', endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: temporary ? config.R2_TEMPORARY_ACCESS_KEY_ID : config.R2_PUBLISHED_ACCESS_KEY_ID,
        secretAccessKey: temporary ? config.R2_TEMPORARY_SECRET_ACCESS_KEY : config.R2_PUBLISHED_SECRET_ACCESS_KEY,
      },
      maxAttempts: 2,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 },
    }),
  };
}
