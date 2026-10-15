// Assembles the demo video from the raw takes (record.mjs) and the voice (tts.mjs).
//   node scripts/video/edit.mjs            -> video/out/carrypay-demo.mp4 (+ subtitles.en.srt)
// Each narration part gets a stretch of a take between two markers, sped up to fit the voice (or held
// on its last frame); title and end cards are rendered in Chrome; music is composed with ffmpeg and
// turned down under the voice; English subtitles are burned in.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import { scenesFromScript } from "./tts.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "video", "out");
const TAKES = path.join(OUT, "takes");
const WORK = path.join(OUT, "edit");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FPS = 30;
const TITLE = 3.2; // opening card, music only
const LEAD = 0.8; // first picture before the first word
const GAP_SHORT = 0.6; // between parts of one scene
const GAP_LONG = 1.4; // between scenes
const END = 5.5; // end card

const ff = (args, cwd = OUT) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { cwd, stdio: ["ignore", "inherit", "inherit"] });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

// Which stretch of which take illustrates each narration part. Markers come from the take's JSON;
// "name+2" / "name-1" shift a marker by seconds; a number is seconds from the start.
const EDL = {
  "1": { take: "s1", from: 0, to: "done", pushIn: true },
  "2": { take: "s2", from: 0, to: "done" },
  "3a": { take: "s3", from: "deposit-1", to: "transfer+2" },
  "3b": { take: "s3", from: "urgent-0.5", to: "scam" },
  "3c": { take: "s3", from: "scam-0.3", to: "discharge" },
  "3d": { take: "s3", from: "discharge", to: "results+2.5" },
  "4": { take: "s4", from: 0, to: "done" },
  "5": { take: "s5", from: 0, to: "done" },
  "6": { take: "s6", from: 0, to: "done" },
  "7": { take: "s7", from: 0, to: "done" },
  "8": { take: "s8", from: 0, to: "end" },
};

function at(markers, v) {
  if (typeof v === "number") return v;
  const m = v.match(/^([a-z0-9]+)([+-][\d.]+)?$/i);
  if (!m || markers[m[1]] === undefined) throw new Error(`marker ${v} missing`);
  return Math.max(0, markers[m[1]] + Number(m[2] ?? 0));
}

async function cards() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const shell = (body) => `<!doctype html><html><head><style>
    body{margin:0;width:1920px;height:1080px;background:radial-gradient(1200px 700px at 70% 40%,#0e3b33 0%,#08100f 60%);color:#e9f1ee;font-family:"Segoe UI",system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
    .wrap{text-align:center}.logo{display:inline-flex;align-items:center;gap:22px;font-size:96px;font-weight:700;letter-spacing:-2px}
    .mark{width:110px;height:110px;border-radius:28px;background:#0e6b5c;display:grid;place-items:center}
    .pay{color:#5ccdb4}.tag{margin-top:34px;font-size:40px;color:#c9d6d2}.small{margin-top:70px;font-size:30px;color:#9fb2ad;line-height:1.6}
    .url{font-size:44px;color:#5ccdb4;font-weight:600}</style></head><body><div class="wrap">${body}</div></body></html>`;
  const logo = `<div class="logo"><span class="mark"><svg width="64" height="64" viewBox="0 0 24 24" fill="none"><path d="M5 15.5C7 10 17 10 19 15.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="5.5" cy="16" r="2.4" fill="#fff"/><circle cx="18.5" cy="16" r="2.4" fill="#5ccdb4"/></svg></span><span>Carry<span class="pay">Pay</span></span></div>`;
  await page.setContent(shell(`${logo}<div class="tag">An AI agent for hospital and university bills abroad</div>`));
  await page.screenshot({ path: path.join(WORK, "card-title.png") });
  await page.setContent(
    shell(`${logo}<div class="tag">Never carry cash across borders again.</div><div class="small"><span class="url">carrypay.duckdns.org</span><br/>github.com/JahanzaibMohsin9/carrypay<br/>Sandbox demo: fictional hospitals, universities and banks. No real money moves.</div>`),
  );
  await page.screenshot({ path: path.join(WORK, "card-end.png") });
  await browser.close();
}

