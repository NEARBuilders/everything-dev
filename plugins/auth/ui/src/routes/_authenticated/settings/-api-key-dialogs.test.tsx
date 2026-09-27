// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeyCreateDialog } from "./-api-key-create-dialog";
import { ApiKeyRevealDialog } from "./-api-key-reveal-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("API key dialogs", () => {
  it("creates a key with a trimmed name and no expiry by default", () => {
    const onCreate = vi.fn();
    render(
      <ApiKeyCreateDialog open onOpenChange={vi.fn()} onCreate={onCreate} isPending={false} />,
    );

    const submit = screen.getByRole("button", { name: "Create key" });
    expect(submit).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Claude desktop  " } });
    fireEvent.click(submit);

    expect(onCreate).toHaveBeenCalledWith({ name: "Claude desktop", expiresIn: undefined });
  });

  it("shows the full secret once and dismisses on done", () => {
    const onDismiss = vi.fn();
    render(
      <ApiKeyRevealDialog
        apiKey={{
          id: "key-1",
          name: "Scripts",
          prefix: "edk_",
          start: "edk_ab",
          key: "edk_secret_value",
          createdAt: new Date(),
        }}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByTestId("api-keys.secret").textContent).toBe("edk_secret_value");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
