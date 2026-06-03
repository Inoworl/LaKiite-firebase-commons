import { expect } from "chai";

describe("Schedule digest helpers", () => {
  it("builds default settings enabled at 8", async () => {
    const { buildDefaultScheduleDigestSettings } = await import("../handlers/schedule-digest/utils");

    const settings = buildDefaultScheduleDigestSettings();

    expect(settings.enabled).to.equal(true);
    expect(settings.notifyHour).to.equal(8);
    expect(settings.lastSentDate).to.equal(null);
  });

  it("only accepts 0-9 as morning notifyHour", async () => {
    const { isMorningNotifyHour } = await import("../handlers/schedule-digest/utils");

    expect(isMorningNotifyHour(0)).to.equal(true);
    expect(isMorningNotifyHour(9)).to.equal(true);
    expect(isMorningNotifyHour(10)).to.equal(false);
    expect(isMorningNotifyHour(-1)).to.equal(false);
  });

  it("does not send when shared schedule count is zero", async () => {
    const { shouldSendScheduleDigest } = await import("../handlers/schedule-digest/utils");

    expect(shouldSendScheduleDigest(0)).to.equal(false);
    expect(shouldSendScheduleDigest(1)).to.equal(true);
  });
});
