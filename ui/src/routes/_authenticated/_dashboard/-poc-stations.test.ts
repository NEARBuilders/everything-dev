import { describe, expect, it } from "vitest";
import { MIN_TEAM_STAKE_YOCTO, meetsTeamStakeMinimum, type SputnikProposal } from "./-poc-chain";
import {
  buildStations,
  type ChainFacts,
  deriveStations,
  isSharedTreasurySkip,
  pendingProposalCount,
  runnableRun,
  type StationInputs,
  teamTreasuryRequirementYocto,
} from "./-poc-stations";

const ENDOWMENT = "endowment.sputnik-dao.near";
const TEAM = "team.sputnik-dao.near";
const TEAM_LOCKUP = "team-lockup.venear.dao";
const LOCKUP = "endowment.lockup.venear.dao";

const inputs: StationInputs = {
  slug: "thing",
  pool: "thing.pool.near",
  teamAccount: TEAM,
  endowmentAccount: ENDOWMENT,
  teamLockup: TEAM_LOCKUP,
  endowmentLockup: LOCKUP,
  sponsorYocto: 3n * 10n ** 24n,
  sponsorStakeYocto: 3n * 10n ** 24n,
  govProposalId: 3,
};

const noFacts: ChainFacts = {
  applicationProposed: false,
  applicationApplied: false,
  tenantDeployed: false,
  poolAssigned: false,
  treasuryFunded: false,
  configPublished: false,
  teamStaked: false,
  teamRegistered: false,
  lockupDeployed: false,
  nearLocked: false,
  endowmentRegistered: false,
  endowmentLockupDeployed: false,
  endowmentFunded: false,
  endowmentLocked: false,
  endowmentPoolSelected: false,
  endowmentStaked: false,
  delegated: false,
  voteCast: false,
  teamUnstaked: false,
  teamWithdrawn: false,
  endowmentUnstaked: false,
  endowmentWithdrawn: false,
  endowmentPoolReleased: false,
  delegationsCleared: false,
  treasuriesShared: false,
};

const accounts = { session: "work.efiz.near", endowment: ENDOWMENT, team: TEAM };

function derive(overrides: Partial<Parameters<typeof deriveStations>[0]> = {}) {
  return deriveStations({
    stations: buildStations(inputs),
    facts: noFacts,
    proposalsBySigner: {},
    accounts,
    connectedDao: null,
    ...overrides,
  });
}

function proposal(
  id: number,
  receiverId: string,
  methodName: string,
  status = "InProgress",
): SputnikProposal {
  return {
    id,
    proposer: "sponsor.trezu.near",
    description: "",
    kind: {
      FunctionCall: {
        receiver_id: receiverId,
        actions: [{ method_name: methodName, args: "", deposit: "0", gas: "0" }],
      },
    },
    status,
    vote_counts: { Approver: ["0", "0", "0"] },
    votes: {},
    submission_time: "0",
  };
}

