import { GlobeIcon } from "@phosphor-icons/react";
import { useAuthClient } from "@/app";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAppTranslation } from "@/i18n/runtime";

export function NetworkToggle() {
  const auth = useAuthClient();
  const supportedNetworks = auth.near.getSupportedNetworks();
  const currentNetwork = auth.useActiveNetwork();
  const t = useAppTranslation();

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
        <ToggleGroupItem
          key={network}
          value={network}
          aria-label={t("network.switch", { network })}
        >
          <GlobeIcon />
          {t(network === "mainnet" ? "network.mainnet" : "network.testnet")}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
