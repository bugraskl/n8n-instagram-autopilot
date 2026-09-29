#!/usr/bin/env node
// Weekly reel montage. The n8n workflow starts it in the background (setsid) and polls spec.done.
// Usage: node render_reel.js spec.json   ->  spec.out (mp4) + spec.cover (jpg) + spec.done (json)
//
// - Same typography as render_frame.sh: one display font, 12 degree italic shear,
//   white slogan + accent-coloured product line.
// - Motion: ffmpeg "perspective" filter (sub-pixel, bicubic, eval=frame). Pixel-step scale/crop
//   zooms visibly judder; perspective does not.
// - Text shadows and the top scrim are drawn in ffmpeg: in the GraphicsMagick build we ran,
//   "gm composite -dissolve" onto a transparent canvas returned opaque black and "-channel Alpha"
//   is not supported.
//
// Spec fields (the workflow writes them; see examples/reel_spec.json):
//   id, workDir, out, cover, done, shots[], end{bg,cta1,cta2,dur}, music, transitions[], xdur,
//   ffmpeg, font, sloganColor, accentColor, logo, endBox
// Fallbacks for the optional fields: IG_DATA_DIR, IG_FFMPEG, IG_FONT environment variables.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ROOT = process.env.IG_DATA_DIR || path.resolve(__dirname, '..');
const FF = spec.ffmpeg || process.env.IG_FFMPEG || 'ffmpeg';
const FONT = spec.font || process.env.IG_FONT || path.join(ROOT, 'assets', 'font.ttf');
const SLOGAN_COLOR = spec.sloganColor || '#FFFFFF';
const ACCENT_COLOR = spec.accentColor || '#E63946';
const LOGO = spec.logo || path.join(ROOT, 'assets', 'logo.png');        // optional, transparent PNG
const END_BOX = spec.endBox || path.join(ROOT, 'assets', 'end_box.png'); // optional, footer box
const W = 1080, H = 1920, FPS = 30;
const MAXW = Math.round(W * 0.86);
const TMP = spec.workDir;
fs.mkdirSync(TMP, { recursive: true });
const log = m => fs.appendFileSync(TMP + '/render.log', new Date().toISOString() + ' ' + m + '\n');
const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 64 << 20 });
const gm = args => run('gm', args);
const ff = args => run(FF, ['-v', 'error', '-y', ...args]);
const size = f => execFileSync('gm', ['identify', '-format', '%w %h', f]).toString().trim().split(' ').map(Number);
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

// ---- Typography (same method as render_line in render_frame.sh)
function renderLine(text, color, targetH, out) {
  const r = out + '.r.miff', s = out + '.s.miff';
  // a leading "@" would make gm read a file
  gm(['convert', '-background', 'none', '-fill', color, '-font', FONT, '-pointsize', '260', `label:${String(text).replace(/^@+/, '')}`, '-trim', '+repage', r]);
  gm(['convert', r, '-background', 'none', '-shear', '12x0', '+repage', s]);
  const [rw, rh] = size(s);
  let th = targetH, tw = Math.round(rw * th / rh);
  if (tw > MAXW) { tw = MAXW; th = Math.round(rh * tw / rw); }
  gm(['convert', s, '-resize', `${tw}x${th}!`, out]);
  return [tw, th];
}
// White slogan + accent product line on a transparent canvas of width W.
// The shadow is added later in ffmpeg (see header note about gm -dissolve).
function textBlock(slogan, dish, out, sloH = 52, dishH = 78, gap = 16) {
  const layers = [];
  if (slogan) layers.push([renderLine(slogan, SLOGAN_COLOR, sloH, out + '.slo.miff'), out + '.slo.miff']);
  if (dish) layers.push([renderLine(dish, ACCENT_COLOR, dishH, out + '.dish.miff'), out + '.dish.miff']);
  const pad = 24;
  const hTot = layers.reduce((a, [[, h]]) => a + h, 0) + gap * Math.max(0, layers.length - 1) + 2 * pad;
  const base = out + '.base.miff';
  gm(['convert', '-size', `${W}x${hTot}`, 'xc:none', base]);
  let y = pad;
  for (const [[, h], f] of layers) {
    gm(['composite', '-gravity', 'North', '-geometry', `+0+${y}`, f, base, base]);
    y += h + gap;
  }
  gm(['convert', base, out]);
  return hTot;
}
// Filter fragment: put a text layer (with a soft shadow) over the video, sliding up while fading in
function textOver(vin, tin, y, st, fadeD, vout, slide = true) {
  const yy = slide ? `'${y}+max(0\\,24*(1-(t-${st})/${fadeD}))'` : String(y);
  const ys = slide ? `'${y}+6+max(0\\,24*(1-(t-${st})/${fadeD}))'` : String(y + 6);
  return `${tin}format=rgba,fade=in:st=${st}:d=${fadeD}:alpha=1,split[${vout}_t][${vout}_s0];` +
    `[${vout}_s0]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.8,gblur=sigma=6[${vout}_s];` +
    `${vin}[${vout}_s]overlay=0:${ys}[${vout}_v];[${vout}_v][${vout}_t]overlay=0:${yy}`;
}
// Soft dark scrim at the top (cosine falloff) so the text reads on any background
function scrim(out, solid = 405, bottom = 900, alpha = 150) {
  ff(['-f', 'lavfi', '-i', `color=black:s=${W}x${H}`, '-frames:v', '1', '-vf',
    `format=rgba,geq=r='0':g='0':b='0':a='if(lt(Y\\,${solid})\\,${alpha}\\,if(lt(Y\\,${bottom})\\,${alpha}*(0.5+0.5*cos(PI*(Y-${solid})/${bottom - solid}))\\,0))'`, out]);
}

