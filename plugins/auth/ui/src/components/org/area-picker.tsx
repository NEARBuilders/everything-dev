import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissionRegistry } from "./permission-matrix";

export function areaLabel(area: string) {
  return area
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AreaPicker({
  value,
  onChange,
  disabled,
  testIdPrefix,
}: {
  value: string[];
  onChange: (areas: string[]) => void;
  disabled?: boolean;
  testIdPrefix: string;
}) {
  const registry = usePermissionRegistry();
  if (registry.isPending) return <Skeleton className="h-24 w-full rounded-2xl" />;

  const vocabulary = registry.data?.areas ?? [];
  const options = [...vocabulary, ...value.filter((area) => !vocabulary.includes(area))];

  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No team areas are declared. Add them under siwn.permissions.areas.
      </p>
    );
  }

  const toggle = (area: string, checked: boolean) =>
    onChange(
      checked
        ? [...value.filter((granted) => granted !== area), area]
        : value.filter((granted) => granted !== area),
    );

  return (
    <FieldSet>
      <FieldLegend variant="label">Feature areas</FieldLegend>
      <FieldDescription>Members of this team can reach these areas of the app.</FieldDescription>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((area) => (
          <Field key={area} orientation="horizontal">
            <Checkbox
              id={`${testIdPrefix}-${area}`}
              checked={value.includes(area)}
              disabled={disabled}
              onCheckedChange={(checked) => toggle(area, checked)}
              data-testid={`${testIdPrefix}-${area}`}
            />
            <FieldLabel htmlFor={`${testIdPrefix}-${area}`}>
              {areaLabel(area)}
              {!vocabulary.includes(area) && (
                <span className="text-muted-foreground"> (undeclared)</span>
              )}
            </FieldLabel>
          </Field>
        ))}
      </div>
    </FieldSet>
  );
}
