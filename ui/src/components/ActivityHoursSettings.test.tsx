// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyActivitySchedule } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActivityHoursSettings } from "./ActivityHoursSettings";

const nights: CompanyActivitySchedule = {
  enabled: true,
  timezone: "Europe/Madrid",
  windows: [{ days: [1, 2, 3, 4, 5], start: "18:00", end: "04:00" }],
  outsideHours: "defer_automatic",
  staggerMinutes: 10,
};

describe("ActivityHoursSettings", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSave = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onSave.mockReset();
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  function render(schedule: CompanyActivitySchedule | null) {
    flushSync(() => root.render(
      <TooltipProvider>
        <ActivityHoursSettings schedule={schedule} onSave={onSave} isPending={false} errorMessage={null} />
      </TooltipProvider>,
    ));
  }

  const click = (element: Element | null | undefined) => {
    if (!element) throw new Error("Expected an element to click");
    flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  };
  const button = (name: string) =>
    [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name);

  it("sets no limit and offers nothing to save until the limit is turned on", () => {
    render(null);
    expect(container.querySelector('[data-testid="activity-hours-status"]')?.textContent).toBe("Agents can work at any time.");
    expect(container.querySelectorAll('[data-testid="activity-hours-window"]')).toHaveLength(0);
    expect(button("Save activity hours")).toBeUndefined();
  });

  it("starts from a weeknight window when the limit is turned on and saves it", () => {
    render(null);
    click(container.querySelector('[data-testid="company-settings-activity-hours-toggle"]'));
    expect(container.querySelectorAll('[data-testid="activity-hours-window"]')).toHaveLength(1);
    click(button("Save activity hours"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      windows: [{ days: [1, 2, 3, 4, 5], start: "18:00", end: "04:00" }],
      outsideHours: "defer_automatic",
    }));
  });

  it("edits the days of a window", () => {
    render(nights);
    click(container.querySelector('button[aria-label="Saturday"]'));
    click(button("Save activity hours"));
    expect(onSave).toHaveBeenCalledWith({ ...nights, windows: [{ ...nights.windows[0]!, days: [1, 2, 3, 4, 5, 6] }] });
  });

  it("does not save a schedule that is on with no window", () => {
    render(nights);
    click(button("Remove"));
    expect(container.querySelector('[data-testid="activity-hours-status"]')?.textContent).toContain("Add at least one window");
    expect(button("Save activity hours")?.disabled).toBe(true);
    click(button("Save activity hours"));
    expect(onSave).not.toHaveBeenCalled();
  });
});