// ---- Shots
const P = n => `(0.5-0.5*cos(PI*min(in/${n}\\,1)))`; // ease-in-out progress
function motionFilter(m, dur) {
  const n = Math.round(dur * FPS), e = P(n);
  const z = `(${m.z0}+(${m.z1}-${m.z0})*${e})`;
  const cy = `(H/2+H*(${m.dy0}+(${m.dy1}-${m.dy0})*${e}))`;
  const hw = `(W/2/(1+${z}))`, hh = `(H/2/(1+${z}))`;
  return `perspective=x0='W/2-${hw}':y0='${cy}-${hh}':x1='W/2+${hw}':y1='${cy}-${hh}':` +
    `x2='W/2-${hw}':y2='${cy}+${hh}':x3='W/2+${hw}':y3='${cy}+${hh}':interpolation=cubic:eval=frame`;
}

function shotSegment(s, i) {
  const out = `${TMP}/seg${i}.mp4`;
  const txt = `${TMP}/t${i}.png`;
  textBlock(s.slogan, s.dish, txt);
  const y = s.kind === 'video' ? 290 : 400;
  const st = s.kind === 'video' ? 0.5 : 0.15;
  if (s.kind === 'video') {
    ff(['-i', s.src, '-loop', '1', '-i', txt, '-loop', '1', '-i', TMP + '/scrim.png', '-filter_complex',
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},fps=${FPS},setsar=1,trim=0:${s.dur},setpts=PTS-STARTPTS[v0];` +
      `[2:v]format=rgba,fade=in:st=0.3:d=0.5:alpha=1[sc];[v0][sc]overlay=0:0:shortest=1[v1];` +
      textOver('[v1]', '[1:v]', y, st, 0.4, 'x') + `:shortest=1,format=yuv420p[o]`,
      '-map', '[o]', '-t', String(s.dur), ...ENC, out]);
  } else {
    ff(['-loop', '1', '-framerate', String(FPS), '-i', s.src, '-loop', '1', '-i', txt, '-loop', '1', '-i', TMP + '/scrim.png', '-filter_complex',
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,format=yuv420p,${motionFilter(s.motion, s.dur)}[v0];` +
      `[2:v]format=rgba[sc];[v0][sc]overlay=0:0[v1];` +
      textOver('[v1]', '[1:v]', y, st, 0.35, 'x') + `,format=yuv420p[o]`,
      '-map', '[o]', '-t', String(s.dur), ...ENC, out]);
  }
  return out;
}

