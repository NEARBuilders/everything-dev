// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvitationRow } from "./-invitation-row";
import { detectInviteIdentifier, InviteMemberForm } from "./-invite-member-form";

const teams = [
  { id: "team-fin", name: "Finance" },
  { id: "team-ops", name: "Node Operator" },
];

function renderForm() {
  const onInvite = vi.fn().mockResolvedValue(undefined);
  render(<InviteMemberForm teams={teams} isPending={false} onInvite={onInvite} />);
  return { onInvite };
}

afterEach(cleanup);

async function pickOption(testId: string, label: string) {
  fireEvent.click(screen.getByTestId(testId));
  const option = await screen.findByRole("option", { name: label });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
  await waitFor(() => expect(screen.getByTestId(testId).textContent).toContain(label));
}

describe("InviteMemberForm team targeting", () => {
  it("detects email, named NEAR, and implicit NEAR identifiers", () => {
    expect(detectInviteIdentifier("hire@example.com")).toEqual({
      kind: "email",
      value: "hire@example.com",
    });
    expect(detectInviteIdentifier("Alice.NEAR")).toEqual({
      kind: "near",
      value: "alice.near",
    });
    expect(detectInviteIdentifier("f".repeat(64))).toEqual({
      kind: "near",
      value: "f".repeat(64),
    });
    expect(detectInviteIdentifier("not an identifier")).toBeNull();
  });

  it("offers the organization's teams with no team selected by default", async () => {
    renderForm();
    const picker = screen.getByTestId("invite-team-select");

    expect(picker.textContent).toContain("No team");
    fireEvent.click(picker);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "No team",
      "Finance",
      "Node Operator",
    ]);
  });

  it("sends an invitation without a team", async () => {
    const { onInvite } = renderForm();

    fireEvent.change(screen.getByTestId("invite-identifier-input"), {
      target: { value: "hire@example.com" },
    });
    fireEvent.click(screen.getByTestId("invite-submit-button"));

    await waitFor(() =>
      expect(onInvite).toHaveBeenCalledWith({ email: "hire@example.com", role: "member" }),
    );
  });

  it("sends an invitation targeting the chosen team and role, then resets", async () => {
    const { onInvite } = renderForm();
    const input = screen.getByTestId("invite-identifier-input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ops@example.com" } });
    await pickOption("invite-role-select", "Admin");
    await pickOption("invite-team-select", "Node Operator");
    fireEvent.click(screen.getByTestId("invite-submit-button"));

    await waitFor(() =>
      expect(onInvite).toHaveBeenCalledWith({
        email: "ops@example.com",
        role: "admin",
        teamId: "team-ops",
      }),
    );
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("sends a wallet invitation and gives wallet-specific feedback", async () => {
    const { onInvite } = renderForm();
    const input = screen.getByTestId("invite-identifier-input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "operator.near" } });
    expect(screen.getByTestId("invite-identifier-feedback").textContent).toContain(
      "NEAR invitation",
    );
    fireEvent.click(screen.getByTestId("invite-submit-button"));

    await waitFor(() =>
      expect(onInvite).toHaveBeenCalledWith({
        nearAccountId: "operator.near",
        nearNetwork: "mainnet",
        role: "member",
      }),
    );
  });

  it("lets the inviter select testnet and omits the network for email invitations", async () => {
    const { onInvite } = renderForm();
    fireEvent.change(screen.getByTestId("invite-identifier-input"), {
      target: { value: "operator.testnet" },
    });
    await pickOption("invite-network-select", "Testnet");
    expect(screen.getByTestId("invite-identifier-feedback").textContent).toContain("testnet");
    fireEvent.click(screen.getByTestId("invite-submit-button"));
    await waitFor(() =>
      expect(onInvite).toHaveBeenCalledWith({
        nearAccountId: "operator.testnet",
        nearNetwork: "testnet",
        role: "member",
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText("NEAR network")).toBeNull());
    fireEvent.change(screen.getByTestId("invite-identifier-input"), {
      target: { value: "operator@example.com" },
    });
    fireEvent.click(screen.getByTestId("invite-submit-button"));
    await waitFor(() =>
      expect(onInvite).toHaveBeenLastCalledWith({
        email: "operator@example.com",
        role: "member",
      }),
    );
  });

  it("keeps the input when sending fails", async () => {
    const onInvite = vi.fn().mockRejectedValue(new Error("nope"));
    render(<InviteMemberForm teams={teams} isPending={false} onInvite={onInvite} />);
    const input = screen.getByTestId("invite-identifier-input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "retry@example.com" } });
    fireEvent.click(screen.getByTestId("invite-submit-button"));

    await waitFor(() => expect(onInvite).toHaveBeenCalled());
    expect(input.value).toBe("retry@example.com");
  });
});

describe("InvitationRow team targeting", () => {
  it("labels the wallet network and requires reissue for legacy invitations", async () => {
    const invitation = {
      id: "wallet-invite",
      email: "wallet@near-wallet.invalid",
      nearAccountId: "alice.near",
      nearNetwork: "testnet" as const,
      role: "member",
      status: "pending",
      expiresAt: new Date(),
    };
    const onResend = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <InvitationRow invitation={invitation} onResend={onResend} onCancel={onCancel} />,
    );
    expect(screen.getByTestId("invitation-network-wallet-invite").textContent).toContain("testnet");
    rerender(
      <InvitationRow
        invitation={{ ...invitation, nearNetwork: null }}
        onResend={onResend}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/cancel and reissue/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Actions for alice.near" }));
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: /resend/i })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /cancel invitation/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows the targeted team when present", () => {
    render(
      <InvitationRow
        invitation={{
          id: "inv-1",
          email: "hire@example.com",
          role: "member",
          status: "pending",
          expiresAt: "2026-12-01T00:00:00.000Z",
        }}
        teamName="Finance"
      />,
    );

    expect(screen.getByTestId("invitation-team-inv-1").textContent).toContain("Finance");
  });
});