function cardClip(png, seconds, file) {
  ff(["-loop", "1", "-t", String(seconds), "-i", png, "-vf", `fps=${FPS},format=yuv420p,fade=t=in:st=0:d=0.6,fade=t=out:st=${seconds - 0.6}:d=0.6`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", file]);
}

/** The music bed: a slow pad (Am9 – Fmaj7 – C – G) with a little detune and echo, long enough for the film. */
function music(seconds, file) {
  const chords = [
    [110.0, 164.81, 196.0, 246.94, 261.63], // Am9
    [87.31, 130.81, 164.81, 220.0, 261.63], // Fmaj7
    [130.81, 196.0, 261.63, 329.63, 392.0], // C
    [98.0, 146.83, 196.0, 246.94, 293.66], // G
  ];
  const len = 8;
  const parts = chords.map((c, i) => {
    const expr = c.map((f, j) => `${(0.11 - j * 0.012).toFixed(3)}*(sin(2*PI*${f}*t)+0.6*sin(2*PI*${(f * 1.003).toFixed(3)}*t))`).join("+");
    const f = path.join(WORK, `chord${i}.wav`);
    ff(["-f", "lavfi", "-i", `aevalsrc=${expr}:s=44100:d=${len}`, "-af", `afade=t=in:d=2.5,afade=t=out:st=${len - 2.5}:d=2.5`, f]);
    return f;
  });
  // the progression with crossfades, then looped to length, softened and given some space
  const cycle = path.join(WORK, "cycle.wav");
  ff(["-i", parts[0], "-i", parts[1], "-i", parts[2], "-i", parts[3], "-filter_complex", "[0][1]acrossfade=d=2[a];[a][2]acrossfade=d=2[b];[b][3]acrossfade=d=2[c]", "-map", "[c]", cycle]);
  ff(["-stream_loop", "-1", "-i", cycle, "-t", String(seconds), "-af", `lowpass=f=1400,aecho=0.8:0.6:420|780:0.22|0.12,volume=0.55,afade=t=in:d=3,afade=t=out:st=${seconds - 4}:d=4`, file]);
}

/** Subtitles: each part's sentences, timed by length within the part's voice. */
function srt(parts, file) {
  const ts = (s) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000), r = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(r).padStart(3, "0")}`;
  };
  const cues = [];
  for (const p of parts) {
    const sentences = p.text.match(/[^.!?]+[.!?]+["”]?|[^.!?]+$/g).map((x) => x.trim()).filter(Boolean);
    // split very long sentences at commas so a cue stays on two lines
    const chunks = sentences.flatMap((s) => (s.length > 95 ? s.split(/(?<=,)\s+/).reduce((acc, piece) => (acc.length && (acc.at(-1) + " " + piece).length <= 95 ? [...acc.slice(0, -1), acc.at(-1) + " " + piece] : [...acc, piece]), []) : [s]));
    const total = chunks.reduce((n, c) => n + c.length, 0);
    let t = p.voiceStart;
    for (const c of chunks) {
      const d = (p.voice * c.length) / total;
      cues.push({ start: t, end: t + d - 0.05, text: c });
      t += d;
    }
  }
  fs.writeFileSync(file, cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n"));
}

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
await cards();

// the timeline: title card, then each part = (lead-in) + voice + gap, then the end card
const scenes = scenesFromScript();
const parts = scenes.flatMap((s, si) => s.parts.map((p, pi) => ({ ...p, scene: s.id, lastInScene: pi === s.parts.length - 1, firstInScene: pi === 0, lastOverall: si === scenes.length - 1 && pi === s.parts.length - 1 })));
let clock = TITLE;
for (const [i, p] of parts.entries()) {
  p.voice = dur(path.join(OUT, "voice", `${p.id}.mp3`));
  p.lead = i === 0 ? LEAD : 0;
  p.gap = p.lastOverall ? 1.6 : p.lastInScene ? GAP_LONG : GAP_SHORT;
  p.length = p.lead + p.voice + p.gap;
  p.start = clock;
  p.voiceStart = clock + p.lead;
  clock += p.length;
}
const total = clock + END;

// picture
const list = [];
cardClip(path.join(WORK, "card-title.png"), TITLE, path.join(WORK, "00-title.mp4"));
list.push("00-title.mp4");
for (const p of parts) {
  const e = EDL[p.id];
  const markers = JSON.parse(fs.readFileSync(path.join(TAKES, `${e.take}.json`), "utf8"));
  const from = at(markers, e.from);
  const to = Math.min(at(markers, e.to), markers.end);
  const seg = Math.max(0.5, to - from);
  const speed = Math.max(1, seg / p.length);
  const shown = seg / speed;
  const filters = [`setpts=(PTS-STARTPTS)/${speed.toFixed(4)}`, `fps=${FPS}`];
  if (shown < p.length) filters.push(`tpad=stop_mode=clone:stop_duration=${(p.length - shown + 0.1).toFixed(3)}`);
  filters.push(`trim=duration=${p.length.toFixed(3)}`);
  if (e.pushIn) filters.push(`zoompan=z='min(1+0.0011*on,1.32)':x='iw*0.62-(iw/zoom/2)':y='ih*0.34-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS}`);
  if (p.firstInScene) filters.push("fade=t=in:st=0:d=0.35");
  if (p.lastInScene) filters.push(`fade=t=out:st=${(p.length - 0.35).toFixed(3)}:d=0.35`);
  filters.push("format=yuv420p");
  const file = `p-${p.id}.mp4`;
  ff(["-ss", String(from), "-i", path.join(TAKES, `${e.take}.mp4`), "-an", "-vf", filters.join(","), "-c:v", "libx264", "-preset", "medium", "-crf", "18", path.join(WORK, file)]);
  list.push(file);
  console.log(`${p.id.padEnd(3)} ${e.take} ${from.toFixed(1)}–${to.toFixed(1)}s → ${p.length.toFixed(1)}s (×${speed.toFixed(2)})`);
}
cardClip(path.join(WORK, "card-end.png"), END, path.join(WORK, "99-end.mp4"));
list.push("99-end.mp4");
fs.writeFileSync(path.join(WORK, "list.txt"), list.map((f) => `file '${f}'`).join("\n"));
ff(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "picture.mp4"], WORK);

