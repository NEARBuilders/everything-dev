import builtOn from "@/assets/built_on.png";
import builtOnRev from "@/assets/built_on_rev.png";

export function NearBranding() {
  return (
    <a
      href="https://near.dev"
      target="_blank"
      rel="noopener noreferrer"
      className="relative block h-5 w-[84px] mx-auto"
    >
      <img
        src={builtOn}
        alt="Built on NEAR"
        className="absolute inset-0 h-full w-full object-contain dark:hidden"
      />
      <img
        src={builtOnRev}
        alt="Built on NEAR"
        className="absolute inset-0 hidden h-full w-full object-contain dark:block"
      />
    </a>
  );
}
