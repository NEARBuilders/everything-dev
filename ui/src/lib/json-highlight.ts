export function highlightJson(json: string): string {
  return json.replace(
    /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (_match, key, str, bool, num) => {
      if (key) return `<span class="text-[#79c0ff]">${key}</span>:`;
      if (str) return `<span class="text-[#a5d6ff]">${str}</span>`;
      if (bool) return `<span class="text-[#ff7b72]">${bool}</span>`;
      if (num) return `<span class="text-[#79c0ff]">${num}</span>`;
      return "";
    },
  );
}
