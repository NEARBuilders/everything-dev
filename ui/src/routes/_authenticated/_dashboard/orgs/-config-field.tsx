import { Field, FieldLabel, Input } from "@/components";

export function ConfigField({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  mono,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={mono ? "font-mono" : undefined}
        data-testid={id}
      />
    </Field>
  );
}
