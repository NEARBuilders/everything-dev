import * as fs from "node:fs";
import * as path from "node:path";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Context, Effect, Layer } from "every-plugin/effect";
import * as schema from "../db/schema/auth";
import { getPlugins } from "./auth-plugins";
import { ConfigService } from "./config";
import { DatabaseService } from "./database";

// Dev preview directory for email/SMS
const DEV_PREVIEW_DIR = path.join(process.cwd(), ".dev-preview");
const EMAIL_PREVIEW_FILE = path.join(DEV_PREVIEW_DIR, "emails.jsonl");
const SMS_PREVIEW_FILE = path.join(DEV_PREVIEW_DIR, "sms.jsonl");

// Ensure dev preview directory exists
function ensureDevPreviewDir() {
  if (!fs.existsSync(DEV_PREVIEW_DIR)) {
    fs.mkdirSync(DEV_PREVIEW_DIR, { recursive: true });
  }
}

// Email sending function - dev preview mode
async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) {
  ensureDevPreviewDir();

  const entry = {
    type: "email",
    timestamp: new Date().toISOString(),
    to,
    subject,
    text,
    html,
    previewUrl: null as string | null,
  };

  // Append to preview log
  fs.appendFileSync(EMAIL_PREVIEW_FILE, `${JSON.stringify(entry)}\n`);

  // Also log to console for visibility
  console.log(`\n📧 [Email Preview] ============================================`);
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`----------------------------------------------------------------`);
  console.log(text);
  console.log(`================================================================\n`);

  // In production, integrate with your email provider:
  // Example: await resend.emails.send({ to, subject, text, html });
}

// SMS sending function - dev preview mode
async function sendSMS({ phoneNumber, code }: { phoneNumber: string; code: string }) {
  ensureDevPreviewDir();

  const entry = {
    type: "sms",
    timestamp: new Date().toISOString(),
    phoneNumber,
    code,
    message: `Your verification code is: ${code}`,
  };

  // Append to preview log
  fs.appendFileSync(SMS_PREVIEW_FILE, `${JSON.stringify(entry)}\n`);

  // Also log to console for visibility
  console.log(`\n📱 [SMS Preview] ================================================`);
  console.log(`To: ${phoneNumber}`);
  console.log(`Code: ${code}`);
  console.log(`Message: Your verification code is: ${code}`);
  console.log(`================================================================\n`);

  // In production, integrate with your SMS provider:
  // Example: await twilioClient.messages.create({ to: phoneNumber, body: `Your code: ${code}` });
}

// Helper to create personal organization for a user
async function createPersonalOrganization(
  database: any,
  user: { id: string; name?: string; email?: string; isAnonymous?: boolean },
) {
  if (user.isAnonymous) {
    return null;
  }

  // Check if user already has a personal organization
  const existingOrg = await database.query.organization.findFirst({
    where: (org: any, { eq, and }: any) =>
      and(eq(org.slug, user.id), eq(org.metadata, JSON.stringify({ isPersonal: true }))),
  });

  if (existingOrg) {
    return existingOrg;
  }

  // Create personal organization
  const personalOrg = await database
    .insert(schema.organization)
    .values({
      id: crypto.randomUUID(),
      name: user.name || "My Organization",
      slug: user.id,
      logo: null,
      metadata: JSON.stringify({ isPersonal: true }),
      createdAt: new Date(),
    })
    .returning()
    .get();

  // Create owner membership
  await database.insert(schema.member).values({
    id: crypto.randomUUID(),
    userId: user.id,
    organizationId: personalOrg.id,
    role: "owner",
    createdAt: new Date(),
  });

  console.log(`[Auth] Created personal organization ${personalOrg.id} for user ${user.id}`);
  return personalOrg;
}

export const createAuth = Effect.gen(function* () {
  const config = yield* ConfigService;
  const db = yield* DatabaseService;

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: schema,
    }),
    trustedOrigins: process.env.CORS_ORIGIN?.split(",") || ["*"],
    secret: process.env.BETTER_AUTH_SECRET || "default-secret-change-in-production",
    baseURL:
      process.env.BETTER_AUTH_URL ||
      (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : undefined),
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
    },
    plugins: getPlugins({
      account: config.account,
      baseUrl: process.env.BETTER_AUTH_URL || "http://localhost:3000",
      sendEmail,
      sendSMS,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }, _request) => {
        void sendEmail({
          to: user.email,
          subject: "Reset your password",
          text: `Click the link to reset your password: ${url}`,
        });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }, _request) => {
        void sendEmail({
          to: user.email,
          subject: "Verify your email address",
          text: `Click the link to verify your email: ${url}`,
        });
      },
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      async afterEmailVerification(user, _request) {
        console.log(`${user.email} has been successfully verified!`);
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const userData = user as typeof schema.user.$inferInsert & { isAnonymous?: boolean };
            if (!userData.isAnonymous) {
              await createPersonalOrganization(db, user);
            }
          },
        },
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["siwn", "email-password"],
        allowDifferentEmails: true,
        updateUserInfoOnLink: true,
      },
    },
    session: {
      cookieCache: {
        enabled: process.env.NODE_ENV === "production",
        maxAge: 5 * 60, // 5 minutes cache - reduces DB hits
      },
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
      },
    },
  });
});

// Use any for Auth type to avoid complex type inference issues with plugins
// The actual auth instance has all plugin methods at runtime
export type Auth = any;

export class AuthService extends Context.Tag("host/AuthService")<AuthService, Auth>() {
  static Default = Layer.effect(AuthService, createAuth);
}
