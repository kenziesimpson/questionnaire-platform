import { connect } from "node:net";

const RESPONSE_TIMEOUT_MS = 10_000;

const STATUS_LINE = /^HTTP\/1\.[01] (\d{3})/;

interface RawRequest {
  readonly baseUrl: string;
  readonly target: string;
  readonly host: string;
  readonly headers?: readonly string[];
}

export function sendRawRequest({ baseUrl, target, host, headers = [] }: RawRequest): Promise<number> {
  const { hostname, port } = new URL(baseUrl);
  const head = [`GET ${target} HTTP/1.1`, `Host: ${host}`, "Connection: close", ...headers, "", ""].join("\r\n");
  return new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, port: Number(port) });
    const chunks: Buffer[] = [];
    socket.setTimeout(RESPONSE_TIMEOUT_MS, () => {
      socket.destroy(new Error(`No response to a raw request within ${RESPONSE_TIMEOUT_MS} ms`));
    });
    socket.on("connect", () => {
      socket.write(Buffer.from(head, "utf8"));
    });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    socket.on("error", reject);
    socket.on("close", () => {
      const status = STATUS_LINE.exec(Buffer.concat(chunks).toString("latin1"))?.[1];
      if (status === undefined) {
        reject(new Error("The server closed the connection without an HTTP status line"));
        return;
      }
      resolve(Number(status));
    });
  });
}
