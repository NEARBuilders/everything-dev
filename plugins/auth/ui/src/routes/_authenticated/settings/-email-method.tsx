import { EnvelopeIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { MethodHeader } from "./-method-header";

export function EmailMethod({ email }: { email: string }) {
  return (
    <section className="flex flex-col gap-4" data-testid="settings.email">
      <MethodHeader title="Email" />
      <Item variant="outline">
        <ItemMedia variant="icon">
          <EnvelopeIcon />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Email address</ItemTitle>
          <ItemDescription className="break-all">{email}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="secondary">Linked</Badge>
        </ItemActions>
      </Item>
    </section>
  );
}