describe("buildStations", () => {
  it("orders twelve stations across five phases", () => {
    const stations = buildStations(inputs);
    expect(stations.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(stations.map((s) => s.phase)).toEqual([
      "stand-up",
      "stand-up",
      "stand-up",
      "bootstrap",
      "bootstrap",
      "bootstrap",
      "sponsor",
      "sponsor",
      "sponsor",
      "vote",
      "refresh",
      "refresh",
    ]);
  });

  it("assigns exactly one signer per station", () => {
    const byId = Object.fromEntries(buildStations(inputs).map((s) => [s.id, s.signer]));
    expect(byId).toEqual({
      apply: "session",
      approve: "session",
      fund: "session",
      publish: "team",
      stake: "team",
      "setup-hos": "team",
      "sponsor-lock": "endowment",
      "sponsor-stake": "endowment",
      "sponsor-delegate": "endowment",
      vote: "team",
      unstake: "team",
      "sponsor-unwind": "endowment",
    });
  });

  it("stakes a fixed 1 NEAR from the team treasury into the pool", () => {
    const stake = buildStations(inputs).find((s) => s.id === "stake");
    expect(stake?.steps[0]?.plan).toEqual({
      kind: "call",
      receiverId: "thing.pool.near",
      methodName: "deposit_and_stake",
      args: {},
      gas: "200 Tgas",
      attachedDeposit: MIN_TEAM_STAKE_YOCTO.toString(),
    });
    expect(stake?.steps[0]?.costYocto).toBe(MIN_TEAM_STAKE_YOCTO.toString());
  });

  it("locks all liquid NEAR on the team lockup for veNEAR", () => {
    const setup = buildStations(inputs).find((s) => s.id === "setup-hos");
    expect(setup?.steps.map((s) => (s.plan?.kind === "call" ? s.plan.methodName : null))).toEqual([
      "storage_deposit",
      "deploy_lockup",
      "lock_near",
    ]);
    const lock = setup?.steps.find((s) => s.id === "lock")?.plan;
    expect(lock).toMatchObject({
      receiverId: TEAM_LOCKUP,
      args: {},
      attachedDeposit: "1",
    });
    expect(setup?.steps.find((s) => s.id === "deploy-lockup")?.costYocto).toBe(
      (2n * 10n ** 24n).toString(),
    );
  });

  it("funds and locks the sponsor's NEAR on the endowment lockup", () => {
    const sponsorLock = buildStations(inputs).find((s) => s.id === "sponsor-lock");
    expect(sponsorLock?.steps.find((s) => s.id === "fund-lockup")?.plan).toEqual({
      kind: "transfer",
      receiverId: LOCKUP,
      amountYocto: (3n * 10n ** 24n).toString(),
    });
    expect(sponsorLock?.steps.find((s) => s.id === "lock-endowment")?.plan).toMatchObject({
      kind: "call",
      receiverId: LOCKUP,
      methodName: "lock_near",
      args: {},
    });
  });

  it("releases the old pool, then stakes the pool from the endowment lockup", () => {
    const sponsorStake = buildStations(inputs).find((s) => s.id === "sponsor-stake");
    expect(
      sponsorStake?.steps.map((s) => (s.plan?.kind === "call" ? s.plan.methodName : null)),
    ).toEqual(["unselect_staking_pool", "select_staking_pool", "deposit_and_stake"]);
    expect(sponsorStake?.steps.every((s) => s.plan?.receiverId === LOCKUP)).toBe(true);
    expect(sponsorStake?.steps.find((s) => s.id === "unselect-old-pool")?.plan).toMatchObject({
      kind: "call",
      methodName: "unselect_staking_pool",
      attachedDeposit: "1",
    });
    expect(sponsorStake?.steps.find((s) => s.id === "select-pool")?.plan).toMatchObject({
      kind: "call",
      args: { staking_pool_account_id: "thing.pool.near" },
    });
    expect(sponsorStake?.steps.find((s) => s.id === "stake-endowment")?.plan).toMatchObject({
      kind: "call",
      args: { amount: (3n * 10n ** 24n).toString() },
    });
  });

  it("targets the delegation at the team wallet, not the session wallet", () => {
    const delegate = buildStations(inputs).find((s) => s.id === "sponsor-delegate");
    expect(delegate?.steps[0]?.plan).toMatchObject({
      kind: "call",
      receiverId: "venear.dao",
      methodName: "set_delegations",
      args: { entries: [{ account_id: TEAM, bps: 10_000 }] },
    });
  });

  it("unwinds the team's direct stake back to its treasury", () => {
    const unstake = buildStations(inputs).find((s) => s.id === "unstake");
    expect(unstake?.steps.map((s) => (s.plan?.kind === "call" ? s.plan.methodName : null))).toEqual(
      ["unstake_all", "withdraw"],
    );
    expect(unstake?.steps.every((s) => s.plan?.receiverId === "thing.pool.near")).toBe(true);
    expect(
      unstake?.steps.every((s) => (s.plan?.kind === "call" ? !s.plan.attachedDeposit : true)),
    ).toBe(true);
  });

  it("unwinds the sponsor's lockup stake and delegations", () => {
    const unwind = buildStations(inputs).find((s) => s.id === "sponsor-unwind");
    expect(unwind?.steps.map((s) => (s.plan?.kind === "call" ? s.plan.methodName : null))).toEqual([
      "unstake_all",
      "withdraw_all_from_staking_pool",
      "unselect_staking_pool",
      "set_delegations",
    ]);
    expect(unwind?.steps.find((s) => s.id === "unselect-pool")?.plan?.receiverId).toBe(LOCKUP);
    expect(unwind?.steps.find((s) => s.id === "clear-delegations")?.plan).toMatchObject({
      kind: "call",
      args: { entries: [] },
    });
  });
});

describe("meetsTeamStakeMinimum", () => {
  it("passes the team's stake only from 1 NEAR up", () => {
    expect(meetsTeamStakeMinimum(undefined)).toBe(false);
    expect(meetsTeamStakeMinimum("0")).toBe(false);
    expect(meetsTeamStakeMinimum((10n ** 23n).toString())).toBe(false);
    expect(meetsTeamStakeMinimum((MIN_TEAM_STAKE_YOCTO - 1n).toString())).toBe(false);
    expect(meetsTeamStakeMinimum(MIN_TEAM_STAKE_YOCTO.toString())).toBe(true);
    expect(meetsTeamStakeMinimum((5n * 10n ** 24n).toString())).toBe(true);
  });
});

describe("teamTreasuryRequirementYocto", () => {
  it("sums the deposits of the team's remaining stations", () => {
    expect(teamTreasuryRequirementYocto(noFacts)).toBe(3_101_250_000_000_000_000_000_000n);
  });

  it("drops each requirement once its fact holds", () => {
    const staked = teamTreasuryRequirementYocto({ ...noFacts, teamStaked: true });
    expect(staked).toBe(3_101_250_000_000_000_000_000_000n - 10n ** 24n);
    const registered = teamTreasuryRequirementYocto({
      ...noFacts,
      teamStaked: true,
      teamRegistered: true,
    });
    expect(registered).toBe(2_001_250_000_000_000_000_000_000n);
    const deployed = teamTreasuryRequirementYocto({
      ...noFacts,
      teamStaked: true,
      teamRegistered: true,
      lockupDeployed: true,
    });
    expect(deployed).toBe(1_250_000_000_000_000_000_000n);
    expect(
      teamTreasuryRequirementYocto({
        ...noFacts,
        teamStaked: true,
        teamRegistered: true,
        lockupDeployed: true,
        voteCast: true,
      }),
    ).toBe(0n);
  });
});

describe("deriveStations", () => {
  it("blocks only on declared requirements — no implicit upstream walk", () => {
    const states = derive();
    const byId = Object.fromEntries(states.map((s) => [s.def.id, s.status]));
    expect(byId).toEqual({
      apply: "ready",
      approve: "blocked",
      fund: "blocked",
      publish: "blocked",
      stake: "blocked",
      "setup-hos": "blocked",
      "sponsor-lock": "blocked",
      "sponsor-stake": "blocked",
      "sponsor-delegate": "blocked",
      vote: "blocked",
      unstake: "blocked",
      "sponsor-unwind": "blocked",
    });
    expect(states.find((s) => s.def.id === "approve")?.blockedReason).toBe(
      "submit the application first",
    );
    expect(states.find((s) => s.def.id === "stake")?.blockedReason).toBe("assign the pool first");
  });

  it("makes the bootstrap stations independently runnable once funded", () => {
    const states = derive({
      facts: {
        ...noFacts,
        applicationProposed: true,
        tenantDeployed: true,
        poolAssigned: true,
        treasuryFunded: true,
      },
      connectedDao: TEAM,
    });
    for (const id of ["publish", "stake", "setup-hos"] as const) {
      const station = states.find((s) => s.def.id === id);
      expect(station?.status).toBe("ready");
      expect(station?.canRun).toBe(true);
    }
    expect(states.find((s) => s.def.id === "vote")?.status).toBe("blocked");
    expect(states.find((s) => s.def.id === "unstake")?.status).toBe("blocked");
  });

  it("never lets the endowment track block the team's vote", () => {
    const states = derive({
      facts: {
        ...noFacts,
        applicationProposed: true,
        tenantDeployed: true,
        poolAssigned: true,
        treasuryFunded: true,
        teamRegistered: true,
        lockupDeployed: true,
        nearLocked: true,
      },
      blockers: {
        "sponsor-lock": "set the endowment treasury",
        "sponsor-stake": "set the endowment treasury",
        "sponsor-delegate": "set the endowment treasury",
        "sponsor-unwind": "set the endowment treasury",
      },
      connectedDao: TEAM,
    });
    expect(states.find((s) => s.def.id === "vote")?.status).toBe("ready");
    expect(states.find((s) => s.def.id === "vote")?.canRun).toBe(true);
    expect(states.find((s) => s.def.id === "sponsor-lock")?.status).toBe("blocked");
    expect(states.find((s) => s.def.id === "sponsor-delegate")?.status).toBe("blocked");
  });

  it("skips the sponsor stations when both treasuries are one account", () => {
    const facts = { ...noFacts, treasuriesShared: true };
    const states = derive({ facts });
    for (const id of [
      "sponsor-lock",
      "sponsor-stake",
      "sponsor-delegate",
      "sponsor-unwind",
    ] as const) {
      expect(states.find((s) => s.def.id === id)?.status).toBe("skipped");
    }
    expect(states.find((s) => s.def.id === "sponsor-delegate")?.skipReason).toBe(
      "the endowment cannot delegate to itself",
    );
    expect(states.find((s) => s.def.id === "sponsor-lock")?.skipReason).toBe(
      "team and endowment are one account — the sponsor phase is folded into the team stations",
    );
    expect(states.find((s) => s.def.id === "setup-hos")?.skipReason).toBeNull();
    expect(isSharedTreasurySkip("vote", facts)).toBe(false);
  });

  it("reports a station as staged when a pending DAO proposal matches its plan", () => {
    const states = derive({
      facts: { ...noFacts, applicationProposed: true, tenantDeployed: true },
      proposalsBySigner: { team: [proposal(7, "registry.near", "__fastdata_kv")] },
      connectedDao: TEAM,
    });
    const publish = states.find((s) => s.def.id === "publish");
    expect(publish?.status).toBe("staged");
    expect(publish?.steps.find((s) => s.id === "publish")?.pendingProposal?.id).toBe(7);
    expect(pendingProposalCount(states)).toBe(1);
  });

  it("ignores proposals that are no longer in progress", () => {
    const states = derive({
      facts: { ...noFacts, applicationProposed: true, tenantDeployed: true },
      proposalsBySigner: { team: [proposal(7, "registry.near", "__fastdata_kv", "Approved")] },
      connectedDao: TEAM,
    });
    expect(states.find((s) => s.def.id === "publish")?.status).toBe("ready");
  });

  it("does not attribute one treasury's proposals to another", () => {
    const states = derive({
      facts: { ...noFacts, applicationProposed: true, tenantDeployed: true },
      proposalsBySigner: { endowment: [proposal(7, "registry.near", "__fastdata_kv")] },
      connectedDao: TEAM,
    });
    expect(states.find((s) => s.def.id === "publish")?.status).toBe("ready");
  });

  it("surfaces input blockers ahead of requirements", () => {
    const states = derive({ blockers: { apply: "select an organization first" } });
    expect(states[0].status).toBe("blocked");
    expect(states[0].blockedReason).toBe("select an organization first");
  });

  it("gates delegation on the team's veNEAR registration", () => {
    const ready = {
      ...noFacts,
      applicationProposed: true,
      tenantDeployed: true,
      endowmentFunded: true,
      endowmentLocked: true,
    };
    const blocked = derive({ facts: ready, connectedDao: ENDOWMENT });
    const delegate = blocked.find((s) => s.def.id === "sponsor-delegate");
    expect(delegate?.status).toBe("blocked");
    expect(delegate?.blockedBy).toBe("input");
    expect(delegate?.blockedReason).toBe(
      "the team must register in veNEAR before it can receive the delegation",
    );
    expect(delegate?.canRun).toBe(false);
    expect(runnableRun(blocked).map((s) => s.def.id)).toEqual(["fund"]);
    const unblocked = derive({
      facts: { ...ready, teamRegistered: true },
      connectedDao: ENDOWMENT,
    });
    const delegateReady = unblocked.find((s) => s.def.id === "sponsor-delegate");
    expect(delegateReady?.status).toBe("ready");
    expect(delegateReady?.canRun).toBe(true);
    expect(runnableRun(unblocked).map((s) => s.def.id)).toEqual(["fund"]);
  });

  it("marks a station failed and reports the failure", () => {
    const states = derive({
      facts: { ...noFacts, applicationProposed: true },
      failedStations: { publish: "insufficient balance" },
      connectedDao: TEAM,
    });
    const publish = states.find((s) => s.def.id === "publish");
    expect(publish?.status).toBe("failed");
    expect(publish?.blockedReason).toBe("insufficient balance");
    expect(publish?.canRun).toBe(true);
  });

  it("tracks whether the required signer is the connected treasury", () => {
    const states = derive({
      facts: { ...noFacts, applicationProposed: true },
      connectedDao: ENDOWMENT,
    });
    expect(states.find((s) => s.def.id === "publish")?.signerConnected).toBe(false);
    expect(states.find((s) => s.def.id === "sponsor-lock")?.signerConnected).toBe(true);
    expect(states.find((s) => s.def.id === "apply")?.signerConnected).toBe(true);
  });

  it("treats session-proposable signers as connected without a treasury connection", () => {
    const facts = {
      ...noFacts,
      applicationProposed: true,
      applicationApplied: true,
      tenantDeployed: true,
      poolAssigned: true,
      treasuryFunded: true,
      configPublished: true,
      teamStaked: true,
      teamRegistered: true,
      lockupDeployed: true,
      nearLocked: true,
      voteCast: true,
      teamUnstaked: true,
      teamWithdrawn: true,
      endowmentFunded: true,
    };
    const without = derive({
      facts,
      connectedDao: TEAM,
      sessionProposerSigners: [],
    });
    expect(without.find((s) => s.def.id === "sponsor-stake")?.signerConnected).toBe(false);
    expect(without.find((s) => s.def.id === "sponsor-stake")?.canRun).toBe(false);
    const withRight = derive({
      facts,
      connectedDao: TEAM,
      sessionProposerSigners: ["endowment"],
    });
    const sponsorStake = withRight.find((s) => s.def.id === "sponsor-stake");
    expect(sponsorStake?.signerConnected).toBe(true);
    expect(sponsorStake?.status).toBe("ready");
    expect(sponsorStake?.canRun).toBe(true);
    expect(runnableRun(withRight).map((s) => s.def.id)).toEqual([
      "sponsor-lock",
      "sponsor-stake",
      "sponsor-delegate",
    ]);
  });
});

describe("runnableRun", () => {
  it("runs the session stations while no treasury is connected", () => {
    const states = derive({ facts: { ...noFacts } });
    expect(runnableRun(states).map((s) => s.def.id)).toEqual(["apply"]);
  });

  it("collects every runnable station of the connected signer, skipping blocked ones in between", () => {
    const states = derive({
      facts: {
        ...noFacts,
        applicationProposed: true,
        tenantDeployed: true,
        poolAssigned: true,
        treasuryFunded: true,
      },
      blockers: { stake: "enter the staking pool" },
      connectedDao: TEAM,
    });
    expect(runnableRun(states).map((s) => s.def.id)).toEqual(["publish", "setup-hos"]);
  });

  it("never crosses a signer boundary", () => {
    const states = derive({
      facts: {
        ...noFacts,
        applicationProposed: true,
        tenantDeployed: true,
        poolAssigned: true,
        treasuryFunded: true,
        endowmentFunded: true,
        endowmentLocked: true,
        endowmentStaked: true,
        teamRegistered: true,
      },
      connectedDao: ENDOWMENT,
    });
    expect(runnableRun(states).map((s) => s.def.id)).toEqual([
      "sponsor-lock",
      "sponsor-stake",
      "sponsor-delegate",
      "sponsor-unwind",
    ]);
  });

  it("skips fully staged stations with nothing left to sign", () => {
    const states = derive({
      facts: {
        ...noFacts,
        applicationProposed: true,
        tenantDeployed: true,
        poolAssigned: true,
        treasuryFunded: true,
        endowmentFunded: true,
        endowmentLocked: true,
        endowmentStaked: true,
        teamRegistered: true,
      },
      proposalsBySigner: {
        endowment: [
          proposal(1, LOCKUP, "select_staking_pool"),
          proposal(2, LOCKUP, "deposit_and_stake"),
          proposal(3, "venear.dao", "set_delegations"),
        ],
      },
      connectedDao: ENDOWMENT,
    });
    expect(states.find((s) => s.def.id === "sponsor-stake")?.status).toBe("staged");
    expect(states.find((s) => s.def.id === "sponsor-delegate")?.status).toBe("staged");
    expect(runnableRun(states).map((s) => s.def.id)).toEqual(["sponsor-lock"]);
  });
});

describe("run gating", () => {
  it("enables ready stations with pending work and a connected signer", () => {
    const states = derive({
      facts: {
        ...noFacts,
        applicationProposed: true,
        tenantDeployed: true,
        poolAssigned: true,
        treasuryFunded: true,
      },
      connectedDao: TEAM,
    });
    const stake = states.find((s) => s.def.id === "stake");
    expect(stake?.canRun).toBe(true);
    expect(stake?.runBlockReason).toBeNull();
  });

  it("disables requirement-blocked stations with the requirement as the reason", () => {
    const states = derive({ facts: { ...noFacts, applicationProposed: true } });
    const setupHos = states.find((s) => s.def.id === "setup-hos");
    expect(setupHos?.canRun).toBe(false);
    expect(setupHos?.runBlockReason).toBe(
      "fund the team treasury first — House of Stake setup needs 2.1 NEAR",
    );
  });

  it("disables input-blocked stations with the blocker as the reason", () => {
    const states = derive({
      facts: { ...noFacts, applicationProposed: true },
      blockers: { approve: "admin access required — sign in as an admin" },
      connectedDao: TEAM,
    });
    const approve = states.find((s) => s.def.id === "approve");
    expect(approve?.canRun).toBe(false);
    expect(approve?.runBlockReason).toBe("admin access required — sign in as an admin");
  });

  it("reports awaiting votes when only staged steps remain", () => {
    const states = derive({
      facts: {
        ...noFacts,
        applicationProposed: true,
        tenantDeployed: true,
        poolAssigned: true,
        treasuryFunded: true,
        teamRegistered: true,
      },
      proposalsBySigner: {
        team: [
          proposal(1, "venear.dao", "storage_deposit"),
          proposal(2, "venear.dao", "deploy_lockup"),
          proposal(3, TEAM_LOCKUP, "lock_near"),
        ],
      },
      connectedDao: TEAM,
    });
    const setupHos = states.find((s) => s.def.id === "setup-hos");
    expect(setupHos?.status).toBe("staged");
    expect(setupHos?.canRun).toBe(false);
    expect(setupHos?.runBlockReason).toBe("awaiting votes");
  });

  it("keeps failed stations retryable when the signer is connected", () => {
    const states = derive({
      facts: { ...noFacts, applicationProposed: true, tenantDeployed: true },
      failedStations: { "setup-hos": "lockup deployment reverted" },
      connectedDao: TEAM,
    });
    const setupHos = states.find((s) => s.def.id === "setup-hos");
    expect(setupHos?.status).toBe("failed");
    expect(setupHos?.canRun).toBe(true);
  });
});
