export function batteryDisplay(metrics) {
  const value = metrics?.battery;
  const valid = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
  const present = metrics?.hasBattery;
  return { text: present === false ? 'AC' : valid ? `${Math.round(value)}%` : '—', level: valid ? value / 100 : 0, charging: !!metrics?.charging, low: valid && value <= 20 && !metrics?.charging, label: present === false ? 'Connected to power; no battery' : valid ? `Battery ${Math.round(value)} percent${metrics?.charging ? ', charging' : ''}` : 'Battery information unavailable' };
}
export function visualizerLevels(audio, count = 8) {
  const unit = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const bands = Array.isArray(audio?.bands) ? audio.bands : [];
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor(i * bands.length / count), to = Math.max(from + 1, Math.floor((i + 1) * bands.length / count));
    const peak = bands.slice(from, to).reduce((n, x) => Math.max(n, unit(x)), 0);
    return Math.max(.12, Math.sqrt(peak) * .94);
  });
}
