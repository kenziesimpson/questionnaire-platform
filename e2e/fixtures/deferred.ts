export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void = () => undefined;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}
