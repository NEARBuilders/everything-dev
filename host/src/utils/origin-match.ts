export function originMatches(pattern: string, origin: string): boolean {
  const trimmedPattern = pattern.trim().toLowerCase();
  const trimmedOrigin = origin.trim().toLowerCase();
  if (!trimmedPattern || !trimmedOrigin) return false;

  if (!trimmedPattern.includes("*") && !trimmedPattern.includes("?")) {
    try {
      return new URL(trimmedPattern).origin === new URL(trimmedOrigin).origin;
    } catch {
      return trimmedPattern === trimmedOrigin;
    }
  }

  try {
    if (trimmedPattern.includes("://")) {
      return globToRegExp(trimmedPattern, "/").test(trimmedOrigin);
    }
    return globToRegExp(trimmedPattern, ".").test(new URL(trimmedOrigin).hostname);
  } catch {
    return false;
  }
}

function globToRegExp(pattern: string, separator: "/" | "."): RegExp {
  const single = separator === "/" ? "[^/]" : "[^.]";
  const many = `${single}*`;
  let source = "";
  for (const char of pattern) {
    if (char === "*") source += many;
    else if (char === "?") source += single;
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}
