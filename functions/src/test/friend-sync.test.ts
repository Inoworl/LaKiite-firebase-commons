import { expect } from "chai";
import {
  buildFriendRemovalCleanupTargets,
  getRemovedFriendIds,
} from "../handlers/user/friend-sync";

describe("Friend Sync", () => {
  describe("getRemovedFriendIds", () => {
    it("returns friend ids removed from the private profile", () => {
      const removedFriendIds = getRemovedFriendIds(
        { friends: ["friend-a", "friend-b", "friend-c"] },
        { friends: ["friend-a", "friend-c"] }
      );

      expect(removedFriendIds).to.deep.equal(["friend-b"]);
    });

    it("ignores added friend ids", () => {
      const removedFriendIds = getRemovedFriendIds(
        { friends: ["friend-a"] },
        { friends: ["friend-a", "friend-b"] }
      );

      expect(removedFriendIds).to.deep.equal([]);
    });
  });

  describe("buildFriendRemovalCleanupTargets", () => {
    it("includes both users' friendship, schedules, public lists, and display lists", () => {
      const targets = buildFriendRemovalCleanupTargets("user-a", "user-b");

      expect(targets).to.deep.equal([
        {
          kind: "friendPrivateProfile",
          userId: "user-a",
          friendId: "user-b",
        },
        {
          kind: "ownedLists",
          ownerId: "user-a",
          memberId: "user-b",
        },
        {
          kind: "ownedLists",
          ownerId: "user-b",
          memberId: "user-a",
        },
        {
          kind: "displayLists",
          ownerId: "user-a",
          memberId: "user-b",
        },
        {
          kind: "displayLists",
          ownerId: "user-b",
          memberId: "user-a",
        },
        {
          kind: "ownedSchedules",
          ownerId: "user-a",
          memberId: "user-b",
        },
        {
          kind: "ownedSchedules",
          ownerId: "user-b",
          memberId: "user-a",
        },
      ]);
    });
  });
});
