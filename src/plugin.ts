import type { H3 } from "./h3.ts";

export type H3Plugin = (h3: H3) => void;

export function definePlugin<T = unknown>(
  def: (h3: H3, options: T) => void,
): undefined extends T ? (options?: T) => H3Plugin : (options: T) => H3Plugin {
  return ((opts?: any) => (h3: H3) => def(h3, opts)) as any;
}
