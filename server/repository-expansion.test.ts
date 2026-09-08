import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { SupabaseRepository } from "./repository.js";

type StubOptions = {
  readonly updateStatus: number;
};

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  })));
});

const startSupabaseStub = async ({ updateStatus }: StubOptions) => {
  let updateCount = 0;
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    response.setHeader("Content-Type", "application/json");

    if (request.method === "GET" && path === "/rest/v1/service_requests") {
      response.end(JSON.stringify([{ id: "request-1" }]));
      return;
    }
    if (request.method === "GET" && ["/rest/v1/request_matches", "/rest/v1/quotes", "/rest/v1/profiles"].includes(path)) {
      response.end("[]");
      return;
    }
    if (request.method === "PATCH" && path === "/rest/v1/service_requests") {
      updateCount += 1;
      response.statusCode = updateStatus;
      response.end(updateStatus >= 400
        ? JSON.stringify({ code: "XX000", details: null, hint: null, message: "update failed" })
        : "[]");
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
    updateCount: () => updateCount,
  };
};

describe("SupabaseRepository.expandStaleQuoteRequests", () => {
  it("rejects when the final request expansion update fails", async () => {
    // Given
    const stub = await startSupabaseStub({ updateStatus: 500 });

    // When
    const expansion = stub.repository.expandStaleQuoteRequests("2026-09-05T12:00:00.000Z");

    // Then
    await expect(expansion).rejects.toMatchObject({ message: "update failed" });
    expect(stub.updateCount()).toBe(1);
  });

  it("resolves when the final request expansion update succeeds", async () => {
    // Given
    const stub = await startSupabaseStub({ updateStatus: 200 });

    // When
    const expansion = stub.repository.expandStaleQuoteRequests("2026-09-05T12:00:00.000Z");

    // Then
    await expect(expansion).resolves.toBeUndefined();
    expect(stub.updateCount()).toBe(1);
  });
});
