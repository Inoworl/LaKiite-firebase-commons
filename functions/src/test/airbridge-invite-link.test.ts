import { expect } from "chai";

describe("Airbridge friend invite link", () => {
  describe("buildFriendInviteDeeplinkUrl", () => {
    it("uses the dev scheme outside prod projects", async () => {
      const { buildFriendInviteDeeplinkUrl } = await import(
        "../handlers/deep-link/airbridge-invite-link"
      );

      expect(
        buildFriendInviteDeeplinkUrl(
          "Pj5I7M58",
          "lakiite-flutter-app-dev"
        )
      ).to.equal("lakiitedev://friend/search?searchId=Pj5I7M58");
    });

    it("uses the prod scheme for prod projects", async () => {
      const { buildFriendInviteDeeplinkUrl } = await import(
        "../handlers/deep-link/airbridge-invite-link"
      );

      expect(
        buildFriendInviteDeeplinkUrl(
          "Pj5I7M58",
          "lakiite-flutter-app-prod"
        )
      ).to.equal("lakiite://friend/search?searchId=Pj5I7M58");
    });
  });

  describe("buildAirbridgeTrackingLinkPayload", () => {
    it("builds a dev tracking link payload with platform fallbacks", async () => {
      const { buildAirbridgeTrackingLinkPayload } = await import(
        "../handlers/deep-link/airbridge-invite-link"
      );

      const payload = buildAirbridgeTrackingLinkPayload({
        searchId: "Pj5I7M58",
        projectId: "lakiite-flutter-app-dev",
        channel: "friend_invite_test",
        androidFallbackUrl: "https://example.com/android",
        iosFallbackUrl: "https://example.com/ios",
        desktopFallbackUrl: "https://example.com/desktop",
      });

      expect(payload).to.deep.equal({
        channel: "friend_invite_test",
        deeplinkUrl: "lakiitedev://friend/search?searchId=Pj5I7M58",
        isReengagement: "OFF",
        customShortId: payload.customShortId,
        fallbackPaths: {
          android: "https://example.com/android",
          ios: "https://example.com/ios",
          desktop: "https://example.com/desktop",
        },
      });
      expect(payload.customShortId).to.match(/^friend_[a-z0-9]{24}$/);
    });
  });

  describe("extractTrackingLinkUrl", () => {
    it("prefers shortUrl", async () => {
      const { extractTrackingLinkUrl } = await import(
        "../handlers/deep-link/airbridge-invite-link"
      );

      const url = extractTrackingLinkUrl({
        data: {
          trackingLink: {
            shortUrl: "https://abr.ge/abc123",
            link: { click: "https://lakiitedev.airbridge.io/click" },
          },
        },
      });

      expect(url).to.equal("https://abr.ge/abc123");
    });

    it("falls back to click link", async () => {
      const { extractTrackingLinkUrl } = await import(
        "../handlers/deep-link/airbridge-invite-link"
      );

      const url = extractTrackingLinkUrl({
        data: {
          trackingLink: {
            link: { click: "https://lakiitedev.airbridge.io/click" },
          },
        },
      });

      expect(url).to.equal("https://lakiitedev.airbridge.io/click");
    });
  });
});
