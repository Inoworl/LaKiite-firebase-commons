import { expect } from "chai";

describe("User Triggers", () => {
  describe("onUserCreated", () => {
    it("should be importable", async () => {
      const { onUserCreated } = await import("../handlers/user/triggers");

      expect(onUserCreated).to.not.be.undefined;
      expect(typeof onUserCreated).to.equal("function");
    });
  });

  describe("onUserUpdate", () => {
    it("should be importable", async () => {
      // トリガー関数がインポートできることを確認
      const { onUserUpdate } = await import("../handlers/user/triggers");

      expect(onUserUpdate).to.not.be.undefined;
      expect(typeof onUserUpdate).to.equal("function");
    });
  });

  describe("onUserDeleted", () => {
    it("should be importable", async () => {
      const { onUserDeleted } = await import("../handlers/user/triggers");

      expect(onUserDeleted).to.not.be.undefined;
      expect(typeof onUserDeleted).to.equal("function");
    });
  });
});
