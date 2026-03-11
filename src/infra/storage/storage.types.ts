export interface UploadInput {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  folder?: string;
  metadata?: Record<string, string>;
}

export interface UploadResult {
  bucket: string;
  key: string;
  mimeType: string;
  size: number;
  originalName: string;
}

export interface SignedUrlResult {
  url: string;
  expiresIn: number;
}

export interface IStorageProvider {
  upload(input: UploadInput): Promise<UploadResult>;
  delete(key: string): Promise<void>;
  getDownloadSignedUrl(key: string, expiresIn?: number): Promise<SignedUrlResult>;
}