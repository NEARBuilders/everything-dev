// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs } from "@/components";
import { TeamsTab, type TeamsTabTeam } from "./-teams-tab";

const orgMembers = [
  { id: "m-owner", userId: "u-owner", role: "owner", user: { name: "Olive Owner" } },
  { id: "m-ops", userId: "u-ops", role: "member", user: { name: "Oscar Ops" } },
  { id: "m-fin", userId: "u-fin", role: "member", user: { email: "fin@example.com" } },
];

const opsTeam: TeamsTabTeam = {
  id: "team-ops",
  name: "Node Operator",
  areas: ["node-operations"],
  memberUserIds: ["u-ops"],
};

function renderTab(props: Partial<Parameters<typeof TeamsTab>[0]> = {}) {
  const handlers = {
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onAreasChange: vi.fn(),
    onAddMember: vi.fn(),
    onRemoveMember: vi.fn(),
  };
  render(
    <Tabs defaultValue="teams">
      <TeamsTab
        canManage
        teams={[opsTeam]}
        orgMembers={orgMembers}
        isMutating={false}
        {...handlers}
        {...props}
      />
    </Tabs>,
  );
  return handlers;
}

async function openTeamMenu() {
  fireEvent.click(screen.getByTestId("teams-tab-menu-team-ops"));
  await screen.findByRole("menu");
}

afterEach(cleanup);

describe("TeamsTab", () => {
  it("shows management controls only to organization owners and admins", () => {
    renderTab({ canManage: false });

    expect(screen.queryByTestId("teams-tab-create-input")).toBeNull();
    expect(screen.queryByTestId("teams-tab-menu-team-ops")).toBeNull();
    expect(screen.queryByTestId("teams-tab-add-member-team-ops")).toBeNull();
    expect(screen.queryByTestId("teams-tab-remove-member-team-ops-u-ops")).toBeNull();
    expect(
      screen.getByTestId("teams-tab-area-team-ops-node-operations").hasAttribute("data-disabled"),
    ).toBe(true);
    expect(screen.getByText("Node operations")).toBeTruthy();
  });

  it("creates a team from the name field", () => {
    const { onCreate } = renderTab();

    fireEvent.change(screen.getByTestId("teams-tab-create-input"), {
      target: { value: "  Finance " },
    });
    fireEvent.click(screen.getByTestId("teams-tab-create-button"));

    expect(onCreate).toHaveBeenCalledWith("Finance");
  });

  it("reflects granted areas and reports toggled grants", () => {
    const { onAreasChange } = renderTab();
    const ops = screen.getByTestId("teams-tab-area-team-ops-node-operations");
    const finance = screen.getByTestId("teams-tab-area-team-ops-finance");

    expect(ops.getAttribute("aria-checked")).toBe("true");
    expect(finance.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(finance);
    expect(onAreasChange).toHaveBeenLastCalledWith("team-ops", ["node-operations", "finance"]);

    fireEvent.click(ops);
    expect(onAreasChange).toHaveBeenLastCalledWith("team-ops", []);
  });

  it("renames and deletes a team from its menu", async () => {
    const { onRename, onDelete } = renderTab();

    await openTeamMenu();
    fireEvent.click(screen.getByTestId("teams-tab-rename-team-ops"));
    fireEvent.change(screen.getByTestId("teams-tab-rename-input-team-ops"), {
      target: { value: "Operators" },
    });
    fireEvent.click(screen.getByTestId("teams-tab-rename-save-team-ops"));
    expect(onRename).toHaveBeenCalledWith("team-ops", "Operators");

    await openTeamMenu();
    fireEvent.click(screen.getByTestId("teams-tab-delete-team-ops"));
    expect(onDelete).toHaveBeenCalledWith("team-ops");
  });

  it("lists team members and offers only organization members outside the team", async () => {
    const { onAddMember, onRemoveMember } = renderTab();
    const card = screen.getByTestId("teams-tab-team-team-ops");

    expect(within(card).getByText("Oscar Ops")).toBeTruthy();
    fireEvent.click(screen.getByTestId("teams-tab-add-member-team-ops"));
    const options = (await screen.findAllByRole("option")).map((option) =>
      option.getAttribute("data-testid"),
    );
    expect(options).toEqual([
      "teams-tab-add-member-option-team-ops-u-owner",
      "teams-tab-add-member-option-team-ops-u-fin",
    ]);

    const finOption = screen.getByTestId("teams-tab-add-member-option-team-ops-u-fin");
    fireEvent.pointerDown(finOption);
    fireEvent.click(finOption);
    await waitFor(() =>
      expect(screen.getByTestId("teams-tab-add-member-team-ops").textContent).toContain(
        "fin@example.com",
      ),
    );
    fireEvent.click(screen.getByTestId("teams-tab-add-member-button-team-ops"));
    expect(onAddMember).toHaveBeenCalledWith("team-ops", "u-fin");

    fireEvent.click(screen.getByTestId("teams-tab-remove-member-team-ops-u-ops"));
    expect(onRemoveMember).toHaveBeenCalledWith("team-ops", "u-ops");
  });

  it("shows empty states for no teams and teams without members", () => {
    renderTab({ teams: [] });
    expect(screen.getByText("No teams yet")).toBeTruthy();
    cleanup();

    renderTab({ teams: [{ ...opsTeam, memberUserIds: [] }] });
    expect(screen.getByText("No members in this team")).toBeTruthy();
  });

  it("keeps membership controls unresolved while a team membership query is loading", () => {
    renderTab({ teams: [{ ...opsTeam, memberStatus: "loading", memberUserIds: [] }] });

    const card = screen.getByTestId("teams-tab-team-team-ops");
    expect(within(card).getByText("Loading members...")).toBeTruthy();
    expect(within(card).queryByText("0 members")).toBeNull();
    expect(screen.getByTestId("teams-tab-add-member-team-ops").hasAttribute("data-disabled")).toBe(
      true,
    );
    expect((screen.getByTestId("teams-tab-menu-team-ops") as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(
      screen.getByTestId("teams-tab-area-team-ops-node-operations").hasAttribute("data-disabled"),
    ).toBe(false);
  });

  it("offers a retry for a failed membership query without hiding team management", () => {
    const onRetryMembers = vi.fn();
    renderTab({
      onRetryMembers,
      teams: [
        {
          ...opsTeam,
          memberStatus: "error",
          memberError: "membership unavailable",
          memberUserIds: [],
        },
      ],
    });

    const card = screen.getByTestId("teams-tab-team-team-ops");
    expect(within(card).getByText("membership unavailable")).toBeTruthy();
    expect(within(card).getByTestId("teams-tab-retry-members-team-ops")).toBeTruthy();
    expect(within(card).queryByText("No members in this team")).toBeNull();
    fireEvent.click(within(card).getByTestId("teams-tab-retry-members-team-ops"));
    expect(onRetryMembers).toHaveBeenCalledWith("team-ops");
    expect((screen.getByTestId("teams-tab-menu-team-ops") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
