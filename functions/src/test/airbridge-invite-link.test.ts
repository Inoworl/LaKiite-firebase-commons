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

      expect(payload).to.include({
        channel: "friend_invite_test",
        deeplinkUrl: "lakiitedev://friend/search?searchId=Pj5I7M58",
        isReengagement: "OFF",
      });
      expect(payload).not.to.have.property("deeplinkOption");
      expect(payload.fallbackPaths).to.deep.equal({
        android: "https://example.com/android",
        ios: "https://example.com/ios",
        desktop: "https://example.com/desktop",
      });
      expect(payload.customShortId).to.match(/^friend_[a-z0-9]{17}$/);
      expect(payload.customShortId).to.have.length(24);
    });

    it("uses dev install distribution URLs by default", async () => {
      const { buildAirbridgeTrackingLinkPayload } = await import(
        "../handlers/deep-link/airbridge-invite-link"
      );

      const payload = buildAirbridgeTrackingLinkPayload({
        searchId: "Pj5I7M58",
        projectId: "lakiite-flutter-app-dev",
      });

      expect(payload.fallbackPaths).to.deep.equal({
        android:
          "https://appdistribution.firebase.google.com/testerapps/1:3311967889:android:70d7247f19e5f65438a930/releases/4aibmmfq1gh2g",
        ios: "https://testflight.apple.com/v1/app/6755344095",
        desktop: "https://lakiite-flutter-app-dev.web.app",
      });
    });

    it("keeps prod default fallbacks unchanged", async () => {
      const { buildAirbridgeTrackingLinkPayload } = await import(
        "../handlers/deep-link/airbridge-invite-link"
      );

      const payload = buildAirbridgeTrackingLinkPayload({
        searchId: "Pj5I7M58",
        projectId: "lakiite-flutter-app-prod",
      });

      expect(payload.fallbackPaths).to.deep.equal({
        android:
          "https://play.google.com/store/apps/details?id=com.inoworl.lakiite",
        ios: "https://lakiite-flutter-app-prod.web.app",
        desktop: "https://lakiite-flutter-app-prod.web.app",
      });
    });

    it("uses an explicit customShortId when provided", async () => {
      const { buildAirbridgeTrackingLinkPayload } = await import(
        "../handlers/deep-link/airbridge-invite-link"
      );

      const payload = buildAirbridgeTrackingLinkPayload({
        searchId: "Pj5I7M58",
        projectId: "lakiite-flutter-app-dev",
        customShortId: "friend_custom123",
      });

      expect(payload.customShortId).to.equal("friend_custom123");
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
