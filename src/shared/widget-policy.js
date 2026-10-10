export function widgetPolicy(config, visibility) {
  const batteryPaused = visibility.onBattery && config?.system?.battery === 'pause';
  return {
    hidden: !!(visibility.locked || visibility.hibernating),
    paused: !!(config?.paused || batteryPaused),
    fps: visibility.onBattery ? 15 : 30,
  };
}