function endCard(e, i) {
  const out = `${TMP}/seg${i}.mp4`;
  // Background: shrink + enlarge the frame for a cheap, smooth blur, then darken it
  gm(['convert', e.bg, '-resize', `${W}x${H}^`, '-gravity', 'center', '-extent', `${W}x${H}`, '-resize', '6%', '-resize', `${W}x${H}!`, '-blur', '0x6', TMP + '/end_bg0.miff']);
  gm(['convert', '-size', `${W}x${H}`, 'xc:black', TMP + '/blk.miff']);
  gm(['composite', '-dissolve', '58', TMP + '/blk.miff', TMP + '/end_bg0.miff', TMP + '/end_bg.png']);
  textBlock(e.cta1, e.cta2, TMP + '/cta.png', 48, 70);
  const inputs = ['-loop', '1', '-framerate', String(FPS), '-i', TMP + '/end_bg.png', '-loop', '1', '-i', TMP + '/cta.png'];
  let fc = '[0:v]format=yuv420p[bg];', cur = '[bg]', n = 2;
  // Transparent logo (no black box) - optional
  if (fs.existsSync(LOGO)) {
    gm(['convert', LOGO, '-resize', '440x', TMP + '/logo.png']);
    const [lw] = size(TMP + '/logo.png');
    inputs.push('-loop', '1', '-i', TMP + '/logo.png');
    fc += `[${n}:v]format=rgba,fade=in:st=0.1:d=0.4:alpha=1[l];${cur}[l]overlay=${Math.round((W - lw) / 2)}:300[a];`;
    cur = '[a]'; n++;
  }
  fc += textOver(cur, '[1:v]', 620, 0.45, 0.4, 'c', false) + '[a2]';
  cur = '[a2]';
  // Footer box (address / opening hours), moved to where the Reels UI does not cover it - optional
  if (fs.existsSync(END_BOX)) {
    gm(['convert', END_BOX, '-resize', '952x', TMP + '/box.png']);
    const [bw] = size(TMP + '/box.png');
    inputs.push('-loop', '1', '-i', TMP + '/box.png');
    fc += `;[${n}:v]format=rgba,fade=in:st=0.8:d=0.4:alpha=1[b];${cur}[b]overlay=${Math.round((W - bw) / 2)}:1000[a3]`;
    cur = '[a3]'; n++;
  }
  fc += `;${cur}format=yuv420p[o]`;
  ff([...inputs, '-filter_complex', fc, '-map', '[o]', '-t', String(e.dur), ...ENC, out]);
  return out;
}

try {
  log('start ' + spec.id);
  if (!fs.existsSync(FONT)) throw new Error('Font not found: ' + FONT);
  scrim(TMP + '/scrim.png');
  const segs = [], durs = [];
  spec.shots.forEach((s, i) => { segs.push(shotSegment(s, i)); durs.push(s.dur); log(`shot ${i} done`); });
  segs.push(endCard(spec.end, segs.length)); durs.push(spec.end.dur); log('end card done');

  const X = spec.xdur || 0.3, trans = spec.transitions || [];
  const fc = []; let prev = '[0:v]', off = 0;
  for (let i = 1; i < segs.length; i++) {
    off += durs[i - 1] - X;
    fc.push(`${prev}[${i}:v]xfade=transition=${trans[i - 1] || 'fade'}:duration=${X}:offset=${off.toFixed(3)}[x${i}]`);
    prev = `[x${i}]`;
  }
  const total = durs.reduce((a, b) => a + b, 0) - X * (segs.length - 1);
  const inputs = segs.flatMap(s => ['-i', s]);
  const aParts = [];
  let ai = segs.length;
  if (spec.music) {
    inputs.push('-i', spec.music);
    aParts.push(`[${ai}:a]silenceremove=start_periods=1:start_threshold=-40dB,atrim=0:${total.toFixed(2)},asetpts=PTS-STARTPTS,afade=t=in:d=0.15,afade=t=out:st=${(total - 1.4).toFixed(2)}:d=1.4,volume=0.9[m]`);
    ai++;
  }
  // The Veo opener comes with its own sizzle audio; it is mixed under the music
  const hero = spec.shots.find(s => s.kind === 'video' && s.audio);
  if (hero) {
    inputs.push('-i', hero.src);
    aParts.push(`[${ai}:a]atrim=0:${hero.dur - 0.2},asetpts=PTS-STARTPTS,afade=t=out:st=${hero.dur - 1.0}:d=0.8,volume=${spec.music ? 0.35 : 1}[s]`);
  }
  let amap;
  if (aParts.length === 2) { fc.push(...aParts, `[m][s]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]`); amap = '[a]'; }
  else if (aParts.length === 1) { fc.push(aParts[0].replace(/\[(m|s)\]$/, ',apad,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]')); amap = '[a]'; }
  const args = [...inputs, '-filter_complex', fc.join(';'), '-map', prev];
  if (amap) args.push('-map', amap, '-c:a', 'aac', '-b:a', '160k', '-ar', '44100');
  ff([...args, ...ENC, '-movflags', '+faststart', '-t', total.toFixed(2), spec.out + '.tmp.mp4']);
  fs.renameSync(spec.out + '.tmp.mp4', spec.out);
  // Cover: second 1.3 of the opener (text already visible)
  ff(['-ss', '1.3', '-i', spec.out, '-frames:v', '1', '-q:v', '2', spec.cover]);
  const st = fs.statSync(spec.out);
  fs.writeFileSync(spec.done, JSON.stringify({ ok: true, out: spec.out, cover: spec.cover, duration: total, bytes: st.size }));
  log('finished ' + total.toFixed(2) + ' s');
} catch (err) {
  const msg = (err.stderr ? err.stderr.toString() : '') + ' ' + (err.message || err);
  log('ERROR ' + msg);
  fs.writeFileSync(spec.done, JSON.stringify({ ok: false, error: msg.slice(-1500) }));
  process.exit(1);
}
