import {
  providerAllowances,
  type UsagePreferences,
  type UsagePreview,
} from "../shared/usage";
import { ProviderIcon } from "./ProviderIcon";

export function UsageSettings({
  usage,
  preferences,
  onChange,
}: {
  usage: UsagePreview | null;
  preferences: UsagePreferences;
  onChange: (preferences: UsagePreferences) => void;
}) {
  const collapsed = providerAllowances(usage, false, preferences);
  const expanded = providerAllowances(usage, true, preferences);
  const providers = usage?.error
    ? []
    : (usage?.providers.filter(
        (p) =>
          p.enabled !== false &&
          p.installed !== false &&
          p.usageLimits &&
          !p.usageLimits.unavailable &&
          p.usageLimits.windows.length,
      ) ?? []);
  return (
    <details className="usage-settings">
      <summary>Customize usage display</summary>
      <p>
        Select limits for each view. Clear a column to hide that provider in
        that view.
      </p>
      {!providers.length && (
        <p>Connect to T3 to load available usage limits.</p>
      )}
      {providers.map((provider) => (
        <fieldset key={provider.instanceId}>
          <legend>
            <ProviderIcon driver={provider.driver} />{" "}
            {provider.displayName ?? provider.driver}
          </legend>
          <table>
            <thead>
              <tr>
                <th scope="col">Limit</th>
                <th scope="col">Collapsed</th>
                <th scope="col">Expanded</th>
              </tr>
            </thead>
            <tbody>
              {provider.usageLimits?.windows.map((window) => (
                <tr key={window.id}>
                  <th scope="row">
                    {window.windowDurationMins === 300
                      ? "5 hours"
                      : window.label}
                  </th>
                  {(["collapsed", "expanded"] as const).map((mode) => {
                    const selected =
                      (mode === "collapsed" ? collapsed : expanded)
                        .find((p) => p.instanceId === provider.instanceId)
                        ?.rows.map((row) => row.id) ?? [];
                    return (
                      <td key={mode}>
                        <input
                          type="checkbox"
                          aria-label={`${provider.displayName ?? provider.driver}: ${window.label}, ${mode}`}
                          checked={selected.includes(window.id)}
                          onChange={(event) =>
                            onChange({
                              ...preferences,
                              [provider.instanceId]: {
                                ...preferences[provider.instanceId],
                                [mode]: event.target.checked
                                  ? [...selected, window.id]
                                  : selected.filter((id) => id !== window.id),
                              },
                            })
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={() => {
              const next = { ...preferences };
              delete next[provider.instanceId];
              onChange(next);
            }}
          >
            Reset provider defaults
          </button>
        </fieldset>
      ))}
    </details>
  );
}
