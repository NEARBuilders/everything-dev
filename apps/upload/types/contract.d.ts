import "@orpc/openapi/extensions/route";
export declare const UploadBundleSchema: import("zod").ZodObject<
  {
    account: import("zod").ZodString;
    gateway: import("zod").ZodString;
    workspace: import("zod").ZodString;
    files: import("zod").ZodArray<
      import("zod").ZodObject<
        {
          path: import("zod").ZodString;
          contentBase64: import("zod").ZodString;
        },
        import("zod/v4/core").$strip
      >
    >;
  },
  import("zod/v4/core").$strip
>;
export declare const contract: {
  uploadStorageBundle: import("@orpc/contract").ProcedureContract<
    import("zod").ZodObject<
      {
        account: import("zod").ZodString;
        gateway: import("zod").ZodString;
        workspace: import("zod").ZodString;
        files: import("zod").ZodArray<
          import("zod").ZodObject<
            {
              path: import("zod").ZodString;
              contentBase64: import("zod").ZodString;
            },
            import("zod/v4/core").$strip
          >
        >;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        stored: import("zod").ZodNumber;
        unchanged: import("zod").ZodOptional<import("zod").ZodNumber>;
        totalBytes: import("zod").ZodNumber;
        integrity: import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodString>;
        storage: import("zod").ZodOptional<
          import("zod").ZodEnum<{
            memory: "memory";
            s3: "s3";
          }>
        >;
      },
      import("zod/v4/core").$strip
    >,
    {
      UNAUTHORIZED: {
        readonly status: 401;
        readonly data: import("zod").ZodObject<
          {
            apiKeyProvided: import("zod").ZodBoolean;
            provider: import("zod").ZodOptional<import("zod").ZodString>;
            authType: import("zod").ZodOptional<
              import("zod").ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          import("zod/v4/core").$strip
        >;
      };
      FORBIDDEN: {
        readonly status: 403;
        readonly data: import("zod").ZodObject<
          {
            requiredPermissions: import("zod").ZodOptional<
              import("zod").ZodArray<import("zod").ZodString>
            >;
            action: import("zod").ZodOptional<import("zod").ZodString>;
          },
          import("zod/v4/core").$strip
        >;
      };
      BAD_REQUEST: {
        readonly status: 400;
        readonly data: import("zod").ZodObject<
          {
            invalidFields: import("zod").ZodOptional<
              import("zod").ZodArray<import("zod").ZodString>
            >;
            validationErrors: import("zod").ZodOptional<
              import("zod").ZodArray<
                import("zod").ZodObject<
                  {
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                  },
                  import("zod/v4/core").$strip
                >
              >
            >;
          },
          import("zod/v4/core").$strip
        >;
      };
      CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: import("zod").ZodObject<
          {
            errorCode: import("zod").ZodOptional<import("zod").ZodString>;
            host: import("zod").ZodOptional<import("zod").ZodString>;
            port: import("zod").ZodOptional<import("zod").ZodNumber>;
            suggestion: import("zod").ZodOptional<import("zod").ZodString>;
          },
          import("zod/v4/core").$strip
        >;
      };
    }
  >;
  listBundles: import("@orpc/contract").ProcedureContract<
    import("zod").ZodObject<
      {
        account: import("zod").ZodString;
        gateway: import("zod").ZodString;
        workspace: import("zod").ZodOptional<import("zod").ZodString>;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        storage: import("zod").ZodEnum<{
          memory: "memory";
          s3: "s3";
        }>;
        prefix: import("zod").ZodString;
        objects: import("zod").ZodArray<
          import("zod").ZodObject<
            {
              key: import("zod").ZodString;
              size: import("zod").ZodNumber;
              lastModified: import("zod").ZodOptional<
                import("zod").ZodNullable<import("zod").ZodString>
              >;
            },
            import("zod/v4/core").$strip
          >
        >;
        truncated: import("zod").ZodBoolean;
      },
      import("zod/v4/core").$strip
    >,
    {
      UNAUTHORIZED: {
        readonly status: 401;
        readonly data: import("zod").ZodObject<
          {
            apiKeyProvided: import("zod").ZodBoolean;
            provider: import("zod").ZodOptional<import("zod").ZodString>;
            authType: import("zod").ZodOptional<
              import("zod").ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          import("zod/v4/core").$strip
        >;
      };
      FORBIDDEN: {
        readonly status: 403;
        readonly data: import("zod").ZodObject<
          {
            requiredPermissions: import("zod").ZodOptional<
              import("zod").ZodArray<import("zod").ZodString>
            >;
            action: import("zod").ZodOptional<import("zod").ZodString>;
          },
          import("zod/v4/core").$strip
        >;
      };
      BAD_REQUEST: {
        readonly status: 400;
        readonly data: import("zod").ZodObject<
          {
            invalidFields: import("zod").ZodOptional<
              import("zod").ZodArray<import("zod").ZodString>
            >;
            validationErrors: import("zod").ZodOptional<
              import("zod").ZodArray<
                import("zod").ZodObject<
                  {
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                  },
                  import("zod/v4/core").$strip
                >
              >
            >;
          },
          import("zod/v4/core").$strip
        >;
      };
      CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: import("zod").ZodObject<
          {
            errorCode: import("zod").ZodOptional<import("zod").ZodString>;
            host: import("zod").ZodOptional<import("zod").ZodString>;
            port: import("zod").ZodOptional<import("zod").ZodNumber>;
            suggestion: import("zod").ZodOptional<import("zod").ZodString>;
          },
          import("zod/v4/core").$strip
        >;
      };
    }
  >;
  listVersions: import("@orpc/contract").ProcedureContract<
    import("zod").ZodObject<
      {
        account: import("zod").ZodString;
        gateway: import("zod").ZodString;
        workspace: import("zod").ZodString;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        storage: import("zod").ZodEnum<{
          memory: "memory";
          s3: "s3";
        }>;
        versions: import("zod").ZodArray<
          import("zod").ZodObject<
            {
              version: import("zod").ZodString;
              entry: import("zod").ZodString;
              entryIntegrity: import("zod").ZodString;
              gitSha: import("zod").ZodOptional<import("zod").ZodString>;
              builtAt: import("zod").ZodOptional<import("zod").ZodString>;
              fileCount: import("zod").ZodOptional<import("zod").ZodNumber>;
              lastModified: import("zod").ZodOptional<
                import("zod").ZodNullable<import("zod").ZodString>
              >;
            },
            import("zod/v4/core").$strip
          >
        >;
        truncated: import("zod").ZodBoolean;
      },
      import("zod/v4/core").$strip
    >,
    {
      UNAUTHORIZED: {
        readonly status: 401;
        readonly data: import("zod").ZodObject<
          {
            apiKeyProvided: import("zod").ZodBoolean;
            provider: import("zod").ZodOptional<import("zod").ZodString>;
            authType: import("zod").ZodOptional<
              import("zod").ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          import("zod/v4/core").$strip
        >;
      };
      FORBIDDEN: {
        readonly status: 403;
        readonly data: import("zod").ZodObject<
          {
            requiredPermissions: import("zod").ZodOptional<
              import("zod").ZodArray<import("zod").ZodString>
            >;
            action: import("zod").ZodOptional<import("zod").ZodString>;
          },
          import("zod/v4/core").$strip
        >;
      };
      BAD_REQUEST: {
        readonly status: 400;
        readonly data: import("zod").ZodObject<
          {
            invalidFields: import("zod").ZodOptional<
              import("zod").ZodArray<import("zod").ZodString>
            >;
            validationErrors: import("zod").ZodOptional<
              import("zod").ZodArray<
                import("zod").ZodObject<
                  {
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                  },
                  import("zod/v4/core").$strip
                >
              >
            >;
          },
          import("zod/v4/core").$strip
        >;
      };
      CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: import("zod").ZodObject<
          {
            errorCode: import("zod").ZodOptional<import("zod").ZodString>;
            host: import("zod").ZodOptional<import("zod").ZodString>;
            port: import("zod").ZodOptional<import("zod").ZodNumber>;
            suggestion: import("zod").ZodOptional<import("zod").ZodString>;
          },
          import("zod/v4/core").$strip
        >;
      };
    }
  >;
  integrityReport: import("@orpc/contract").ProcedureContract<
    import("zod").ZodObject<
      {
        account: import("zod").ZodString;
        gateway: import("zod").ZodString;
        workspace: import("zod").ZodString;
        version: import("zod").ZodString;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        storage: import("zod").ZodEnum<{
          memory: "memory";
          s3: "s3";
        }>;
        manifest: import("zod").ZodObject<
          {
            version: import("zod").ZodString;
            builtAt: import("zod").ZodOptional<import("zod").ZodString>;
            gitSha: import("zod").ZodOptional<import("zod").ZodString>;
            entry: import("zod").ZodString;
            entryIntegrity: import("zod").ZodString;
            ssr: import("zod").ZodOptional<
              import("zod").ZodObject<
                {
                  entry: import("zod").ZodString;
                  integrity: import("zod").ZodString;
                },
                import("zod/v4/core").$strip
              >
            >;
            browserManifest: import("zod").ZodOptional<
              import("zod").ZodObject<
                {
                  file: import("zod").ZodString;
                  integrity: import("zod").ZodString;
                },
                import("zod/v4/core").$strip
              >
            >;
            assets: import("zod").ZodOptional<
              import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodString>
            >;
            shared: import("zod").ZodOptional<
              import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodString>
            >;
            files: import("zod").ZodOptional<
              import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodString>
            >;
          },
          import("zod/v4/core").$strip
        >;
        entryVerified: import("zod").ZodNullable<import("zod").ZodBoolean>;
      },
      import("zod/v4/core").$strip
    >,
    {
      UNAUTHORIZED: {
        readonly status: 401;
        readonly data: import("zod").ZodObject<
          {
            apiKeyProvided: import("zod").ZodBoolean;
            provider: import("zod").ZodOptional<import("zod").ZodString>;
            authType: import("zod").ZodOptional<
              import("zod").ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          import("zod/v4/core").$strip
        >;
      };
      FORBIDDEN: {
        readonly status: 403;
        readonly data: import("zod").ZodObject<
          {
            requiredPermissions: import("zod").ZodOptional<
              import("zod").ZodArray<import("zod").ZodString>
            >;
            action: import("zod").ZodOptional<import("zod").ZodString>;
          },
          import("zod/v4/core").$strip
        >;
      };
      BAD_REQUEST: {
        readonly status: 400;
        readonly data: import("zod").ZodObject<
          {
            invalidFields: import("zod").ZodOptional<
              import("zod").ZodArray<import("zod").ZodString>
            >;
            validationErrors: import("zod").ZodOptional<
              import("zod").ZodArray<
                import("zod").ZodObject<
                  {
                    field: import("zod").ZodString;
                    message: import("zod").ZodString;
                    code: import("zod").ZodOptional<import("zod").ZodString>;
                  },
                  import("zod/v4/core").$strip
                >
              >
            >;
          },
          import("zod/v4/core").$strip
        >;
      };
      CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: import("zod").ZodObject<
          {
            errorCode: import("zod").ZodOptional<import("zod").ZodString>;
            host: import("zod").ZodOptional<import("zod").ZodString>;
            port: import("zod").ZodOptional<import("zod").ZodNumber>;
            suggestion: import("zod").ZodOptional<import("zod").ZodString>;
          },
          import("zod/v4/core").$strip
        >;
      };
    }
  >;
};
export type ContractType = typeof contract;
