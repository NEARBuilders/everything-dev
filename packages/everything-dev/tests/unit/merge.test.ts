import { describe, expect, it } from "vitest";
import {
  BOS_CONFIG_ORDER,
  mergeBosConfigWithExtends,
  mergeBosConfigWithTemplate,
  rebuildOrderedConfig,
  resolveExtendsRef,
} from "../../src/merge";

describe("mergeBosConfigWithExtends", () => {
  it("child scalars override parent scalars", () => {
    const parent = {
      account: "parent.near",
      domain: "parent.dev",
      repository: "https://github.com/parent",
    };
    const child = { account: "child.near", domain: "child.dev" };
    const merged = mergeBosConfigWithExtends(parent, child);
    expect(merged.account).toBe("child.near");
    expect(merged.domain).toBe("child.dev");
    expect(merged.repository).toBe("https://github.com/parent");
  });

  it("child inherits parent repository when not specified", () => {
    const parent = { account: "parent.near", repository: "https://github.com/parent" };
    const child = { account: "child.near" };
    const merged = mergeBosConfigWithExtends(parent, child);
    expect(merged.repository).toBe("https://github.com/parent");
  });

  it("child inherits parent domain when not specified", () => {
    const parent = { account: "parent.near", domain: "parent.dev" };
    const child = { account: "child.near" };
    const merged = mergeBosConfigWithExtends(parent, child);
    expect(merged.domain).toBe("parent.dev");
  });

  it("deep merges app.api.shared deps", () => {
    const parent = {
      app: {
        api: {
          shared: {
            effect: { version: "3.20.0", singleton: true, strictVersion: false },
            zod: { version: "4.2.0", singleton: true },
          },
        },
      },
    };
    const child = {
      app: {
        api: {
          shared: {
            effect: { version: "3.21.0" },
          },
        },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const api = (merged.app as Record<string, unknown>).api as Record<string, unknown>;
    const shared = api.shared as Record<string, Record<string, unknown>>;
    expect(shared.effect.version).toBe("3.21.0");
    expect(shared.effect.singleton).toBe(true);
    expect(shared.effect.strictVersion).toBe(false);
    expect(shared.zod.version).toBe("4.2.0");
    expect(shared.zod.singleton).toBe(true);
  });

  it("preserves parent deps not in child", () => {
    const parent = {
      app: {
        api: {
          shared: {
            effect: { version: "3.20.0", singleton: true },
            zod: { version: "4.2.0", singleton: true },
            react: { version: "19.0.0", singleton: true },
          },
        },
      },
    };
    const child = {
      app: {
        api: {
          shared: {
            effect: { version: "3.21.0" },
          },
        },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const api = (merged.app as Record<string, unknown>).api as Record<string, unknown>;
    const shared = api.shared as Record<string, Record<string, unknown>>;
    expect(shared.effect.version).toBe("3.21.0");
    expect(shared.zod.version).toBe("4.2.0");
    expect(shared.react.version).toBe("19.0.0");
  });

  it("child can add new deps not in parent", () => {
    const parent = {
      app: {
        api: {
          shared: {
            effect: { version: "3.20.0" },
          },
        },
      },
    };
    const child = {
      app: {
        api: {
          shared: {
            "better-auth": { version: "1.6.9", singleton: true },
          },
        },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const api = (merged.app as Record<string, unknown>).api as Record<string, unknown>;
    const shared = api.shared as Record<string, Record<string, unknown>>;
    expect(shared.effect.version).toBe("3.20.0");
    expect(shared["better-auth"].version).toBe("1.6.9");
  });

  it("uses only child plugin config when child declares same key", () => {
    const parent = {
      plugins: {
        apps: {
          development: "local:plugins/apps",
          production: "https://cdn.example.com/apps",
          variables: { namespace: "parent.near" },
        },
      },
    };
    const child = {
      plugins: {
        apps: {
          variables: { namespace: "child.near" },
          secrets: ["APPS_SECRET"],
        },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const plugins = merged.plugins as Record<string, Record<string, unknown>>;
    expect(plugins.apps.variables).toEqual({ namespace: "child.near" });
    expect(plugins.apps.secrets).toEqual(["APPS_SECRET"]);
    expect(plugins.apps.production).toBeUndefined();
    expect(plugins.apps.development).toBeUndefined();
  });

  it("does not inherit parent plugins not declared by child", () => {
    const parent = {
      plugins: {
        apps: { development: "local:plugins/apps" },
        example: { development: "local:plugins/example" },
      },
    };
    const child = {
      plugins: {
        apps: { variables: { namespace: "child.near" } },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const plugins = merged.plugins as Record<string, Record<string, unknown>>;
    expect(plugins.apps).toBeDefined();
    expect(plugins.example).toBeUndefined();
  });

  it("drops null plugin sentinels without inheriting parent plugins", () => {
    const parent = {
      plugins: {
        apps: { development: "local:plugins/apps" },
        example: { development: "local:plugins/example" },
      },
    };
    const child = {
      plugins: {
        example: null,
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const plugins = merged.plugins as Record<string, unknown>;
    expect(plugins.apps).toBeUndefined();
    expect(plugins.example).toBeUndefined();
  });

  it("child can add new plugins not in parent", () => {
    const parent = {
      plugins: {
        apps: { development: "local:plugins/apps" },
      },
    };
    const child = {
      plugins: {
        myplugin: { development: "local:plugins/myplugin" },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const plugins = merged.plugins as Record<string, Record<string, unknown>>;
    expect(plugins.apps).toBeUndefined();
    expect(plugins.myplugin).toBeDefined();
    expect(plugins.myplugin.development).toBe("local:plugins/myplugin");
  });

  it("secrets arrays are unioned", () => {
    const parent = {
      app: {
        api: {
          secrets: ["DB_URL", "DB_TOKEN"],
        },
      },
    };
    const child = {
      app: {
        api: {
          secrets: ["DB_URL", "EXTRA_SECRET"],
        },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const api = (merged.app as Record<string, Record<string, unknown>>).api as Record<
      string,
      unknown
    >;
    expect(api.secrets).toContain("DB_URL");
    expect(api.secrets).toContain("DB_TOKEN");
    expect(api.secrets).toContain("EXTRA_SECRET");
  });

  it("connectSrc arrays are unioned", () => {
    const parent = {
      plugins: {
        apps: {
          connectSrc: ["wss://relay.damus.io"],
        },
      },
    };
    const child = {
      plugins: {
        apps: {
          connectSrc: ["wss://relay.damus.io", "wss://nos.lol"],
        },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const apps = (merged.plugins as Record<string, Record<string, unknown>>).apps as Record<
      string,
      unknown
    >;
    expect(apps.connectSrc).toContain("wss://relay.damus.io");
    expect(apps.connectSrc).toContain("wss://nos.lol");
  });

  it("routes arrays come only from the child plugin config", () => {
    const parent = {
      plugins: {
        myplugin: {
          routes: ["ui/src/routes/old/**"],
        },
      },
    };
    const child = {
      plugins: {
        myplugin: {
          routes: ["ui/src/routes/new/**"],
        },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const myplugin = (merged.plugins as Record<string, Record<string, unknown>>).myplugin as Record<
      string,
      unknown
    >;
    expect(myplugin.routes).toEqual(["ui/src/routes/new/**"]);
  });

  it("plugin variables come only from the child plugin config", () => {
    const parent = {
      plugins: {
        myplugin: {
          variables: {
            namespace: "parent.near",
            region: "us-east",
            siwn: {
              recipients: {
                mainnet: "parent.near",
              },
            },
          },
        },
      },
    };
    const child = {
      plugins: {
        myplugin: {
          variables: {
            namespace: "child.near",
            trustedOrigins: ["https://everything.dev", "https://*.everything.dev"],
            passkey: {
              rpID: "everything.dev",
              enabled: true,
            },
          },
        },
      },
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const myplugin = (merged.plugins as Record<string, Record<string, unknown>>).myplugin as Record<
      string,
      unknown
    >;
    expect(myplugin.variables).toEqual({
      namespace: "child.near",
      trustedOrigins: ["https://everything.dev", "https://*.everything.dev"],
      passkey: {
        rpID: "everything.dev",
        enabled: true,
      },
    });
  });

  it("child inherits parent plugins when not declared", () => {
    const parent = {
      plugins: {
        apps: { development: "local:plugins/apps" },
        example: { development: "local:plugins/example" },
      },
    };
    const child = { account: "child.near" };
    const merged = mergeBosConfigWithExtends(parent, child);
    const plugins = merged.plugins as Record<string, Record<string, unknown>>;
    expect(plugins.apps).toBeDefined();
    expect(plugins.example).toBeDefined();
    expect(plugins.apps.development).toBe("local:plugins/apps");
  });

  it("child with empty plugins object does not inherit parent plugins", () => {
    const parent = {
      plugins: {
        apps: { development: "local:plugins/apps" },
      },
    };
    const child = {
      plugins: {},
    };
    const merged = mergeBosConfigWithExtends(parent, child);
    const plugins = merged.plugins as Record<string, Record<string, unknown>>;
    expect(plugins).toEqual({});
  });

  it("child with empty plugins object gets no plugins even without parent plugins", () => {
    const parent = {};
    const child = { plugins: {} };
    const merged = mergeBosConfigWithExtends(parent, child);
    const plugins = merged.plugins as Record<string, Record<string, unknown>>;
    expect(plugins).toEqual({});
  });

  it("applies canonical ordering", () => {
    const parent = {
      plugins: {},
      app: {},
      repository: "https://github.com/parent",
      account: "parent.near",
      domain: "parent.dev",
    };
    const child = { account: "child.near" };
    const merged = mergeBosConfigWithExtends(parent, child);
    const keys = Object.keys(merged);
    expect(keys.indexOf("account")).toBeLessThan(keys.indexOf("repository"));
    expect(keys.indexOf("repository")).toBeLessThan(keys.indexOf("app"));
    expect(keys.includes("plugins")).toBe(true);
    expect(keys.includes("shared")).toBe(false);
  });
});

describe("mergeBosConfigWithTemplate", () => {
  it("local values win over template values", () => {
    const local = { account: "local.near", domain: "local.dev" };
    const template = {
      account: "template.near",
      domain: "template.dev",
      repository: "https://github.com/template",
    };
    const merged = mergeBosConfigWithTemplate(local, template);
    expect(merged.account).toBe("local.near");
    expect(merged.domain).toBe("local.dev");
    expect(merged.repository).toBe("https://github.com/template");
  });

  it("new template keys are appended", () => {
    const local = { account: "local.near" };
    const template = { account: "template.near", domain: "template.dev" };
    const merged = mergeBosConfigWithTemplate(local, template);
    expect(merged.account).toBe("local.near");
    expect(merged.domain).toBe("template.dev");
  });

  it("applies canonical ordering", () => {
    const local = { shared: {}, plugins: {}, domain: "local.dev", account: "local.near" };
    const template = { app: {} };
    const merged = mergeBosConfigWithTemplate(local, template);
    const keys = Object.keys(merged);
    expect(keys.indexOf("account")).toBeLessThan(keys.indexOf("domain"));
    expect(keys.indexOf("domain")).toBeLessThan(keys.indexOf("app"));
  });

  it("deep merges app sections", () => {
    const local = { app: { api: { secrets: ["MY_SECRET"] } } };
    const template = { app: { api: { development: "local:api", secrets: ["TEMPLATE_SECRET"] } } };
    const merged = mergeBosConfigWithTemplate(local, template);
    const api = (merged.app as Record<string, Record<string, unknown>>).api as Record<
      string,
      unknown
    >;
    expect(api.development).toBe("local:api");
    expect(api.secrets).toEqual(["MY_SECRET"]);
  });
});

describe("resolveExtendsRef", () => {
  it("returns string extends directly for any env", () => {
    expect(resolveExtendsRef("bos://dev.everything.near/everything.dev", "development")).toBe(
      "bos://dev.everything.near/everything.dev",
    );
    expect(resolveExtendsRef("bos://dev.everything.near/everything.dev", "production")).toBe(
      "bos://dev.everything.near/everything.dev",
    );
  });

  it("selects development URL for development env", () => {
    const extendsObj = { development: "bos://dev.near/dev", production: "bos://dev.near/prod" };
    expect(resolveExtendsRef(extendsObj, "development")).toBe("bos://dev.near/dev");
  });

  it("selects production URL for production env", () => {
    const extendsObj = { development: "bos://dev.near/dev", production: "bos://dev.near/prod" };
    expect(resolveExtendsRef(extendsObj, "production")).toBe("bos://dev.near/prod");
  });

  it("selects staging URL for staging env", () => {
    const extendsObj = {
      development: "bos://dev.near/dev",
      production: "bos://dev.near/prod",
      staging: "bos://dev.near/stage",
    };
    expect(resolveExtendsRef(extendsObj, "staging")).toBe("bos://dev.near/stage");
  });

  it("falls back to production when requested env missing", () => {
    const extendsObj = { production: "bos://dev.near/prod" };
    expect(resolveExtendsRef(extendsObj, "development")).toBe("bos://dev.near/prod");
  });

  it("falls back to first defined value when production also missing", () => {
    const extendsObj = { development: "bos://dev.near/dev" };
    expect(resolveExtendsRef(extendsObj, "production")).toBe("bos://dev.near/dev");
  });

  it("returns undefined for undefined extends", () => {
    expect(resolveExtendsRef(undefined, "development")).toBeUndefined();
  });

  it("returns undefined for empty object", () => {
    expect(resolveExtendsRef({}, "development")).toBeUndefined();
  });
});

describe("rebuildOrderedConfig", () => {
  it("places extends first, then scalars, then app/plugins", () => {
    const config = {
      plugins: {},
      domain: "test.dev",
      app: {},
      account: "test.near",
      extends: "bos://test/test",
    };
    const ordered = rebuildOrderedConfig(config);
    const keys = Object.keys(ordered);
    expect(keys[0]).toBe("extends");
    expect(keys[1]).toBe("account");
    expect(keys[2]).toBe("domain");
    expect(keys[keys.length - 2]).toBe("app");
    expect(keys[keys.length - 1]).toBe("plugins");
  });

  it("handles missing sections", () => {
    const config = { account: "test.near" };
    const ordered = rebuildOrderedConfig(config);
    expect(Object.keys(ordered)).toEqual(["account"]);
  });

  it("unknown keys go after known keys", () => {
    const config = { custom: true, account: "test.near", app: {} };
    const ordered = rebuildOrderedConfig(config);
    const keys = Object.keys(ordered);
    expect(keys.indexOf("account")).toBeLessThan(keys.indexOf("custom"));
    expect(keys.indexOf("app")).toBeLessThan(keys.indexOf("custom"));
  });
});

describe("BOS_CONFIG_ORDER", () => {
  it("has extends first", () => {
    expect(BOS_CONFIG_ORDER[0]).toBe("extends");
  });

  it("has app and plugins at end in order", () => {
    const len = BOS_CONFIG_ORDER.length;
    expect(BOS_CONFIG_ORDER[len - 2]).toBe("app");
    expect(BOS_CONFIG_ORDER[len - 1]).toBe("plugins");
  });

  it("includes all expected fields", () => {
    expect(BOS_CONFIG_ORDER).toContain("extends");
    expect(BOS_CONFIG_ORDER).toContain("account");
    expect(BOS_CONFIG_ORDER).toContain("domain");
    expect(BOS_CONFIG_ORDER).toContain("testnet");
    expect(BOS_CONFIG_ORDER).toContain("staging");
    expect(BOS_CONFIG_ORDER).toContain("repository");
    expect(BOS_CONFIG_ORDER).toContain("app");
    expect(BOS_CONFIG_ORDER).toContain("plugins");
  });
});
