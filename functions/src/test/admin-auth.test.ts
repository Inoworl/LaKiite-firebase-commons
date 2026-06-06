import { expect } from "chai";
import firebaseAdmin = require("firebase-admin");

type AdminModule = {
  auth?: () => {
    verifyIdToken: (token: string) => Promise<Record<string, unknown>>;
  };
};

function mockAdminAuth(
  verifyIdToken: (token: string) => Promise<Record<string, unknown>>
): () => void {
  const adminModule = firebaseAdmin as unknown as AdminModule;
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    adminModule,
    "auth"
  );

  Object.defineProperty(adminModule, "auth", {
    configurable: true,
    value: () => ({ verifyIdToken }),
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(adminModule, "auth", originalDescriptor);
    } else {
      delete adminModule.auth;
    }
  };
}

describe("Admin auth helpers", () => {
  describe("hasAdminClaim", () => {
    it("only accepts an explicit admin true custom claim", async () => {
      const { hasAdminClaim } = await import("../handlers/auth/admin");

      expect(hasAdminClaim({ admin: true })).to.equal(true);
      expect(hasAdminClaim({ admin: false })).to.equal(false);
      expect(hasAdminClaim({ admin: "true" })).to.equal(false);
      expect(hasAdminClaim({ uid: "user-1" })).to.equal(false);
    });
  });

  describe("verifyAdminAuthorizationHeader", () => {
    it("rejects missing bearer tokens", async () => {
      const { AdminAuthError, verifyAdminAuthorizationHeader } = await import(
        "../handlers/auth/admin"
      );

      try {
        await verifyAdminAuthorizationHeader(undefined);
        throw new Error("Expected auth to fail");
      } catch (error) {
        expect(error).to.be.instanceOf(AdminAuthError);
        expect((error as InstanceType<typeof AdminAuthError>).status).to.equal(
          401
        );
      }
    });

    it("rejects non-admin Firebase ID tokens", async () => {
      const restoreAdminAuth = mockAdminAuth(async () => ({
        uid: "user-1",
        admin: false,
      }));

      try {
        const { AdminAuthError, verifyAdminAuthorizationHeader } = await import(
          "../handlers/auth/admin"
        );

        try {
          await verifyAdminAuthorizationHeader("Bearer user-token");
          throw new Error("Expected auth to fail");
        } catch (error) {
          expect(error).to.be.instanceOf(AdminAuthError);
          expect(
            (error as InstanceType<typeof AdminAuthError>).status
          ).to.equal(403);
        }
      } finally {
        restoreAdminAuth();
      }
    });

    it("returns decoded tokens for admin Firebase ID tokens", async () => {
      const restoreAdminAuth = mockAdminAuth(async (token) => ({
        uid: "admin-user",
        admin: token === "admin-token",
      }));

      try {
        const { verifyAdminAuthorizationHeader } = await import(
          "../handlers/auth/admin"
        );

        const decodedToken = await verifyAdminAuthorizationHeader(
          "Bearer admin-token"
        );

        expect(decodedToken.uid).to.equal("admin-user");
      } finally {
        restoreAdminAuth();
      }
    });
  });
});
