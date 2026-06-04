import { expect } from "chai";
import { isExampleEmail } from "../notification-service";

describe("Notification Service", () => {
  describe("isExampleEmail", () => {
    it("returns true for example.com email addresses", () => {
      expect(isExampleEmail("test@example.com")).to.equal(true);
      expect(isExampleEmail("TEST@EXAMPLE.COM")).to.equal(true);
    });

    it("returns false for non-example.com email addresses", () => {
      expect(isExampleEmail("test@example.jp")).to.equal(false);
      expect(isExampleEmail(null)).to.equal(false);
      expect(isExampleEmail(undefined)).to.equal(false);
    });
  });
});
