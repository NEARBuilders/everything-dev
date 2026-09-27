import { GlobeIcon } from "@phosphor-icons/react";
import { useAuthClient } from "@/app";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function NetworkToggle() {
  const auth = useAuthClient();
  const supportedNetworks = auth.near.getSupportedNetworks();
  const currentNetwork = auth.useActiveNetwork();

  if (supportedNetworks.length <= 1) return null;

  return (
    <ToggleGroup
      value={[currentNetwork]}
      onValueChange={(value) => {
        const next = supportedNetworks.find(
          (network) => value.includes(network) && network !== currentNetwork,
        );
        if (next) auth.near.setNetwork(next);
      }}
    >
      {supportedNetworks.map((network) => (
        <ToggleGroupItem key={network} value={network} aria-label={`Switch to ${network}`}>
          <GlobeIcon />
          {network === "mainnet" ? "Mainnet" : "Testnet"}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
