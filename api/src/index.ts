import { createPlugin } from "every-plugin";
import { Cause, Effect, Exit, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { contract } from "./contract";
import { DatabaseLive } from "./db/layer";
import { RegistryConfigService } from "./services/fastkv";
import { KvService, KvServiceLive } from "./services/kv";
import { ProjectService, ProjectServiceLive } from "./services/projects";
import {
  getRegistryApp,
  getRegistryAppByHost,
  getRegistryAppsByAccount,
  getRegistryRelaySender,
  getRegistryStatus,
  listRegistryApps,
  prepareRegistryMetadataWrite,
  relayRegistryMetadataWrite,
} from "./services/registry";

type Auth = any;

// Extended context with unified identity model
export interface AuthContext {
  // Core identity - always present for authenticated users
  userId: string;
  user: {
    id: string;
    role?: string;
    email?: string;
    name?: string;
  };

  // Public identity (NEAR) - optional, user selects active account
  nearAccountId?: string;

  // Organization context
  organizationId?: string;
  organizationRole?: string;

  // Request utilities
  reqHeaders?: Headers;

  // Server capabilities
  auth: Auth;
}

export default createPlugin({
  variables: z.object({
    registryNamespace: z.string().optional(),
  }),

  secrets: z.object({
    API_DATABASE_URL: z.string().default("file:./api.db"),
    API_DATABASE_AUTH_TOKEN: z.string().optional(),
    REGISTRY_RELAY_ACCOUNT_ID: z.string().optional(),
    REGISTRY_RELAY_PRIVATE_KEY: z.string().optional(),
    REGISTRY_RELAY_NETWORK: z.enum(["mainnet", "testnet"]).optional(),
  }),

  context: z.object({
    // Core identity - unified user model
    userId: z.string().optional(),
    user: z
      .object({
        id: z.string(),
        role: z.string().optional(),
        email: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),

    // Public identity (NEAR) - optional capability
    nearAccountId: z.string().optional(),
    nearAccounts: z
      .array(
        z.object({
          accountId: z.string(),
          network: z.string(),
          isPrimary: z.boolean(),
        }),
      )
      .optional(),

    // Organization context
    organizationId: z.string().optional(),
    organizationRole: z.string().optional(),

    // Request utilities
    reqHeaders: z.custom<Headers>().optional(),
    getRawBody: z.custom<() => Promise<string>>().optional(),

    // Server capabilities
    auth: z.custom<Auth>().optional(),
  }),

  contract,

  initialize: (config) =>
    Effect.gen(function* () {
      const Database = DatabaseLive(
        config.secrets.API_DATABASE_URL,
        config.secrets.API_DATABASE_AUTH_TOKEN,
      );

      const KvServices = KvServiceLive.pipe(Layer.provide(Database));
      const ProjectServices = ProjectServiceLive.pipe(Layer.provide(Database));
      const RegistryConfig = RegistryConfigService.Live(config.variables.registryNamespace);

      const AllServices = Layer.merge(Layer.merge(KvServices, ProjectServices), RegistryConfig);

      const [kv, project, registryConfig] = yield* Effect.provide(
        Effect.all([KvService, ProjectService, RegistryConfigService]),
        AllServices,
      );

      console.log("[API] Services Initialized");
      return { kv, project, registryConfig };
    }),

  shutdown: () => Effect.log("[API] Shutdown"),

  createRouter: (services, builder) => {
    // Generic auth - requires valid user session (any auth method)
    const requireAuth = builder.middleware(async ({ context, next }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: {
            authType: "session",
            hint: "Sign in with NEAR, passkey, email, phone, or anonymous",
          },
        });
      }
      return next({
        context: {
          userId: context.userId,
          user: context.user,
          nearAccountId: context.nearAccountId,
          organizationId: context.organizationId,
          organizationRole: context.organizationRole,
          reqHeaders: context.reqHeaders,
          auth: context.auth!,
        } as AuthContext,
      });
    });

    // NEAR-specific - requires linked NEAR wallet
    const requireNearAccount = builder.middleware(async ({ context, next }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { authType: "session" },
        });
      }

      if (!context.nearAccountId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "NEAR wallet required",
          data: {
            authType: "near",
            hint: "Link a NEAR wallet to perform this action",
          },
        });
      }

      return next({
        context: {
          userId: context.userId,
          user: context.user,
          nearAccountId: context.nearAccountId,
          reqHeaders: context.reqHeaders,
          auth: context.auth!,
        } as AuthContext,
      });
    });

    // Organization role check - requires membership with specific role
    const requireOrgRole = (requiredRole: "owner" | "admin" | "member") =>
      builder.middleware(async ({ context, next }, input: any) => {
        if (!context.user || !context.userId) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "Authentication required",
            data: { authType: "session" },
          });
        }

        // Get organizationId from input (for endpoints that have it)
        const targetOrgId = input?.organizationId || context.organizationId;

        if (!targetOrgId) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Organization ID required",
            data: {},
          });
        }

        let member: any;
        try {
          const result = await context.auth!.api.getActiveMember({
            headers: context.reqHeaders!,
            query: { organizationId: targetOrgId },
          });
          member = result;
        } catch {
          throw new ORPCError("FORBIDDEN", {
            message: "You are not a member of this organization",
            data: {},
          });
        }

        if (!member) {
          throw new ORPCError("FORBIDDEN", {
            message: "You are not a member of this organization",
            data: {},
          });
        }

        const userRole = member.role as string;

        const roleHierarchy: Record<string, number> = {
          owner: 100,
          admin: 80,
          member: 50,
        };

        const userRoleLevel = roleHierarchy[userRole] ?? 0;
        const requiredRoleLevel = roleHierarchy[requiredRole] ?? 0;

        if (userRoleLevel < requiredRoleLevel) {
          throw new ORPCError("FORBIDDEN", {
            message: `Requires ${requiredRole} role in organization`,
            data: {
              requiredRole,
              currentRole: userRole,
            },
          });
        }

        return next({
          context: {
            userId: context.userId,
            user: context.user,
            nearAccountId: context.nearAccountId,
            organizationId: targetOrgId,
            organizationRole: userRole,
            reqHeaders: context.reqHeaders,
            auth: context.auth!,
          } as AuthContext,
        });
      });

    return {
      ping: builder.ping.handler(async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
      })),

      listRegistryApps: builder.listRegistryApps.handler(async ({ input }) => {
        return await listRegistryApps(input, services.registryConfig);
      }),

      getRegistryAppsByAccount: builder.getRegistryAppsByAccount.handler(async ({ input }) => {
        const result = await getRegistryAppsByAccount(input.accountId, services.registryConfig);

        return result;
      }),

      getRegistryApp: builder.getRegistryApp.handler(async ({ input, errors }) => {
        const result = await getRegistryApp(
          input.accountId,
          input.gatewayId,
          services.registryConfig,
        );
        if (!result) {
          throw errors.NOT_FOUND({
            message: "Published app not found",
            data: {
              resource: "published-app",
              resourceId: `${input.accountId}/${input.gatewayId}`,
            },
          });
        }

        return { data: result };
      }),

      getRegistryAppByHost: builder.getRegistryAppByHost.handler(async ({ input, errors }) => {
        const result = await getRegistryAppByHost(input.hostUrl, services.registryConfig);
        if (!result) {
          throw errors.NOT_FOUND({
            message: "Published app not found for host",
            data: {
              resource: "published-app-host",
              resourceId: input.hostUrl,
            },
          });
        }

        return { data: result };
      }),

      getRegistryStatus: builder.getRegistryStatus.handler(async () => {
        return getRegistryStatus(services.registryConfig);
      }),

      prepareRegistryMetadataWrite: builder.prepareRegistryMetadataWrite.handler(
        async ({ input }) => {
          return { data: prepareRegistryMetadataWrite(input, services.registryConfig) };
        },
      ),

      relayRegistryMetadataWrite: builder.relayRegistryMetadataWrite
        .use(requireNearAccount)
        .handler(async ({ input, context, errors }) => {
          try {
            const senderId = getRegistryRelaySender(input.payload);

            if (context.nearAccountId && senderId !== context.nearAccountId) {
              throw errors.FORBIDDEN({
                message: "Signed delegate payload does not match your linked NEAR account",
                data: { action: "relay" },
              });
            }

            const result = await relayRegistryMetadataWrite(input.payload, services.registryConfig);

            return { data: result };
          } catch (error) {
            if (error instanceof ORPCError) {
              throw error;
            }

            throw errors.BAD_REQUEST({
              message: error instanceof Error ? error.message : "Failed to relay metadata write",
              data: {},
            });
          }
        }),

      // Auth health check - shows email/SMS configuration status
      authHealth: builder.authHealth.use(requireAuth).handler(async () => ({
        status: "ok",
        emailConfigured: !!process.env.EMAIL_PROVIDER,
        smsConfigured: !!process.env.SMS_PROVIDER,
      })),

      // KV endpoints - any auth method
      listKeys: builder.listKeys.use(requireAuth).handler(async ({ input, context }) => {
        const exit = await Effect.runPromiseExit(
          services.kv.listKeys(context.userId, input.limit, input.offset),
        );

        if (Exit.isFailure(exit)) {
          const squashed = Cause.squash(exit.cause);
          if (squashed instanceof ORPCError) {
            throw squashed;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: squashed instanceof Error ? squashed.message : String(squashed),
            data: {
              originalError: squashed instanceof Error ? squashed.message : String(squashed),
            },
          });
        }

        return exit.value;
      }),

      getValue: builder.getValue.use(requireAuth).handler(async ({ input, context, errors }) => {
        const exit = await Effect.runPromiseExit(services.kv.getValue(input.key, context.userId));

        if (Exit.isFailure(exit)) {
          const squashed = Cause.squash(exit.cause);
          if (squashed instanceof ORPCError) {
            if (squashed.code === "NOT_FOUND") {
              throw errors.NOT_FOUND({
                message: "Key not found",
                data: { resource: "kv", resourceId: input.key },
              });
            }
            if (squashed.code === "FORBIDDEN") {
              throw errors.FORBIDDEN({
                message: "Access denied",
                data: { action: "read" },
              });
            }
            throw squashed;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: squashed instanceof Error ? squashed.message : String(squashed),
            data: {
              originalError: squashed instanceof Error ? squashed.message : String(squashed),
            },
          });
        }

        return exit.value;
      }),

      setValue: builder.setValue.use(requireAuth).handler(async ({ input, context, errors }) => {
        const exit = await Effect.runPromiseExit(
          services.kv.setValue(input.key, input.value, context.userId),
        );

        if (Exit.isFailure(exit)) {
          const squashed = Cause.squash(exit.cause);
          if (squashed instanceof ORPCError) {
            if (squashed.code === "FORBIDDEN") {
              throw errors.FORBIDDEN({
                message: "Access denied",
                data: { action: "write" },
              });
            }
            throw squashed;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: squashed instanceof Error ? squashed.message : String(squashed),
            data: {
              originalError: squashed instanceof Error ? squashed.message : String(squashed),
            },
          });
        }

        return exit.value;
      }),

      deleteKey: builder.deleteKey.use(requireAuth).handler(async ({ input, context, errors }) => {
        const exit = await Effect.runPromiseExit(services.kv.deleteKey(input.key, context.userId));

        if (Exit.isFailure(exit)) {
          const squashed = Cause.squash(exit.cause);
          if (squashed instanceof ORPCError) {
            if (squashed.code === "NOT_FOUND") {
              throw errors.NOT_FOUND({
                message: "Key not found",
                data: { resource: "kv", resourceId: input.key },
              });
            }
            if (squashed.code === "FORBIDDEN") {
              throw errors.FORBIDDEN({
                message: "Access denied",
                data: { action: "delete" },
              });
            }
            throw squashed;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: squashed instanceof Error ? squashed.message : String(squashed),
            data: {
              originalError: squashed instanceof Error ? squashed.message : String(squashed),
            },
          });
        }

        return exit.value;
      }),

      publicError: builder.publicError.handler(() => {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Test UNAUTHORIZED error - thrown directly from handler",
          data: {
            provider: "test-provider",
            action: "test-action",
            timestamp: new Date().toISOString(),
          },
        });
      }),

      protectedError: builder.protectedError.use(requireAuth).handler(() => {
        throw new ORPCError("NOT_FOUND", {
          message: "Test NOT_FOUND error - thrown after auth middleware",
          data: {
            resource: "test-resource",
            resourceId: "test-id-123",
            timestamp: new Date().toISOString(),
          },
        });
      }),

      // API Keys - via Better Auth API
      listApiKeys: builder.listApiKeys.use(requireAuth).handler(async ({ context, input }) => {
        const result = await context.auth.api.listApiKeys({
          query: {
            organizationId: input.organizationId,
          },
          headers: context.reqHeaders!,
        });

        if (!result) {
          return { keys: [] };
        }

        return {
          keys: (Array.isArray(result) ? result : result.keys || []).map((key: any) => ({
            id: key.id,
            name: key.name || "Unnamed",
            prefix: key.prefix || "api_",
            permissions: key.permissions ? JSON.parse(key.permissions) : [],
            lastUsed: key.lastRequest ? new Date(key.lastRequest).toISOString() : null,
            createdAt: new Date(key.createdAt).toISOString(),
            expiresAt: key.expiresAt ? new Date(key.expiresAt).toISOString() : null,
          })),
        };
      }),

      createApiKey: builder.createApiKey
        .use(requireAuth)
        .handler(async ({ context, input, errors }) => {
          try {
            const result = await context.auth.api.createApiKey({
              body: {
                name: input.name,
                organizationId: input.organizationId,
                expiresIn: input.expiresInDays ? input.expiresInDays * 24 * 60 * 60 : undefined,
                permissions: input.permissions ? JSON.stringify(input.permissions) : undefined,
              },
              headers: context.reqHeaders!,
            });

            if (!result) {
              throw errors.BAD_REQUEST({
                message: "Failed to create API key",
                data: {},
              });
            }

            return {
              id: result.id,
              name: result.name || input.name,
              key: result.key || result.start || "",
              prefix: result.prefix || "api_",
              permissions: input.permissions || ["read"],
              createdAt: new Date(result.createdAt).toISOString(),
              expiresAt: result.expiresAt ? new Date(result.expiresAt).toISOString() : null,
            };
          } catch (error) {
            throw errors.BAD_REQUEST({
              message: error instanceof Error ? error.message : "Failed to create API key",
              data: {},
            });
          }
        }),

      deleteApiKey: builder.deleteApiKey
        .use(requireAuth)
        .handler(async ({ context, input, errors }) => {
          try {
            await context.auth.api.deleteApiKey({
              body: {
                id: input.keyId,
              },
              headers: context.reqHeaders!,
            });

            return { deleted: true };
          } catch (error) {
            throw errors.NOT_FOUND({
              message: error instanceof Error ? error.message : "API key not found",
              data: {},
            });
          }
        }),

      // Organization Members - via Better Auth API
      listOrgMembers: builder.listOrgMembers
        .use(requireOrgRole("member"))
        .handler(async ({ context, input }) => {
          const result = await context.auth.api.listMembers({
            query: { organizationId: input.organizationId },
            headers: context.reqHeaders!,
          });

          const members = Array.isArray(result) ? result : (result?.members ?? []);

          return {
            members: members.map((m: any) => ({
              id: m.id,
              userId: m.userId,
              role: m.role as "owner" | "admin" | "member",
              name: m.user?.name || null,
              email: m.user?.email || null,
              createdAt: new Date(m.createdAt).toISOString(),
            })),
          };
        }),

      // Organization Invitations - via Better Auth API
      listOrgInvitations: builder.listOrgInvitations
        .use(requireOrgRole("member"))
        .handler(async ({ context, input }) => {
          const result = await context.auth.api.listInvitations({
            query: { organizationId: input.organizationId },
            headers: context.reqHeaders!,
          });

          const invitations = Array.isArray(result) ? result : [];

          return {
            invitations: invitations.map((inv: any) => ({
              id: inv.id,
              email: inv.email,
              role: inv.role as "admin" | "member",
              status: inv.status as "pending" | "accepted" | "rejected" | "expired",
              expiresAt: new Date(inv.expiresAt).toISOString(),
              createdAt: new Date(inv.createdAt).toISOString(),
            })),
          };
        }),

      // Cancel invitation - via Better Auth API
      cancelInvitation: builder.cancelInvitation
        .use(requireOrgRole("admin"))
        .handler(async ({ context, input, errors }) => {
          try {
            await context.auth.api.cancelInvitation({
              body: { invitationId: input.invitationId },
              headers: context.reqHeaders!,
            });

            return { cancelled: true };
          } catch (error) {
            throw errors.NOT_FOUND({
              message: error instanceof Error ? error.message : "Invitation not found",
              data: {},
            });
          }
        }),

      // Resend invitation - requires admin role
      resendInvitation: builder.resendInvitation
        .use(requireOrgRole("admin"))
        .handler(async ({ context, input, errors }) => {
          try {
            await context.auth.api.cancelInvitation({
              body: { invitationId: input.invitationId },
              headers: context.reqHeaders!,
            });
          } catch {
            throw errors.NOT_FOUND({
              message: "Invitation not found",
              data: {},
            });
          }

          return { sent: true };
        }),

      // Projects
      listProjects: builder.listProjects.handler(async ({ input }) => {
        const exit = await Effect.runPromiseExit(services.project.listProjects(input));

        if (Exit.isFailure(exit)) {
          const squashed = Cause.squash(exit.cause);
          if (squashed instanceof ORPCError) {
            throw squashed;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: squashed instanceof Error ? squashed.message : String(squashed),
          });
        }

        return exit.value;
      }),

      getProject: builder.getProject.handler(async ({ input, errors }) => {
        const exit = await Effect.runPromiseExit(services.project.getProject(input.id));

        if (Exit.isFailure(exit)) {
          const squashed = Cause.squash(exit.cause);
          if (squashed instanceof ORPCError) {
            throw squashed;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: squashed instanceof Error ? squashed.message : String(squashed),
          });
        }

        if (!exit.value) {
          throw errors.NOT_FOUND({
            message: "Project not found",
            data: { resource: "project", resourceId: input.id },
          });
        }

        return { data: exit.value };
      }),

      createProject: builder.createProject.use(requireAuth).handler(async ({ input, context }) => {
        const exit = await Effect.runPromiseExit(
          services.project.createProject(input, context.userId),
        );

        if (Exit.isFailure(exit)) {
          const squashed = Cause.squash(exit.cause);
          if (squashed instanceof ORPCError) {
            throw squashed;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: squashed instanceof Error ? squashed.message : String(squashed),
          });
        }

        return exit.value;
      }),

      updateProject: builder.updateProject
        .use(requireAuth)
        .handler(async ({ input, context, errors }) => {
          const exit = await Effect.runPromiseExit(
            services.project.updateProject(input.id, input, context.userId),
          );

          if (Exit.isFailure(exit)) {
            const squashed = Cause.squash(exit.cause);
            if (squashed instanceof ORPCError) {
              if (squashed.code === "NOT_FOUND") {
                throw errors.NOT_FOUND({
                  message: "Project not found",
                  data: { resource: "project", resourceId: input.id },
                });
              }
              throw squashed;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: squashed instanceof Error ? squashed.message : String(squashed),
            });
          }

          return exit.value;
        }),

      deleteProject: builder.deleteProject
        .use(requireAuth)
        .handler(async ({ input, context, errors }) => {
          const exit = await Effect.runPromiseExit(
            services.project.deleteProject(input.id, context.userId),
          );

          if (Exit.isFailure(exit)) {
            const squashed = Cause.squash(exit.cause);
            if (squashed instanceof ORPCError) {
              if (squashed.code === "NOT_FOUND") {
                throw errors.NOT_FOUND({
                  message: "Project not found",
                  data: { resource: "project", resourceId: input.id },
                });
              }
              throw squashed;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: squashed instanceof Error ? squashed.message : String(squashed),
            });
          }

          return exit.value;
        }),

      listProjectApps: builder.listProjectApps.handler(async ({ input }) => {
        const exit = await Effect.runPromiseExit(services.project.listProjectApps(input.projectId));

        if (Exit.isFailure(exit)) {
          const squashed = Cause.squash(exit.cause);
          if (squashed instanceof ORPCError) {
            throw squashed;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: squashed instanceof Error ? squashed.message : String(squashed),
          });
        }

        return { data: exit.value };
      }),

      linkAppToProject: builder.linkAppToProject
        .use(requireAuth)
        .handler(async ({ input, context, errors }) => {
          const exit = await Effect.runPromiseExit(
            services.project.linkAppToProject(
              input.projectId,
              input.accountId,
              input.gatewayId,
              context.userId,
            ),
          );

          if (Exit.isFailure(exit)) {
            const squashed = Cause.squash(exit.cause);
            if (squashed instanceof ORPCError) {
              if (squashed.code === "NOT_FOUND") {
                throw errors.NOT_FOUND({
                  message: "Project not found",
                  data: { resource: "project", resourceId: input.projectId },
                });
              }
              throw squashed;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: squashed instanceof Error ? squashed.message : String(squashed),
            });
          }

          return exit.value;
        }),

      unlinkAppFromProject: builder.unlinkAppFromProject
        .use(requireAuth)
        .handler(async ({ input, context, errors }) => {
          const exit = await Effect.runPromiseExit(
            services.project.unlinkAppFromProject(
              input.projectId,
              input.accountId,
              input.gatewayId,
              context.userId,
            ),
          );

          if (Exit.isFailure(exit)) {
            const squashed = Cause.squash(exit.cause);
            if (squashed instanceof ORPCError) {
              if (squashed.code === "NOT_FOUND") {
                throw errors.NOT_FOUND({
                  message: "Project or app not found",
                  data: { resource: "project-app" },
                });
              }
              throw squashed;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: squashed instanceof Error ? squashed.message : String(squashed),
            });
          }

          return exit.value;
        }),

      listProjectsForApp: builder.listProjectsForApp.handler(async ({ input }) => {
        const exit = await Effect.runPromiseExit(
          services.project.listProjectsForApp(input.accountId, input.gatewayId),
        );

        if (Exit.isFailure(exit)) {
          const squashed = Cause.squash(exit.cause);
          if (squashed instanceof ORPCError) {
            throw squashed;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: squashed instanceof Error ? squashed.message : String(squashed),
          });
        }

        return { data: exit.value };
      }),
    };
  },
});
