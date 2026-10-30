/**
 * Serbian crisis lines (D-CW-38: Serbia is the launch market). Hungarian
 * lines are added only with a Hungarian launch. Numbers are data, not copy;
 * labels come from the `calls` namespace. No availability hours are stated
 * (content rule).
 */
export const SERBIA_CRISIS_LINES = [
  { id: 'emergency', number: '112' },
  { id: 'ambulance', number: '194' },
  { id: 'centarSrce', number: '0800 300 303' },
] as const;
