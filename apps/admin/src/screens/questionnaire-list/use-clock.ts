import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;
const SECOND = 1_000;

function subscribe(onTick: () => void): () => void {
  const timer = setInterval(onTick, TICK_MS);
  return () => clearInterval(timer);
}

const currentSecond = () => Math.floor(Date.now() / SECOND) * SECOND;

export function useClock(): number {
  return useSyncExternalStore(subscribe, currentSecond);
}
