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
  showLowerThird: true, scrollTitles: true, hideCaptions: true, youtubeAccountPlayback: false,
  skipVoting: true, skipThreshold: 3, allowSuggestions: true,
  twitchMode: 'disabled', twitchChannel: '', twitchAdminWhitelist: Object.freeze([]),
  kickEnabled: false, kickChannel: '', kickChatroomId: '', kickAdminWhitelist: Object.freeze([]),
  soopEnabled: false, soopChannel: '', soopAdminWhitelist: Object.freeze([]),
  lowerThird: { x: 3, y: 0, width: 34, height: 0, backgroundOpacity: 89, scale: 100, titleScale: 100, anchor: 'bottom',
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
export function normalizeAdminWhitelist(input, platform='twitch') {
  if (!Array.isArray(input) || input.some(name => typeof name !== 'string')) throw new Error('Chat admin whitelist must be a list of usernames');
  const names = input.map(name => name.trim().replace(/^@/, '').toLowerCase());
  const pattern=platform==='twitch'?/^[a-z0-9_]{1,25}$/:/^[a-z0-9_][a-z0-9_.-]{0,79}$/;
  if (names.some(name => !pattern.test(name))) throw new Error('Invalid chat admin usernames: use account login IDs, not display names');
  const unique = [...new Set(names)];
  if (unique.length > 100) throw new Error('Add at most 100 chat admin usernames');
  return unique;
}
export function normalizeSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  return {
    ...DEFAULT_SETTINGS, ...input,
    twitchAdminWhitelist: Array.isArray(input.twitchAdminWhitelist) ? [...input.twitchAdminWhitelist] : (input.twitchAdminWhitelist ?? []),
    kickAdminWhitelist: Array.isArray(input.kickAdminWhitelist) ? [...input.kickAdminWhitelist] : (input.kickAdminWhitelist ?? []),
    soopAdminWhitelist: Array.isArray(input.soopAdminWhitelist) ? [...input.soopAdminWhitelist] : (input.soopAdminWhitelist ?? []),
    lowerThird: { ...DEFAULT_SETTINGS.lowerThird, ...(input.lowerThird || {}) },
    voteScreen: { ...DEFAULT_SETTINGS.voteScreen, ...(input.voteScreen || {}) },
    colors: { ...BRAND_COLORS, ...(input.colors || {}) }
  };
}
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings must be an object');
  const s = normalizeSettings(input);
  if (!allowed(input, Object.keys(DEFAULT_SETTINGS))) throw new Error('Unknown setting');
  if (Object.hasOwn(input, 'twitchAdminWhitelist') && !Array.isArray(input.twitchAdminWhitelist)) throw new Error('Chat admin whitelist must be a list of Twitch usernames');
  s.twitchAdminWhitelist = normalizeAdminWhitelist(s.twitchAdminWhitelist);
  for(const platform of ['kick','soop']){
    const key=platform+'AdminWhitelist';
    if(Object.hasOwn(input,key)&&!Array.isArray(input[key]))throw new Error('Chat admin whitelist must be a list of usernames');
    s[key]=normalizeAdminWhitelist(s[key],platform);
    if(!bool(s[platform+'Enabled']))throw new Error(`Invalid ${platform} toggle`);
    if(typeof s[platform+'Channel']!=='string')throw new Error(`Invalid ${platform} channel`);
    s[platform+'Channel']=s[platform+'Channel'].trim().replace(/^@/,'').toLowerCase();
    if(s[platform+'Channel']&&!/^[a-z0-9_][a-z0-9_.-]{0,79}$/.test(s[platform+'Channel']))throw new Error(`Invalid ${platform} channel`);
    if(s[platform+'Enabled']&&!s[platform+'Channel'])throw new Error(`Enter a ${platform} channel before enabling chat`);
  }
  if(typeof s.kickChatroomId!=='string'||(s.kickChatroomId&&!/^[1-9]\d{0,19}$/.test(s.kickChatroomId)))throw new Error('Invalid Kick chatroom ID');
  if (!text(s.channelLabel, 42) || !s.channelLabel.trim()) throw new Error('Channel label must have 1-42 characters');
  for (const k of ['loop','voteOnEnd','showLowerThird','scrollTitles','hideCaptions','youtubeAccountPlayback','skipVoting','allowSuggestions']) {
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
  // height=0 preserves the content-driven height of older installations.
  if (!(lt.height===0 || num(lt.height,4,65)) || !num(lt.backgroundOpacity,0,100)) throw new Error('Lower third height must be Auto (0) or 4-65%; opacity must be 0-100%');
  if (lt.height>0 && lt.height+lt.y>100) throw new Error('Lower third height and anchor margin must fit within the OBS frame');
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
