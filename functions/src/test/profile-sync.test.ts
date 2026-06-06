import { expect } from "chai";

describe("Profile Snapshot Sync", () => {
  describe("PROFILE_SNAPSHOT_SYNC_QUERY_LIMIT", () => {
    it("should cap each snapshot sync query", async () => {
      const { PROFILE_SNAPSHOT_SYNC_QUERY_LIMIT } = await import(
        "../handlers/user/profile-sync"
      );

      expect(PROFILE_SNAPSHOT_SYNC_QUERY_LIMIT).to.equal(500);
    });
  });

  describe("buildUserProfileUpdates", () => {
    it("should detect display name and icon url changes", async () => {
      const { buildUserProfileUpdates } = await import(
        "../handlers/user/profile-sync"
      );

      expect(
        buildUserProfileUpdates({
          userId: "user-1",
          before: {
            displayName: "Old Name",
            iconUrl: "https://example.com/old.jpg",
          },
          after: {
            displayName: "New Name",
            iconUrl: "https://example.com/new.jpg",
          },
          updatedAt: new Date("2026-05-24T00:00:00Z"),
        })
      ).to.deep.equal([
        {
          id: "user-1_displayName_1779580800000",
          userId: "user-1",
          fieldName: "displayName",
          oldValue: "Old Name",
          newValue: "New Name",
          updatedAt: new Date("2026-05-24T00:00:00Z"),
          isProcessed: false,
          retryCount: 0,
        },
        {
          id: "user-1_iconUrl_1779580800000",
          userId: "user-1",
          fieldName: "iconUrl",
          oldValue: "https://example.com/old.jpg",
          newValue: "https://example.com/new.jpg",
          updatedAt: new Date("2026-05-24T00:00:00Z"),
          isProcessed: false,
          retryCount: 0,
        },
      ]);
    });

    it("should return empty updates when profile snapshot fields did not change", async () => {
      const { buildUserProfileUpdates } = await import(
        "../handlers/user/profile-sync"
      );

      expect(
        buildUserProfileUpdates({
          userId: "user-1",
          before: { displayName: "Name", iconUrl: null },
          after: { displayName: "Name", iconUrl: null },
          updatedAt: new Date("2026-05-24T00:00:00Z"),
        })
      ).to.deep.equal([]);
    });
  });

  describe("buildProfileSnapshotUpdate", () => {
    it("should map displayName and iconUrl to actor snapshot fields", async () => {
      const { buildProfileSnapshotUpdate } = await import(
        "../handlers/user/profile-sync"
      );

      expect(
        buildProfileSnapshotUpdate({
          displayName: "New Name",
          iconUrl: "https://example.com/icon.jpg",
        })
      ).to.deep.equal({
        userDisplayName: "New Name",
        userPhotoUrl: "https://example.com/icon.jpg",
      });
    });

    it("should omit unchanged profile fields", async () => {
      const { buildProfileSnapshotUpdate } = await import(
        "../handlers/user/profile-sync"
      );

      expect(buildProfileSnapshotUpdate({ displayName: "New Name" })).to.deep.equal({
        userDisplayName: "New Name",
      });
    });

    it("should preserve empty icon url updates", async () => {
      const { buildProfileSnapshotUpdate } = await import(
        "../handlers/user/profile-sync"
      );

      expect(buildProfileSnapshotUpdate({ iconUrl: "" })).to.deep.equal({
        userPhotoUrl: "",
      });
    });
  });

  describe("buildScheduleOwnerSnapshotUpdate", () => {
    it("should map profile updates to schedule owner snapshot fields", async () => {
      const { buildScheduleOwnerSnapshotUpdate } = await import(
        "../handlers/user/profile-sync"
      );

      expect(
        buildScheduleOwnerSnapshotUpdate({
          displayName: "New Name",
          iconUrl: "https://example.com/icon.jpg",
        })
      ).to.deep.equal({
        ownerDisplayName: "New Name",
        ownerPhotoUrl: "https://example.com/icon.jpg",
      });
    });

    it("should preserve empty owner icon url updates", async () => {
      const { buildScheduleOwnerSnapshotUpdate } = await import(
        "../handlers/user/profile-sync"
      );

      expect(buildScheduleOwnerSnapshotUpdate({ iconUrl: "" })).to.deep.equal({
        ownerPhotoUrl: "",
      });
    });
  });

  describe("buildNotificationSnapshotUpdate", () => {
    it("should update sender and receiver display name snapshots independently", async () => {
      const { buildNotificationSnapshotUpdate } = await import(
        "../handlers/user/profile-sync"
      );

      expect(
        buildNotificationSnapshotUpdate({
          userId: "user-1",
          notification: {
            sendUserId: "user-1",
            receiveUserId: "user-2",
          },
          latestUpdates: { displayName: "New Name" },
        })
      ).to.deep.equal({
        sendUserDisplayName: "New Name",
      });

      expect(
        buildNotificationSnapshotUpdate({
          userId: "user-1",
          notification: {
            sendUserId: "user-2",
            receiveUserId: "user-1",
          },
          latestUpdates: { displayName: "New Name" },
        })
      ).to.deep.equal({
        receiveUserDisplayName: "New Name",
      });
    });

    it("should return empty update when display name did not change", async () => {
      const { buildNotificationSnapshotUpdate } = await import(
        "../handlers/user/profile-sync"
      );

      expect(
        buildNotificationSnapshotUpdate({
          userId: "user-1",
          notification: {
            sendUserId: "user-1",
            receiveUserId: "user-2",
          },
          latestUpdates: { iconUrl: "https://example.com/icon.jpg" },
        })
      ).to.deep.equal({});
    });
  });
});
