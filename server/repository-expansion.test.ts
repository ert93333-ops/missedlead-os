import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { SupabaseRepository } from "./repository.js";

type StubOptions = {
  readonly rpcStatus: number;
};

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  })));
});

const readBody = (request: IncomingMessage) => new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  request.on("error", reject);
});

const startSupabaseStub = async ({ rpcStatus }: StubOptions) => {
  let rpcCount = 0;
  let rpcBody = "";
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    response.setHeader("Content-Type", "application/json");

    if (request.method === "POST" && path === "/rest/v1/rpc/expand_stale_quote_requests") {
      rpcCount += 1;
      rpcBody = await readBody(request);
      response.statusCode = rpcStatus;
      response.end(rpcStatus >= 400
        ? JSON.stringify({ code: "XX000", details: null, hint: null, message: "delayed matching failed" })
        : "1");
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ message: `unexpected ${request.method} ${path}` }));
  };
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind to a TCP port");
  return {
    repository: new SupabaseRepository(`http://127.0.0.1:${address.port}`, "anon-key", "service-key"),
    rpcCount: () => rpcCount,
    rpcBody: () => rpcBody,
  };
};

describe("SupabaseRepository.expandStaleQuoteRequests", () => {
  it("rejects when the atomic delayed matching RPC fails", async () => {
    // Given
    const stub = await startSupabaseStub({ rpcStatus: 500 });

    // When
    const expansion = stub.repository.expandStaleQuoteRequests("2026-09-08T12:00:00.000Z");

    // Then
    await expect(expansion).rejects.toMatchObject({ message: "delayed matching failed" });
    expect(stub.rpcCount()).toBe(1);
  });

  it("passes the recorded time to one successful delayed matching RPC", async () => {
    // Given
    const stub = await startSupabaseStub({ rpcStatus: 200 });

    // When
    const expansion = stub.repository.expandStaleQuoteRequests("2026-09-08T12:00:00.000Z");

    // Then
    await expect(expansion).resolves.toBeUndefined();
    expect(stub.rpcCount()).toBe(1);
    expect(stub.rpcBody()).toBe(JSON.stringify({ p_now: "2026-09-08T12:00:00.000Z" }));
  });
});
