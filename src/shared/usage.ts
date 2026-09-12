import { z } from "zod";
import { id } from "./contracts";

const time = z.iso.datetime({ offset: true });
export const usageConfigSchema = z
  .object({
    providers: z
      .array(
        z.object({
          instanceId: id,
          enabled: z.boolean().optional(),
          installed: z.boolean().optional(),
          driver: z.string().min(1).max(256),
          displayName: z.string().min(1).max(256).optional(),
          usageLimits: z
            .object({
              checkedAt: time,
              windows: z
                .array(
                  z.object({
                    id,
                    kind: z
                      .enum(["session", "weekly", "monthly", "other"])
                      .optional(),
                    windowDurationMins: z
                      .number()
                      .int()
                      .nonnegative()
                      .optional(),
                    label: z.string().min(1).max(256),
                    usedPercent: z.number().min(0).max(100),
                    resetsAt: time.optional(),
                  }),
                )
                .max(100),
              unavailable: z
                .object({ reason: z.enum(["unsupported", "probeFailed"]) })
                .optional(),
            })
            .optional(),
        }),
      )
      .max(1000),
  })
  .refine(
    ({ providers }) =>
      new Set(providers.map((p) => p.instanceId)).size === providers.length,
  );

export interface UsagePreview {
  providers: z.infer<typeof usageConfigSchema>["providers"];
  error: string | null;
}

export function usageLabel(usage: UsagePreview | null, instanceId?: string) {
  if (!usage) return { text: "Usage …", title: "Loading provider usage" };
  if (usage.error) return { text: "Usage —", title: usage.error };
  const providers = usage.providers.filter(
    (p) => !instanceId || p.instanceId === instanceId,
  );
  const windows = providers.flatMap((p) => {
    const limits = p.usageLimits;
    if (!limits || limits.unavailable) return [];
    return limits.windows.map((w) => ({
      ...w,
      provider: p.displayName ?? p.driver,
      checkedAt: limits.checkedAt,
    }));
  });
  if (!windows.length)
    return { text: "Usage —", title: "Usage unavailable for this provider" };
  const tightest = windows.reduce((a, b) =>
    a.usedPercent >= b.usedPercent ? a : b,
  );
  return {
    text: `${Math.floor(100 - tightest.usedPercent)}% left`,
    title: windows
      .map(
        (w) =>
          `${w.provider} · ${w.label}: ${Math.floor(100 - w.usedPercent)}% left${w.resetsAt ? ` · Resets ${new Date(w.resetsAt).toLocaleString()}` : ""} · Checked ${new Date(w.checkedAt).toLocaleString()}`,
      )
      .join("\n"),
  };
}

export const usagePreferencesSchema = z.record(
  id,
  z.object({
    collapsed: z.array(id).max(100).optional(),
    expanded: z.array(id).max(100).optional(),
  }),
);
export type UsagePreferences = z.infer<typeof usagePreferencesSchema>;
export const savedUsagePreferencesSchema = z.record(id, usagePreferencesSchema);
export type SavedUsagePreferences = z.infer<typeof savedUsagePreferencesSchema>;

/** Display only usable limits, without assuming a particular provider driver. */
export function providerAllowances(
  usage: UsagePreview | null,
  expanded: boolean,
  preferences: UsagePreferences = {},
) {
  if (!usage || usage.error) return [];
  return usage.providers.flatMap((provider) => {
    const limits = provider.usageLimits;
    if (
      provider.enabled === false ||
      provider.installed === false ||
      !limits ||
      limits.unavailable ||
      !limits.windows.length
    )
      return [];
    const session =
      limits.windows.find((window) => window.windowDurationMins === 300) ??
      limits.windows.find((window) => window.kind === "session");
    const weekly =
      limits.windows.find(
        (window) => window.kind === "weekly" && window.label === "Weekly",
      ) ?? limits.windows.find((window) => window.kind === "weekly");
    const primary = session ?? weekly ?? limits.windows[0]!;
    const selected =
      preferences[provider.instanceId]?.[expanded ? "expanded" : "collapsed"];
    const windows =
      selected === undefined
        ? expanded && session && weekly
          ? [session, weekly]
          : [primary]
        : limits.windows.filter((window) => selected.includes(window.id));
    if (!windows.length) return [];
    return [
      {
        instanceId: provider.instanceId,
        driver: provider.driver,
        name: provider.displayName ?? provider.driver,
        title: usageLabel(usage, provider.instanceId).title,
        rows: windows.map((window) => ({
          id: window.id,
          label:
            window.windowDurationMins === 300
              ? "5h"
              : window.label === "Weekly"
                ? "Week"
                : window.label,
          text: `${Math.floor(100 - window.usedPercent)}% left`,
        })),
      },
    ];
  });
}
