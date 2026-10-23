type ShareResult = "shared" | "copied" | "cancelled";

export async function shareOrCopy(text: string): Promise<ShareResult> {
  if (
    typeof navigator.share === "function" &&
    (!navigator.canShare || navigator.canShare({ text }))
  ) {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
    }
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}
