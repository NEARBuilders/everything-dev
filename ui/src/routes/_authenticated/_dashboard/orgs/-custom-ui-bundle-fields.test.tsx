// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyTenantConfigDraft, type TenantConfigDraft } from "@/app";
import { CustomUiBundleFields } from "./-custom-ui-bundle-fields";

const harness = vi.hoisted(() => ({
  getRegistryApp: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/app", async () => {
  const actual = await vi.importActual<typeof import("@/app")>("@/app");
  return {
    ...actual,
    useApiClient: () => ({ registry: { getRegistryApp: harness.getRegistryApp } }),
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => harness.toastError(...args),
    success: (...args: unknown[]) => harness.toastSuccess(...args),
  },
}));

let latestDraft: TenantConfigDraft = emptyTenantConfigDraft;

function Harness({ allowSsr, disabled = false }: { allowSsr: boolean; disabled?: boolean }) {
  const [draft, setDraft] = useState<TenantConfigDraft>(emptyTenantConfigDraft);
  latestDraft = draft;
  return (
    <CustomUiBundleFields
      idPrefix="test-bundle"
      draft={draft}
      setDraft={setDraft}
      allowSsr={allowSsr}
      disabled={disabled}
      gatewayId="citynode.app"
    />
  );
}

function publishedConfig(ui: Record<string, string>) {
  return { data: { resolvedConfig: { app: { ui } } } };
}

function input(id: string) {
  return screen.getByTestId(id) as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  latestDraft = emptyTenantConfigDraft;
});

describe("CustomUiBundleFields", () => {
  it("fills the four bundle fields from a deployed app", async () => {
    harness.getRegistryApp.mockResolvedValue(
      publishedConfig({
        production: "https://cdn.example.com/chi/ui/",
        integrity: "sha384-UIHASH",
        ssr: "https://cdn.example.com/chi/ssr/",
        ssrIntegrity: "sha384-SSRHASH",
      }),
    );
    render(<Harness allowSsr />);

    fireEvent.change(input("test-bundle-source-account"), { target: { value: "  chi-app.near " } });
    fireEvent.click(screen.getByTestId("test-bundle-autofill"));

    await waitFor(() =>
      expect(input("test-bundle-ui-url").value).toBe("https://cdn.example.com/chi/ui/"),
    );
    expect(harness.getRegistryApp).toHaveBeenCalledWith({
      accountId: "chi-app.near",
      gatewayId: "citynode.app",
    });
    expect(input("test-bundle-ui-integrity").value).toBe("sha384-UIHASH");
    expect(input("test-bundle-ssr-url").value).toBe("https://cdn.example.com/chi/ssr/");
    expect(input("test-bundle-ssr-integrity").value).toBe("sha384-SSRHASH");
    expect(harness.toastSuccess).toHaveBeenCalledWith(
      "Bundle and integrity filled from chi-app.near",
    );
  });

  it("omits the SSR fields and leaves SSR values unset when SSR is not allowed", async () => {
    harness.getRegistryApp.mockResolvedValue(
      publishedConfig({
        production: "https://cdn.example.com/chi/ui/",
        integrity: "sha384-UIHASH",
        ssr: "https://cdn.example.com/chi/ssr/",
        ssrIntegrity: "sha384-SSRHASH",
      }),
    );
    render(<Harness allowSsr={false} />);

    expect(screen.queryByTestId("test-bundle-ssr-url")).toBeNull();
    expect(screen.queryByTestId("test-bundle-ssr-integrity")).toBeNull();

    fireEvent.change(input("test-bundle-source-account"), { target: { value: "chi-app.near" } });
    fireEvent.click(screen.getByTestId("test-bundle-autofill"));

    await waitFor(() => expect(input("test-bundle-ui-integrity").value).toBe("sha384-UIHASH"));
    expect(latestDraft.ssrUrl).toBe("");
    expect(latestDraft.ssrIntegrity).toBe("");
  });

  it("explains when the deployed app publishes no custom UI bundle", async () => {
    harness.getRegistryApp.mockResolvedValue(publishedConfig({}));
    render(<Harness allowSsr />);

    fireEvent.change(input("test-bundle-source-account"), { target: { value: "empty.near" } });
    fireEvent.click(screen.getByTestId("test-bundle-autofill"));

    await waitFor(() =>
      expect(harness.toastError).toHaveBeenCalledWith(
        "empty.near publishes no custom UI bundle yet — run `bos deploy` in the app repo with a local UI first.",
      ),
    );
    expect(input("test-bundle-ui-url").value).toBe("");
  });

  it("asks for an account before fetching", () => {
    render(<Harness allowSsr />);

    fireEvent.click(screen.getByTestId("test-bundle-autofill"));

    expect(harness.toastError).toHaveBeenCalledWith(
      "Enter the NEAR account your app deployed under",
    );
    expect(harness.getRegistryApp).not.toHaveBeenCalled();
  });

  it("disables every control when disabled", () => {
    render(<Harness allowSsr disabled />);

    for (const id of [
      "test-bundle-source-account",
      "test-bundle-autofill",
      "test-bundle-ui-url",
      "test-bundle-verify",
      "test-bundle-ui-integrity",
      "test-bundle-ssr-url",
      "test-bundle-verify-ssr",
      "test-bundle-ssr-integrity",
    ]) {
      expect((screen.getByTestId(id) as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
    }
  });
});
