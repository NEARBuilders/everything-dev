import { describe, expect, it } from "vitest";
import { buildAddProposalArgs } from "./sputnik-proposals";

describe("buildAddProposalArgs", () => {
  it("wraps a call plan as a FunctionCall proposal with base64 args and raw gas", () => {
    expect(
      buildAddProposalArgs(
        {
          kind: "call",
          receiverId: "dev.everything.near",
          methodName: "__fastdata_kv",
          args: { k: "v" },
          gas: "300 Tgas",
        },
        "d",
      ),
    ).toEqual({
      proposal: {
        description: "d",
        kind: {
          FunctionCall: {
            receiver_id: "dev.everything.near",
            actions: [
              {
                method_name: "__fastdata_kv",
                args: "eyJrIjoidiJ9",
                deposit: "0",
                gas: "300000000000000",
              },
            ],
          },
        },
      },
    });
  });

  it("carries an explicit attached deposit onto the action", () => {
    const { proposal } = buildAddProposalArgs(
      {
        kind: "call",
        receiverId: "a.near",
        methodName: "m",
        args: {},
        gas: "100 Tgas",
        attachedDeposit: "5",
      },
      "d",
    );
    expect(proposal.kind).toMatchObject({
      FunctionCall: { actions: [{ deposit: "5", gas: "100000000000000" }] },
    });
  });

  it("wraps a transfer plan as a Transfer proposal with an empty token id", () => {
    expect(
      buildAddProposalArgs({ kind: "transfer", receiverId: "bob.near", amountYocto: "42" }, "pay"),
    ).toEqual({
      proposal: {
        description: "pay",
        kind: { Transfer: { token_id: "", receiver_id: "bob.near", amount: "42" } },
      },
    });
  });
});
