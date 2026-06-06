import { expect } from "chai";
import firebaseAdmin = require("firebase-admin");

type StatusRequest = Parameters<
  typeof import("../handlers/user/manual-sync").getUserDataSyncStatus
>[0];
type StatusResponse = Parameters<
  typeof import("../handlers/user/manual-sync").getUserDataSyncStatus
>[1];

type AdminModule = {
  auth?: () => {
    verifyIdToken: (token: string) => Promise<Record<string, unknown>>;
  };
  firestore?: () => {
    collection: (name: string) => QueryMock;
  };
};

type QueryMock = {
  where: (field: string, operator: string, value: unknown) => QueryMock;
  count: () => { get: () => Promise<{ data: () => { count: number } }> };
  orderBy: (field: string, direction: string) => QueryMock;
  limit: (limit: number) => QueryMock;
  get: () => Promise<{
    empty: boolean;
    docs: { data: () => Record<string, unknown> }[];
  }>;
};

type MockResponse = StatusResponse & {
  statusCodeValue?: number;
  body?: unknown;
  headers: Record<string, string | string[]>;
};

function replaceAdminExport(
  name: keyof AdminModule,
  value: unknown
): () => void {
  const adminModule = firebaseAdmin as unknown as AdminModule;
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    adminModule,
    name
  );

  Object.defineProperty(adminModule, name, {
    configurable: true,
    value,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(adminModule, name, originalDescriptor);
    } else {
      delete adminModule[name];
    }
  };
}

function mockAdminAuth(
  verifyIdToken: (token: string) => Promise<Record<string, unknown>>
): () => void {
  return replaceAdminExport("auth", () => ({ verifyIdToken }));
}

function mockFirestoreForStatus(countCalls: string[]): () => void {
  const countsByWhere = new Map<string, number>([
    ["isProcessed == false", 4],
    ["retryCount >= 3", 2],
    ["isProcessed == true", 10],
  ]);

  const createQuery = (
    collectionName: string,
    whereCalls: string[] = []
  ): QueryMock => ({
    where: (field: string, operator: string, value: unknown) =>
      createQuery(collectionName, [...whereCalls, `${field} ${operator} ${value}`]),
    count: () => ({
      get: async () => {
        const whereKey = whereCalls.join(" && ");
        countCalls.push(whereKey);
        return { data: () => ({ count: countsByWhere.get(whereKey) ?? 0 }) };
      },
    }),
    orderBy: () => createQuery(collectionName, whereCalls),
    limit: () => createQuery(collectionName, whereCalls),
    get: async () => ({
      empty: false,
      docs: [{ data: () => ({ processedUsers: 3, errors: 0 }) }],
    }),
  });

  return replaceAdminExport("firestore", () => ({
    collection: (name: string) => createQuery(name),
  }));
}

function createResponse(): MockResponse {
  const response = { headers: {} } as unknown as MockResponse;

  response.on = () => response;
  response.status = (code: number) => {
    response.statusCodeValue = code;
    return response;
  };
  response.send = (body: unknown) => {
    response.body = body;
    return response;
  };
  response.set = (name: string, value?: string | string[]) => {
    response.headers[name] = value ?? "";
    return response;
  };
  response.setHeader = (name: string, value: string | string[]) => {
    response.headers[name] = value;
    return response;
  };
  response.getHeader = (name: string) => response.headers[name];
  response.end = (body?: unknown) => {
    response.body = body;
    return response;
  };

  return response;
}

describe("Manual user data sync status", () => {
  it("rejects non-admin users before reading Firestore", async () => {
    const restoreAdminAuth = mockAdminAuth(async () => ({
      uid: "user-1",
      admin: false,
    }));
    const countCalls: string[] = [];
    const restoreFirestore = mockFirestoreForStatus(countCalls);

    try {
      const { getUserDataSyncStatus } = await import(
        "../handlers/user/manual-sync"
      );
      const response = createResponse();

      await getUserDataSyncStatus(
        {
          method: "GET",
          headers: { authorization: "Bearer user-token" },
        } as unknown as StatusRequest,
        response
      );

      expect(response.statusCodeValue).to.equal(403);
      expect(response.body).to.deep.equal({ error: "管理者権限が必要です" });
      expect(countCalls).to.deep.equal([]);
    } finally {
      restoreFirestore();
      restoreAdminAuth();
    }
  });

  it("uses count aggregation and preserves the status response shape", async () => {
    const restoreAdminAuth = mockAdminAuth(async () => ({
      uid: "admin-user",
      admin: true,
    }));
    const countCalls: string[] = [];
    const restoreFirestore = mockFirestoreForStatus(countCalls);

    try {
      const { getUserDataSyncStatus } = await import(
        "../handlers/user/manual-sync"
      );
      const response = createResponse();

      await getUserDataSyncStatus(
        {
          method: "GET",
          headers: { authorization: "Bearer admin-token" },
        } as unknown as StatusRequest,
        response
      );

      expect(countCalls).to.have.members([
        "isProcessed == false",
        "retryCount >= 3",
        "isProcessed == true",
      ]);
      expect(response.statusCodeValue).to.equal(200);
      expect(response.body).to.include({
        pending: 4,
        failed: 2,
        processed: 10,
        total: 16,
      });
      expect((response.body as Record<string, unknown>).lastBatchStats).to
        .deep.equal({
          processedUsers: 3,
          errors: 0,
        });
      expect(response.body).to.have.property("timestamp");
    } finally {
      restoreFirestore();
      restoreAdminAuth();
    }
  });
});
