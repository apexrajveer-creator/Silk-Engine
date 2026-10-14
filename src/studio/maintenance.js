export function maintenance({ bridge, flush, notify, state }) {
  const $ = id => document.getElementById(id);
  const errors = [];
  function log(message) {
    if (errors.length === 30) errors.shift();
    errors.push({ time: new Date().toISOString(), message: String(message).slice(0, 400) });
  }
  addEventListener('error', event => log(event.message || 'UI error'));
  addEventListener('unhandledrejection', event => log(event.reason?.message || event.reason));
  bridge.listen('app-error', log); bridge.listen('renderer-error', log);
  function action(id, run) {
    $(id).onclick = async () => {
      $(id).disabled = true;
      try { await run(); } catch (error) { log(error); notify(error.message || String(error)); }
      finally { $(id).disabled = false; }
    };
  }
  action('retrySettings', async () => { await flush(); notify('All changes saved'); });
  action('exportSettings', async () => {
    await flush();
    const contents = await bridge.invoke('export_settings');
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'Silk-settings-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  $('importSettings').onclick = () => $('settingsFile').click();
  $('settingsFile').onchange = async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 16 * 1024 * 1024) throw Error('Settings files must be under 16 MB');
      const contents = await file.text();
      const candidate = JSON.parse(contents);
      if (candidate.version !== 1 || !Array.isArray(candidate.items) || !candidate.assign) throw Error('Choose a Silk settings export');
      if (!confirm('Import these settings and widget layouts? A recovery copy of your current settings will be kept. Wallpaper files are not included in exports.')) return;
      await flush(); await bridge.invoke('import_settings', { contents }); notify('Settings imported');
    } catch (error) { notify(error.message || String(error)); }
  };
  action('resetPreferences', async () => {
    if (!confirm('Reset display, wallpaper appearance and power preferences? Your wallpapers and widget layout stay. You can undo this reset.')) return;
    await flush(); await bridge.invoke('reset_preferences'); notify('Preferences reset');
  });
  action('undoReset', async () => {
    if (!confirm('Restore the settings saved before your last preference reset?')) return;
    await flush(); await bridge.invoke('undo_reset'); notify('Previous preferences restored');
  });
  action('showDiagnostics', async () => {
    const native = bridge.isApp ? await bridge.invoke('diagnostics') : { platform: 'browser', version: '1.5.0', monitors: state().monitors };
    $('diagnosticsText').value = JSON.stringify({ ...native, ui: { dpr: devicePixelRatio, width: innerWidth, height: innerHeight, online: navigator.onLine }, errors }, null, 2);
    $('diagnosticsPanel').hidden = false;
  });
  action('copyDiagnostics', async () => {
    try { await navigator.clipboard.writeText($('diagnosticsText').value); notify('Report copied'); }
    catch { $('diagnosticsText').focus(); $('diagnosticsText').select(); notify('Report selected. Press Ctrl+C to copy.'); }
  });
}
