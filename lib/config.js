export const BRAND_COLORS = Object.freeze({
  background: '#0D1010', panel: '#111318', raised: '#171A1F', accent: '#00AFFF',
  text: '#FFFFFF', healthy: '#22C55E', warning: '#F59E0B', error: '#EF4444',
  info: '#3B82F6', community: '#8B5CF6'
});
export const COLOR_PRESETS = Object.freeze({
  cyan: BRAND_COLORS,
  purple: { ...BRAND_COLORS, accent: '#8B5CF6' },
  green: { ...BRAND_COLORS, accent: '#22C55E' },
  amber: { ...BRAND_COLORS, accent: '#F59E0B' }
});
export const DEFAULT_SETTINGS = Object.freeze({
  channelLabel: 'fKey Playback', loop: true, voteOnEnd: true, voteSeconds: 20,
  showLowerThird: true, scrollTitles: true, hideCaptions: true,
  skipVoting: true, skipThreshold: 3, allowSuggestions: true,
  twitchMode: 'disabled', twitchChannel: '',
  lowerThird: { x: 3, y: 0, width: 34, scale: 100, titleScale: 100, anchor: 'bottom',
    showChannelLabel: false, showNowPlaying: false, showDuration: false, showSkip: false },
  voteScreen: { heading: 'UP NEXT', instruction: '!vote 1-4 in Twitch chat',
    cardGap: 20, panelOpacity: 94, showThumbnails: true,
    showCountdown: true, showVotes: true, accentBorders: true },
  colors: BRAND_COLORS
});
const hex = /^#[0-9A-Fa-f]{6}$/;
const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const bool = v => typeof v === 'boolean';
const text = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001F\u007F]/.test(v);
const allowed = (obj, keys) => Object.keys(obj).every(k => keys.includes(k));
export function normalizeSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  return {
    ...DEFAULT_SETTINGS, ...input,
    lowerThird: { ...DEFAULT_SETTINGS.lowerThird, ...(input.lowerThird || {}) },
    voteScreen: { ...DEFAULT_SETTINGS.voteScreen, ...(input.voteScreen || {}) },
    colors: { ...BRAND_COLORS, ...(input.colors || {}) }
  };
}
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings must be an object');
  const s = normalizeSettings(input);
  if (!allowed(input, Object.keys(DEFAULT_SETTINGS))) throw new Error('Unknown setting');
  if (!text(s.channelLabel, 42) || !s.channelLabel.trim()) throw new Error('Channel label must have 1-42 characters');
  for (const k of ['loop','voteOnEnd','showLowerThird','scrollTitles','hideCaptions','skipVoting','allowSuggestions']) {
    if (!bool(s[k])) throw new Error(`${k} must be a toggle`);
  }
  if (!Number.isInteger(s.voteSeconds) || !num(s.voteSeconds, 5, 120)) throw new Error('Voting timer must be 5-120 seconds');
  if (!Number.isInteger(s.skipThreshold) || !num(s.skipThreshold, 1, 100)) throw new Error('Skip threshold must be 1-100');
  if (!['disabled','anonymous','authenticated'].includes(s.twitchMode)) throw new Error('Invalid Twitch mode');
  if (s.twitchChannel && !/^[a-zA-Z0-9_]{3,25}$/.test(s.twitchChannel)) throw new Error('Invalid Twitch channel');
  if (!allowed(s.lowerThird, Object.keys(DEFAULT_SETTINGS.lowerThird))) throw new Error('Unknown lower third field');
  const lt = s.lowerThird;
  if (!['top','bottom'].includes(lt.anchor)) throw new Error('Invalid vertical anchor');
  if (!num(lt.width,15,90) || !num(lt.x,0,100-lt.width) || !num(lt.y,0,94) || !num(lt.scale,50,200) || !num(lt.titleScale,50,300)) throw new Error('Lower third position, size or scale out of range');
  for (const key of ['showChannelLabel','showNowPlaying','showDuration','showSkip']) if (!bool(lt[key])) throw new Error(`${key} must be a toggle`);
  const vs = s.voteScreen;
  if (!allowed(vs, Object.keys(DEFAULT_SETTINGS.voteScreen))) throw new Error('Unknown vote screen field');
  if (!text(vs.heading,60) || !text(vs.instruction,120)) throw new Error('Invalid vote screen text');
  if (!num(vs.cardGap,0,60) || !num(vs.panelOpacity,30,100)) throw new Error('Invalid vote screen spacing or opacity');
  for (const k of ['showThumbnails','showCountdown','showVotes','accentBorders']) if (!bool(vs[k])) throw new Error(`${k} must be a toggle`);
  if (!allowed(s.colors,Object.keys(BRAND_COLORS))) throw new Error('Unknown color token');
  for (const [k,v] of Object.entries(s.colors)) if (typeof v !== 'string' || !hex.test(v)) throw new Error(`Invalid color: ${k}`);
  return s;
}