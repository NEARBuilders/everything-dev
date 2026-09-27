import "@orpc/openapi/extensions/route";
import { z } from "zod";
export declare const testItemSchema: z.ZodObject<
  {
    externalId: z.ZodString;
    content: z.ZodString;
    raw: z.ZodUnknown;
  },
  z.core.$strip
>;
export declare const streamEventSchema: z.ZodObject<
  {
    item: z.ZodObject<
      {
        externalId: z.ZodString;
        content: z.ZodString;
        raw: z.ZodUnknown;
      },
      z.core.$strip
    >;
    state: z.ZodObject<
      {
        nextPollMs: z.ZodNullable<z.ZodNumber>;
        lastId: z.ZodString;
      },
      z.core.$strip
    >;
    metadata: z.ZodObject<
      {
        itemIndex: z.ZodNumber;
      },
      z.core.$strip
    >;
  },
  z.core.$strip
>;
export declare const backgroundEventSchema: z.ZodObject<
  {
    id: z.ZodString;
    index: z.ZodNumber;
    timestamp: z.ZodNumber;
  },
  z.core.$strip
>;
export declare const testContract: {
  getById: import("@orpc/contract").ProcedureContract<
    z.ZodObject<
      {
        id: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        item: z.ZodObject<
          {
            externalId: z.ZodString;
            content: z.ZodString;
            raw: z.ZodUnknown;
          },
          z.core.$strip
        >;
      },
      z.core.$strip
    >,
    {
      readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly data: z.ZodObject<
          {
            apiKeyProvided: z.ZodBoolean;
            provider: z.ZodOptional<z.ZodString>;
            authType: z.ZodOptional<
              z.ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly RATE_LIMITED: {
        readonly status: 429;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodNumber;
            remainingRequests: z.ZodOptional<z.ZodNumber>;
            resetTime: z.ZodOptional<z.ZodString>;
            limitType: z.ZodOptional<
              z.ZodEnum<{
                bandwidth: "bandwidth";
                requests: "requests";
                tokens: "tokens";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodOptional<z.ZodNumber>;
            maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
            estimatedUptime: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly BAD_REQUEST: {
        readonly status: 400;
        readonly data: z.ZodObject<
          {
            invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            validationErrors: z.ZodOptional<
              z.ZodArray<
                z.ZodObject<
                  {
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >
            >;
          },
          z.core.$strip
        >;
      };
      readonly NOT_FOUND: {
        readonly status: 404;
        readonly data: z.ZodObject<
          {
            resource: z.ZodOptional<z.ZodString>;
            resourceId: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly FORBIDDEN: {
        readonly status: 403;
        readonly data: z.ZodObject<
          {
            requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            action: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly TIMEOUT: {
        readonly status: 504;
        readonly data: z.ZodObject<
          {
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            operation: z.ZodOptional<z.ZodString>;
            retryable: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >;
      };
      readonly CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: z.ZodObject<
          {
            errorCode: z.ZodOptional<z.ZodString>;
            host: z.ZodOptional<z.ZodString>;
            port: z.ZodOptional<z.ZodNumber>;
            suggestion: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
    }
  >;
  getBulk: import("@orpc/contract").ProcedureContract<
    z.ZodObject<
      {
        ids: z.ZodArray<z.ZodString>;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        items: z.ZodArray<
          z.ZodObject<
            {
              externalId: z.ZodString;
              content: z.ZodString;
              raw: z.ZodUnknown;
            },
            z.core.$strip
          >
        >;
      },
      z.core.$strip
    >,
    {
      readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly data: z.ZodObject<
          {
            apiKeyProvided: z.ZodBoolean;
            provider: z.ZodOptional<z.ZodString>;
            authType: z.ZodOptional<
              z.ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly RATE_LIMITED: {
        readonly status: 429;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodNumber;
            remainingRequests: z.ZodOptional<z.ZodNumber>;
            resetTime: z.ZodOptional<z.ZodString>;
            limitType: z.ZodOptional<
              z.ZodEnum<{
                bandwidth: "bandwidth";
                requests: "requests";
                tokens: "tokens";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodOptional<z.ZodNumber>;
            maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
            estimatedUptime: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly BAD_REQUEST: {
        readonly status: 400;
        readonly data: z.ZodObject<
          {
            invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            validationErrors: z.ZodOptional<
              z.ZodArray<
                z.ZodObject<
                  {
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >
            >;
          },
          z.core.$strip
        >;
      };
      readonly NOT_FOUND: {
        readonly status: 404;
        readonly data: z.ZodObject<
          {
            resource: z.ZodOptional<z.ZodString>;
            resourceId: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly FORBIDDEN: {
        readonly status: 403;
        readonly data: z.ZodObject<
          {
            requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            action: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly TIMEOUT: {
        readonly status: 504;
        readonly data: z.ZodObject<
          {
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            operation: z.ZodOptional<z.ZodString>;
            retryable: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >;
      };
      readonly CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: z.ZodObject<
          {
            errorCode: z.ZodOptional<z.ZodString>;
            host: z.ZodOptional<z.ZodString>;
            port: z.ZodOptional<z.ZodNumber>;
            suggestion: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
    }
  >;
  simpleStream: import("@orpc/contract").ProcedureContract<
    z.ZodObject<
      {
        count: z.ZodDefault<z.ZodNumber>;
        prefix: z.ZodDefault<z.ZodString>;
      },
      z.core.$strip
    >,
    import("@orpc/contract").Schema<
      AsyncIteratorObject<
        {
          item: {
            externalId: string;
            content: string;
            raw: unknown;
          };
          state: {
            nextPollMs: number | null;
            lastId: string;
          };
          metadata: {
            itemIndex: number;
          };
        },
        unknown,
        void
      >,
      import("@standard-server/shared").AsyncIteratorClass<
        {
          item: {
            externalId: string;
            content: string;
            raw: unknown;
          };
          state: {
            nextPollMs: number | null;
            lastId: string;
          };
          metadata: {
            itemIndex: number;
          };
        },
        unknown,
        void
      >
    >,
    {
      readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly data: z.ZodObject<
          {
            apiKeyProvided: z.ZodBoolean;
            provider: z.ZodOptional<z.ZodString>;
            authType: z.ZodOptional<
              z.ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly RATE_LIMITED: {
        readonly status: 429;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodNumber;
            remainingRequests: z.ZodOptional<z.ZodNumber>;
            resetTime: z.ZodOptional<z.ZodString>;
            limitType: z.ZodOptional<
              z.ZodEnum<{
                bandwidth: "bandwidth";
                requests: "requests";
                tokens: "tokens";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodOptional<z.ZodNumber>;
            maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
            estimatedUptime: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly BAD_REQUEST: {
        readonly status: 400;
        readonly data: z.ZodObject<
          {
            invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            validationErrors: z.ZodOptional<
              z.ZodArray<
                z.ZodObject<
                  {
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >
            >;
          },
          z.core.$strip
        >;
      };
      readonly NOT_FOUND: {
        readonly status: 404;
        readonly data: z.ZodObject<
          {
            resource: z.ZodOptional<z.ZodString>;
            resourceId: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly FORBIDDEN: {
        readonly status: 403;
        readonly data: z.ZodObject<
          {
            requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            action: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly TIMEOUT: {
        readonly status: 504;
        readonly data: z.ZodObject<
          {
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            operation: z.ZodOptional<z.ZodString>;
            retryable: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >;
      };
      readonly CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: z.ZodObject<
          {
            errorCode: z.ZodOptional<z.ZodString>;
            host: z.ZodOptional<z.ZodString>;
            port: z.ZodOptional<z.ZodNumber>;
            suggestion: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
    }
  >;
  emptyStream: import("@orpc/contract").ProcedureContract<
    z.ZodObject<
      {
        reason: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >,
    import("@orpc/contract").Schema<
      AsyncIteratorObject<
        {
          item: {
            externalId: string;
            content: string;
            raw: unknown;
          };
          state: {
            nextPollMs: number | null;
            lastId: string;
          };
          metadata: {
            itemIndex: number;
          };
        },
        unknown,
        void
      >,
      import("@standard-server/shared").AsyncIteratorClass<
        {
          item: {
            externalId: string;
            content: string;
            raw: unknown;
          };
          state: {
            nextPollMs: number | null;
            lastId: string;
          };
          metadata: {
            itemIndex: number;
          };
        },
        unknown,
        void
      >
    >,
    {
      readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly data: z.ZodObject<
          {
            apiKeyProvided: z.ZodBoolean;
            provider: z.ZodOptional<z.ZodString>;
            authType: z.ZodOptional<
              z.ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly RATE_LIMITED: {
        readonly status: 429;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodNumber;
            remainingRequests: z.ZodOptional<z.ZodNumber>;
            resetTime: z.ZodOptional<z.ZodString>;
            limitType: z.ZodOptional<
              z.ZodEnum<{
                bandwidth: "bandwidth";
                requests: "requests";
                tokens: "tokens";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodOptional<z.ZodNumber>;
            maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
            estimatedUptime: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly BAD_REQUEST: {
        readonly status: 400;
        readonly data: z.ZodObject<
          {
            invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            validationErrors: z.ZodOptional<
              z.ZodArray<
                z.ZodObject<
                  {
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >
            >;
          },
          z.core.$strip
        >;
      };
      readonly NOT_FOUND: {
        readonly status: 404;
        readonly data: z.ZodObject<
          {
            resource: z.ZodOptional<z.ZodString>;
            resourceId: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly FORBIDDEN: {
        readonly status: 403;
        readonly data: z.ZodObject<
          {
            requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            action: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly TIMEOUT: {
        readonly status: 504;
        readonly data: z.ZodObject<
          {
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            operation: z.ZodOptional<z.ZodString>;
            retryable: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >;
      };
      readonly CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: z.ZodObject<
          {
            errorCode: z.ZodOptional<z.ZodString>;
            host: z.ZodOptional<z.ZodString>;
            port: z.ZodOptional<z.ZodNumber>;
            suggestion: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
    }
  >;
  throwError: import("@orpc/contract").ProcedureContract<
    z.ZodObject<
      {
        errorType: z.ZodEnum<{
          FORBIDDEN: "FORBIDDEN";
          RATE_LIMITED: "RATE_LIMITED";
          SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE";
          UNAUTHORIZED: "UNAUTHORIZED";
        }>;
        customMessage: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        message: z.ZodString;
      },
      z.core.$strip
    >,
    {
      readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly data: z.ZodObject<
          {
            apiKeyProvided: z.ZodBoolean;
            provider: z.ZodOptional<z.ZodString>;
            authType: z.ZodOptional<
              z.ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly RATE_LIMITED: {
        readonly status: 429;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodNumber;
            remainingRequests: z.ZodOptional<z.ZodNumber>;
            resetTime: z.ZodOptional<z.ZodString>;
            limitType: z.ZodOptional<
              z.ZodEnum<{
                bandwidth: "bandwidth";
                requests: "requests";
                tokens: "tokens";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodOptional<z.ZodNumber>;
            maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
            estimatedUptime: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly BAD_REQUEST: {
        readonly status: 400;
        readonly data: z.ZodObject<
          {
            invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            validationErrors: z.ZodOptional<
              z.ZodArray<
                z.ZodObject<
                  {
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >
            >;
          },
          z.core.$strip
        >;
      };
      readonly NOT_FOUND: {
        readonly status: 404;
        readonly data: z.ZodObject<
          {
            resource: z.ZodOptional<z.ZodString>;
            resourceId: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly FORBIDDEN: {
        readonly status: 403;
        readonly data: z.ZodObject<
          {
            requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            action: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly TIMEOUT: {
        readonly status: 504;
        readonly data: z.ZodObject<
          {
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            operation: z.ZodOptional<z.ZodString>;
            retryable: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >;
      };
      readonly CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: z.ZodObject<
          {
            errorCode: z.ZodOptional<z.ZodString>;
            host: z.ZodOptional<z.ZodString>;
            port: z.ZodOptional<z.ZodNumber>;
            suggestion: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
    }
  >;
  requiresSpecialConfig: import("@orpc/contract").ProcedureContract<
    z.ZodObject<
      {
        checkValue: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        configValue: z.ZodString;
        inputValue: z.ZodString;
        userId: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >,
    {
      readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly data: z.ZodObject<
          {
            apiKeyProvided: z.ZodBoolean;
            provider: z.ZodOptional<z.ZodString>;
            authType: z.ZodOptional<
              z.ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly RATE_LIMITED: {
        readonly status: 429;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodNumber;
            remainingRequests: z.ZodOptional<z.ZodNumber>;
            resetTime: z.ZodOptional<z.ZodString>;
            limitType: z.ZodOptional<
              z.ZodEnum<{
                bandwidth: "bandwidth";
                requests: "requests";
                tokens: "tokens";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodOptional<z.ZodNumber>;
            maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
            estimatedUptime: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly BAD_REQUEST: {
        readonly status: 400;
        readonly data: z.ZodObject<
          {
            invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            validationErrors: z.ZodOptional<
              z.ZodArray<
                z.ZodObject<
                  {
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >
            >;
          },
          z.core.$strip
        >;
      };
      readonly NOT_FOUND: {
        readonly status: 404;
        readonly data: z.ZodObject<
          {
            resource: z.ZodOptional<z.ZodString>;
            resourceId: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly FORBIDDEN: {
        readonly status: 403;
        readonly data: z.ZodObject<
          {
            requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            action: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly TIMEOUT: {
        readonly status: 504;
        readonly data: z.ZodObject<
          {
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            operation: z.ZodOptional<z.ZodString>;
            retryable: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >;
      };
      readonly CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: z.ZodObject<
          {
            errorCode: z.ZodOptional<z.ZodString>;
            host: z.ZodOptional<z.ZodString>;
            port: z.ZodOptional<z.ZodNumber>;
            suggestion: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
    }
  >;
  listenBackground: import("@orpc/contract").ProcedureContract<
    z.ZodObject<
      {
        maxResults: z.ZodOptional<z.ZodNumber>;
        lastEventId: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >,
    import("@orpc/contract").Schema<
      AsyncIteratorObject<
        {
          id: string;
          index: number;
          timestamp: number;
        },
        unknown,
        void
      >,
      import("@standard-server/shared").AsyncIteratorClass<
        {
          id: string;
          index: number;
          timestamp: number;
        },
        unknown,
        void
      >
    >,
    {
      readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly data: z.ZodObject<
          {
            apiKeyProvided: z.ZodBoolean;
            provider: z.ZodOptional<z.ZodString>;
            authType: z.ZodOptional<
              z.ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly RATE_LIMITED: {
        readonly status: 429;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodNumber;
            remainingRequests: z.ZodOptional<z.ZodNumber>;
            resetTime: z.ZodOptional<z.ZodString>;
            limitType: z.ZodOptional<
              z.ZodEnum<{
                bandwidth: "bandwidth";
                requests: "requests";
                tokens: "tokens";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodOptional<z.ZodNumber>;
            maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
            estimatedUptime: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly BAD_REQUEST: {
        readonly status: 400;
        readonly data: z.ZodObject<
          {
            invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            validationErrors: z.ZodOptional<
              z.ZodArray<
                z.ZodObject<
                  {
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >
            >;
          },
          z.core.$strip
        >;
      };
      readonly NOT_FOUND: {
        readonly status: 404;
        readonly data: z.ZodObject<
          {
            resource: z.ZodOptional<z.ZodString>;
            resourceId: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly FORBIDDEN: {
        readonly status: 403;
        readonly data: z.ZodObject<
          {
            requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            action: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly TIMEOUT: {
        readonly status: 504;
        readonly data: z.ZodObject<
          {
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            operation: z.ZodOptional<z.ZodString>;
            retryable: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >;
      };
      readonly CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: z.ZodObject<
          {
            errorCode: z.ZodOptional<z.ZodString>;
            host: z.ZodOptional<z.ZodString>;
            port: z.ZodOptional<z.ZodNumber>;
            suggestion: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
    }
  >;
  enqueueBackground: import("@orpc/contract").ProcedureContract<
    z.ZodObject<
      {
        id: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        ok: z.ZodBoolean;
      },
      z.core.$strip
    >,
    {
      readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly data: z.ZodObject<
          {
            apiKeyProvided: z.ZodBoolean;
            provider: z.ZodOptional<z.ZodString>;
            authType: z.ZodOptional<
              z.ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly RATE_LIMITED: {
        readonly status: 429;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodNumber;
            remainingRequests: z.ZodOptional<z.ZodNumber>;
            resetTime: z.ZodOptional<z.ZodString>;
            limitType: z.ZodOptional<
              z.ZodEnum<{
                bandwidth: "bandwidth";
                requests: "requests";
                tokens: "tokens";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodOptional<z.ZodNumber>;
            maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
            estimatedUptime: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly BAD_REQUEST: {
        readonly status: 400;
        readonly data: z.ZodObject<
          {
            invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            validationErrors: z.ZodOptional<
              z.ZodArray<
                z.ZodObject<
                  {
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >
            >;
          },
          z.core.$strip
        >;
      };
      readonly NOT_FOUND: {
        readonly status: 404;
        readonly data: z.ZodObject<
          {
            resource: z.ZodOptional<z.ZodString>;
            resourceId: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly FORBIDDEN: {
        readonly status: 403;
        readonly data: z.ZodObject<
          {
            requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            action: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly TIMEOUT: {
        readonly status: 504;
        readonly data: z.ZodObject<
          {
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            operation: z.ZodOptional<z.ZodString>;
            retryable: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >;
      };
      readonly CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: z.ZodObject<
          {
            errorCode: z.ZodOptional<z.ZodString>;
            host: z.ZodOptional<z.ZodString>;
            port: z.ZodOptional<z.ZodNumber>;
            suggestion: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
    }
  >;
  ping: import("@orpc/contract").ProcedureContract<
    import("@orpc/contract").InitialInputSchema,
    z.ZodObject<
      {
        ok: z.ZodBoolean;
        timestamp: z.ZodNumber;
      },
      z.core.$strip
    >,
    {
      readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly data: z.ZodObject<
          {
            apiKeyProvided: z.ZodBoolean;
            provider: z.ZodOptional<z.ZodString>;
            authType: z.ZodOptional<
              z.ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly RATE_LIMITED: {
        readonly status: 429;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodNumber;
            remainingRequests: z.ZodOptional<z.ZodNumber>;
            resetTime: z.ZodOptional<z.ZodString>;
            limitType: z.ZodOptional<
              z.ZodEnum<{
                bandwidth: "bandwidth";
                requests: "requests";
                tokens: "tokens";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodOptional<z.ZodNumber>;
            maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
            estimatedUptime: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly BAD_REQUEST: {
        readonly status: 400;
        readonly data: z.ZodObject<
          {
            invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            validationErrors: z.ZodOptional<
              z.ZodArray<
                z.ZodObject<
                  {
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >
            >;
          },
          z.core.$strip
        >;
      };
      readonly NOT_FOUND: {
        readonly status: 404;
        readonly data: z.ZodObject<
          {
            resource: z.ZodOptional<z.ZodString>;
            resourceId: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly FORBIDDEN: {
        readonly status: 403;
        readonly data: z.ZodObject<
          {
            requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            action: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly TIMEOUT: {
        readonly status: 504;
        readonly data: z.ZodObject<
          {
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            operation: z.ZodOptional<z.ZodString>;
            retryable: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >;
      };
      readonly CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: z.ZodObject<
          {
            errorCode: z.ZodOptional<z.ZodString>;
            host: z.ZodOptional<z.ZodString>;
            port: z.ZodOptional<z.ZodNumber>;
            suggestion: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
    }
  >;
  useClient: import("@orpc/contract").ProcedureContract<
    z.ZodObject<
      {
        id: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        result: z.ZodString;
        clientType: z.ZodString;
        hasGetDataMethod: z.ZodBoolean;
        hasGetBaseUrlMethod: z.ZodBoolean;
      },
      z.core.$strip
    >,
    {
      readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly data: z.ZodObject<
          {
            apiKeyProvided: z.ZodBoolean;
            provider: z.ZodOptional<z.ZodString>;
            authType: z.ZodOptional<
              z.ZodEnum<{
                apiKey: "apiKey";
                oauth: "oauth";
                token: "token";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly RATE_LIMITED: {
        readonly status: 429;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodNumber;
            remainingRequests: z.ZodOptional<z.ZodNumber>;
            resetTime: z.ZodOptional<z.ZodString>;
            limitType: z.ZodOptional<
              z.ZodEnum<{
                bandwidth: "bandwidth";
                requests: "requests";
                tokens: "tokens";
              }>
            >;
          },
          z.core.$strip
        >;
      };
      readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly data: z.ZodObject<
          {
            retryAfter: z.ZodOptional<z.ZodNumber>;
            maintenanceWindow: z.ZodDefault<z.ZodBoolean>;
            estimatedUptime: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly BAD_REQUEST: {
        readonly status: 400;
        readonly data: z.ZodObject<
          {
            invalidFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            validationErrors: z.ZodOptional<
              z.ZodArray<
                z.ZodObject<
                  {
                    field: z.ZodString;
                    message: z.ZodString;
                    code: z.ZodOptional<z.ZodString>;
                  },
                  z.core.$strip
                >
              >
            >;
          },
          z.core.$strip
        >;
      };
      readonly NOT_FOUND: {
        readonly status: 404;
        readonly data: z.ZodObject<
          {
            resource: z.ZodOptional<z.ZodString>;
            resourceId: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly FORBIDDEN: {
        readonly status: 403;
        readonly data: z.ZodObject<
          {
            requiredPermissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            action: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
      readonly TIMEOUT: {
        readonly status: 504;
        readonly data: z.ZodObject<
          {
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            operation: z.ZodOptional<z.ZodString>;
            retryable: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >;
      };
      readonly CONNECTION_ERROR: {
        readonly status: 502;
        readonly data: z.ZodObject<
          {
            errorCode: z.ZodOptional<z.ZodString>;
            host: z.ZodOptional<z.ZodString>;
            port: z.ZodOptional<z.ZodNumber>;
            suggestion: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >;
      };
    }
  >;
};
export type ContractType = typeof testContract;
