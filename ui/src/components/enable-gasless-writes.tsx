import { useQuery } from "@tanstack/react-query";
import { formatAmount } from "near-kit";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Switch } from "@/components/ui/switch";
import { useSessionGasKey } from "@/lib/use-gas-key";

export function EnableGaslessWrites({ nearAccountId }: { nearAccountId: string | null }) {
  const auth = useAuthClient();
  const { state } = useSessionGasKey();
  const [enabling, setEnabling] = useState(false);

  const scopeQuery = useQuery({
    queryKey: ["gas-key-scope"],
    queryFn: async () => {
      const { data } = await auth.near.getGasKeyScope();
      return data ?? { enabled: false };
    },
    staleTime: 60_000,
    retry: false,
  });

  const walletSupportedQuery = useQuery({
    queryKey: ["gas-key-wallet-supported", nearAccountId],
    queryFn: () => auth.near.isGasKeyWalletSupported(),
    staleTime: 60_000,
    retry: false,
  });

  if (!scopeQuery.data?.enabled) return null;

  if (state) {
    const balance =
      state.balance && /^\d+$/.test(state.balance)
        ? formatAmount(BigInt(state.balance), { precision: 4, trimZeros: true })
        : null;
    return (
      <GaslessRow
        description={
          <span data-testid="gasless-writes-status">
            On{balance ? ` · gas key balance ${balance}` : ""}
          </span>
        }
      >
        <Switch checked disabled aria-label="Gasless writes" />
      </GaslessRow>
    );
  }

  if (!nearAccountId) return null;

  const walletSupported = walletSupportedQuery.data;
  if (walletSupported === undefined) return null;

  if (!walletSupported) {
    return (
      <GaslessRow
        description={
          <span data-testid="gasless-writes-unsupported">
            Your wallet doesn&apos;t support gas keys, so publishing falls back to the relayer.
          </span>
        }
      >
        <Switch checked={false} disabled aria-label="Gasless writes" />
      </GaslessRow>
    );
  }

  const enable = async () => {
    setEnabling(true);
    try {
      await auth.near.addSessionGasKey({
        onError: (error) => toast.error(error.message || "Failed to enable gasless writes"),
      });
      const funded = await auth.near.ensureGasKeyFunded();
      if (funded) {
        toast.success("Gasless writes enabled");
      } else {
        toast.warning(
          "Session gas key not funded yet — publishing falls back to the relayer until it is funded.",
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to enable gasless writes");
    } finally {
      setEnabling(false);
    }
  };

  return (
    <GaslessRow
      description={
        enabling
          ? "Approve the gas key in your wallet…"
          : "The platform pays gas for your publishes. Your wallet approves once."
      }
    >
      <Switch
        checked={enabling}
        disabled={enabling}
        onCheckedChange={(checked) => {
          if (checked) void enable();
        }}
        aria-label="Enable gasless writes"
        data-testid="enable-gasless-writes"
      />
    </GaslessRow>
  );
}

function GaslessRow({ description, children }: { description: ReactNode; children: ReactNode }) {
  return (
    <div
      className="flex items-center justify-between gap-6 border-b border-border py-4 last:border-b-0"
      data-testid="gasless-writes-row"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium text-foreground">Gasless writes</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </div>
      {children}
    </div>
  );
}