// sound: the voice parts at their places, the music ducked under them
const voiceInputs = parts.flatMap((p) => ["-i", path.join(OUT, "voice", `${p.id}.mp3`)]);
const delays = parts.map((p, i) => `[${i}:a]aresample=44100,adelay=${Math.round(p.voiceStart * 1000)}:all=1[v${i}]`).join(";");
ff([...voiceInputs, "-filter_complex", `${delays};${parts.map((_, i) => `[v${i}]`).join("")}amix=inputs=${parts.length}:normalize=0,apad=whole_dur=${total}[v]`, "-map", "[v]", "-ac", "2", path.join(WORK, "voice.wav")]);
music(total, path.join(WORK, "music.wav"));
ff(["-i", "voice.wav", "-i", "music.wav", "-filter_complex", "[1:a]volume=0.32[m];[m][0:a]sidechaincompress=threshold=0.015:ratio=6:attack=40:release=600[md];[0:a][md]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]", "-map", "[a]", "-t", String(total), "mix.wav"], WORK);

// subtitles and the final file
srt(parts, path.join(WORK, "subtitles.en.srt"));
fs.copyFileSync(path.join(WORK, "subtitles.en.srt"), path.join(OUT, "subtitles.en.srt"));
const style = "FontName=Segoe UI,FontSize=17,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BackColour=&H90000000,BorderStyle=3,Outline=6,Shadow=0,MarginV=34";
ff(["-i", "picture.mp4", "-i", "mix.wav", "-vf", `subtitles=subtitles.en.srt:force_style='${style}'`, "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", path.join(OUT, "carrypay-demo.mp4")], WORK);
console.log(`carrypay-demo.mp4: ${dur(path.join(OUT, "carrypay-demo.mp4")).toFixed(1)}s`);
