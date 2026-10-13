import { z } from "zod";
export declare const BundleFileSchema: z.ZodObject<
  {
    path: z.ZodString;
    contentBase64: z.ZodString;
  },
  z.core.$strip
>;
export declare const UploadRequestSchema: z.ZodObject<
  {
    account: z.ZodString;
    gateway: z.ZodString;
    workspace: z.ZodString;
    files: z.ZodArray<
      z.ZodObject<
        {
          path: z.ZodString;
          contentBase64: z.ZodString;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const UploadResponseSchema: z.ZodObject<
  {
    stored: z.ZodNumber;
    unchanged: z.ZodOptional<z.ZodNumber>;
    totalBytes: z.ZodNumber;
    integrity: z.ZodRecord<z.ZodString, z.ZodString>;
    storage: z.ZodOptional<
      z.ZodEnum<{
        memory: "memory";
        s3: "s3";
      }>
    >;
  },
  z.core.$strip
>;
export declare const ListBundlesQuerySchema: z.ZodObject<
  {
    account: z.ZodString;
    gateway: z.ZodString;
    workspace: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export declare const BundleObjectSummarySchema: z.ZodObject<
  {
    key: z.ZodString;
    size: z.ZodNumber;
    lastModified: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  },
  z.core.$strip
>;
export declare const ListBundlesResultSchema: z.ZodObject<
  {
    storage: z.ZodEnum<{
      memory: "memory";
      s3: "s3";
    }>;
    prefix: z.ZodString;
    objects: z.ZodArray<
      z.ZodObject<
        {
          key: z.ZodString;
          size: z.ZodNumber;
          lastModified: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        },
        z.core.$strip
      >
    >;
    truncated: z.ZodBoolean;
  },
  z.core.$strip
>;
export declare const ListVersionsQuerySchema: z.ZodObject<
  {
    account: z.ZodString;
    gateway: z.ZodString;
    workspace: z.ZodString;
  },
  z.core.$strip
>;
export declare const VersionSummarySchema: z.ZodObject<
  {
    version: z.ZodString;
    entry: z.ZodString;
    entryIntegrity: z.ZodString;
    gitSha: z.ZodOptional<z.ZodString>;
    builtAt: z.ZodOptional<z.ZodString>;
    fileCount: z.ZodOptional<z.ZodNumber>;
    lastModified: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  },
  z.core.$strip
>;
export declare const ListVersionsResultSchema: z.ZodObject<
  {
    storage: z.ZodEnum<{
      memory: "memory";
      s3: "s3";
    }>;
    versions: z.ZodArray<
      z.ZodObject<
        {
          version: z.ZodString;
          entry: z.ZodString;
          entryIntegrity: z.ZodString;
          gitSha: z.ZodOptional<z.ZodString>;
          builtAt: z.ZodOptional<z.ZodString>;
          fileCount: z.ZodOptional<z.ZodNumber>;
          lastModified: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        },
        z.core.$strip
      >
    >;
    truncated: z.ZodBoolean;
  },
  z.core.$strip
>;
export declare const IntegrityReportQuerySchema: z.ZodObject<
  {
    account: z.ZodString;
    gateway: z.ZodString;
    workspace: z.ZodString;
    version: z.ZodString;
  },
  z.core.$strip
>;
export declare const IntegrityReportResultSchema: z.ZodObject<
  {
    storage: z.ZodEnum<{
      memory: "memory";
      s3: "s3";
    }>;
    manifest: z.ZodObject<
      {
        version: z.ZodString;
        builtAt: z.ZodOptional<z.ZodString>;
        gitSha: z.ZodOptional<z.ZodString>;
        entry: z.ZodString;
        entryIntegrity: z.ZodString;
        ssr: z.ZodOptional<
          z.ZodObject<
            {
              entry: z.ZodString;
              integrity: z.ZodString;
            },
            z.core.$strip
          >
        >;
        browserManifest: z.ZodOptional<
          z.ZodObject<
            {
              file: z.ZodString;
              integrity: z.ZodString;
            },
            z.core.$strip
          >
        >;
        assets: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        shared: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        files: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
      },
      z.core.$strip
    >;
    entryVerified: z.ZodNullable<z.ZodBoolean>;
  },
  z.core.$strip
>;
export type BundleFile = z.infer<typeof BundleFileSchema>;
export type UploadRequest = z.infer<typeof UploadRequestSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
export type ListBundlesQuery = z.infer<typeof ListBundlesQuerySchema>;
export type BundleObjectSummary = z.infer<typeof BundleObjectSummarySchema>;
export type ListBundlesResult = z.infer<typeof ListBundlesResultSchema>;
export type ListVersionsQuery = z.infer<typeof ListVersionsQuerySchema>;
export type VersionSummary = z.infer<typeof VersionSummarySchema>;
export type ListVersionsResult = z.infer<typeof ListVersionsResultSchema>;
export type IntegrityReportQuery = z.infer<typeof IntegrityReportQuerySchema>;
export type IntegrityReportResult = z.infer<typeof IntegrityReportResultSchema>;
export interface UploadClientConfig {
  origin: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}
export interface UploadClient {
  uploadBundle(input: UploadRequest): Promise<UploadResponse>;
  listBundles(input: ListBundlesQuery): Promise<ListBundlesResult>;
  listVersions(input: ListVersionsQuery): Promise<ListVersionsResult>;
  integrityReport(input: IntegrityReportQuery): Promise<IntegrityReportResult>;
}
export declare function createUploadClient(config: UploadClientConfig): UploadClient;
