export interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

export function createGate(): Gate {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { opened: promise, open: () => resolve() };
}
