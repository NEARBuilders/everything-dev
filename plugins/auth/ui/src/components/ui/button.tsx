import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-none border-0 text-sm font-medium whitespace-nowrap transition-bevel outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:bg-face disabled:text-muted-foreground disabled:text-emboss aria-disabled:pointer-events-none aria-disabled:bg-face aria-disabled:text-muted-foreground aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground bevel-raised hover:bg-primary/90 active:not-aria-[haspopup]:bevel-pressed aria-expanded:bevel-pressed data-pressed:bevel-pressed",
        brand:
          "bg-brand text-brand-foreground bevel-raised hover:bg-brand/90 active:not-aria-[haspopup]:bevel-pressed aria-expanded:bevel-pressed data-pressed:bevel-pressed",
        outline:
          "bg-face text-foreground bevel-raised hover:bg-accent hover:text-accent-foreground active:not-aria-[haspopup]:bevel-pressed aria-expanded:bg-accent aria-expanded:bevel-pressed data-pressed:bevel-pressed",
        secondary:
          "bg-card text-card-foreground bevel-raised hover:bg-muted active:not-aria-[haspopup]:bevel-pressed aria-expanded:bg-muted aria-expanded:bevel-pressed data-pressed:bevel-pressed",
        ghost:
          "bg-transparent text-foreground bevel-none hover:bg-muted hover:bevel-raised active:not-aria-[haspopup]:bevel-pressed aria-expanded:bg-muted aria-expanded:bevel-pressed data-pressed:bg-accent data-pressed:bevel-pressed disabled:bg-transparent aria-disabled:bg-transparent",
        destructive:
          "bg-destructive-muted text-destructive-muted-foreground bevel-raised hover:bg-destructive hover:text-destructive-foreground focus-visible:ring-destructive/30 active:not-aria-[haspopup]:bevel-pressed aria-expanded:bevel-pressed data-pressed:bevel-pressed",
        link: "bg-transparent text-primary bevel-none underline-offset-4 hover:underline disabled:bg-transparent aria-disabled:bg-transparent",
      },
      size: {
        default:
          "h-11 gap-2 px-5 text-base has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xs: "h-7 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        lg: "h-12 gap-2 px-6 text-base has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5 [&_svg:not([class*='size-'])]:size-5",
        xl: "h-14 gap-2.5 px-8 text-lg has-data-[icon=inline-end]:pr-7 has-data-[icon=inline-start]:pl-7 [&_svg:not([class*='size-'])]:size-5",
        icon: "size-11",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-12 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function ButtonLink({
  className,
  variant = "default",
  size = "default",
  render,
  nativeButton: _nativeButton,
  focusableWhenDisabled: _focusableWhenDisabled,
  disabled = false,
  style,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const state: { disabled: boolean } = { disabled };
  const resolvedClassName = typeof className === "function" ? className(state) : className;
  return useRender({
    defaultTagName: "a",
    render,
    state,
    props: {
      ...mergeProps<"button">(
        {
          className: cn(buttonVariants({ variant, size, className: resolvedClassName })),
          style: typeof style === "function" ? style(state) : style,
          "aria-disabled": disabled || undefined,
        },
        props,
      ),
      "data-slot": "button",
    },
  });
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  if (props.nativeButton === false && props.render) {
    return <ButtonLink className={className} variant={variant} size={size} {...props} />;
  }
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
