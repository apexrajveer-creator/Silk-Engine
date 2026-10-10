// Display titles for the hero: "Cat In The Swamp Live Wallpaper 4K Dark Animated Background" ->
// "Cat In The Swamp". Only a trailing run of filler words is removed (never words in the middle),
// bracketed tags are dropped, and at least one real word always remains. The stored name is
// unchanged; this is presentation only.
const NOISE = new Set(('live wallpaper wallpapers 4k 8k 2k 5k uhd hd fhd qhd 1080p 1440p 2160p 4320p 60fps 30fps 120fps 144fps ' +
  'animated animation background backgrounds bg loop looped loopable seamless dark desktop engine free download ' +
  'official video mv lyric lyrics hq hdr edit amv 3d motion moving screensaver').split(' '));
const strip = w => w.toLowerCase().replace(/[^a-z0-9]/g, '');

export function cleanTitle(name) {
  const raw = String(name ?? '').replace(/_+/g, ' ');
  let s = raw.replace(/\s*[[(][^\])]*[\])]\s*/g, ' ')        // (Official Video), [4K]
    .split(/\s+[|•]\s+|\s+-\s+https?:/i)[0]                 // "Title | channel", "x - https://…"
    .replace(/https?:\S+/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  const words = s.split(' ').filter(Boolean);
  let end = words.length;
  while (end > 1 && (NOISE.has(strip(words[end - 1])) || strip(words[end - 1]) === '')) end--;
  const out = words.slice(0, end).join(' ').replace(/[\s\-–—:·,]+$/, '').trim();
  return out || raw.replace(/\s+/g, ' ').trim() || 'Untitled';
}
