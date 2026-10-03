// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StepList, useStepper } from "./stepper";

afterEach(cleanup);

describe("stepper", () => {
  it("keeps a step's DOM identity when identified steps reorder", () => {
    const first = { id: "create", label: "Create account", state: "success" as const };
    const second = { id: "publish", label: "Publish config", state: "pending" as const };
    const view = render(<StepList steps={[first, second]} />);
    const createLabel = screen.getByText("Create account");

    view.rerender(<StepList steps={[second, first]} />);

    expect(screen.getByText("Create account")).toBe(createLabel);
  });

  it("preserves progress across renders and resets to pending", async () => {
    const labels = [{ label: "Create account" }, { label: "Publish config", blocking: false }];
    const { result, rerender } = renderHook(() => useStepper(labels));

    await act(async () => {
      expect(await result.current.runStep(0, async () => "account.near")).toBe("account.near");
      expect(
        await result.current.runStep(1, async () => {
          throw new Error("Publish failed");
        }),
      ).toBeUndefined();
    });
    rerender();
    expect(result.current.steps).toEqual([
      { label: "Create account", state: "success", error: undefined },
      { label: "Publish config", blocking: false, state: "failed", error: "Publish failed" },
    ]);

    act(() => result.current.resetSteps());
    expect(result.current.steps).toEqual(labels.map((step) => ({ ...step, state: "pending" })));
  });
});
