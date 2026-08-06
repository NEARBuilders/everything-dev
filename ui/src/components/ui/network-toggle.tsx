import { useQuery } from "@tanstack/react-query";
import { useAuthClient } from "@/app";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sessionQueryOptions } from "@/lib/auth";

export function NetworkToggle() {
  const auth = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const supportedNetworks = auth.near.getSupportedNetworks();
  const currentNetwork = auth.useActiveNetwork();

  if (session?.user) return null;
  if (supportedNetworks.length <= 1) return null;

  return (
    <div className="border-l-2 border-border fixed top-0 right-0 z-50">
      <Tabs
        value={currentNetwork}
        onValueChange={(network) => {
          auth.near.setNetwork(network as "mainnet" | "testnet");
        }}
      >
        <TabsList className="w-auto">
          {supportedNetworks.map((network) => (
            <TabsTrigger key={network} value={network}>
              {network === "mainnet" ? "Mainnet" : "Testnet"}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
