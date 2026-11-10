import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export function useScrollToHash<T extends HTMLElement = HTMLElement>(id: string) {
  const hash = useLocation({ select: (location) => location.hash });
  const [target, setTarget] = useState<T | null>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    if (hash !== id) {
      scrolled.current = false;
      return;
    }
    if (!target || scrolled.current) return;
    scrolled.current = true;
    target.scrollIntoView();
  }, [hash, id, target]);

  return setTarget;
}
