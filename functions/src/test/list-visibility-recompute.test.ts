import { expect } from "chai";

describe("List visibility recompute exports", () => {
  it("should export backfill and delete helpers", async () => {
    const {
      backfillAllScheduleVisibility,
      normalizeScheduleVisibilityForDocument,
      removeDeletedListFromSchedules,
      updateSchedulesVisibility,
    } = await import("../handlers/list/utils");

    expect(backfillAllScheduleVisibility).to.be.a("function");
    expect(normalizeScheduleVisibilityForDocument).to.be.a("function");
    expect(removeDeletedListFromSchedules).to.be.a("function");
    expect(updateSchedulesVisibility).to.be.a("function");
  });

  it("should export list deleted trigger, schedule trigger, and manual backfill function", async () => {
    const { onListDeleted } = await import("../handlers/list/triggers");
    const { onScheduleWritten } = await import("../handlers/schedule/triggers");
    const { backfillScheduleVisibility } = await import("../handlers/list/manual-sync");

    expect(onListDeleted).to.not.be.undefined;
    expect(onScheduleWritten).to.not.be.undefined;
    expect(backfillScheduleVisibility).to.not.be.undefined;
  });
});
