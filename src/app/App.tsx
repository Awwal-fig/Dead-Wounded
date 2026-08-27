import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Copy, Check, ArrowLeft, Timer, BookOpen, LogOut, AlertTriangle } from "lucide-react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPA_URL = "https://zsettsehdyfcjbyhgvnl.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzZXR0c2VoZHlmY2pieWhndm5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MDA4NTgsImV4cCI6MjA5ODQ3Njg1OH0.V0iVRPA368TX9BMWdHq4W_oGuam-jZPvVCTzCbOtknM";

declare global { interface Window { _dw_supa?: SupabaseClient } }
const supabase: SupabaseClient = window._dw_supa ?? (window._dw_supa = createClient(SUPA_URL, SUPA_KEY, {
  auth: { storageKey: "dw-auth", persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 20 } },
}));

// ══════════════════════════════════════════════════════════════
// GAME LOGIC
// ══════════════════════════════════════════════════════════════

function scoreGuess(guess: number[], secret: number[]) {
  let dead = 0, wounded = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) dead++;
    else if (secret.includes(guess[i])) wounded++;
  }
  return { dead, wounded };
}

function isValidCode(d: number[]) {
  return d.length === 4 && new Set(d).size === 4;
}

function randomCode(): number[] {
  const p = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = 9; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p.slice(0, 4);
}

const RC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genRoomCode() {
  return Array.from({ length: 4 }, () => RC[Math.floor(Math.random() * RC.length)]).join("");
}

function buildAllCodes(): number[][] {
  const r: number[][] = [];
  for (let a = 0; a <= 9; a++)
    for (let b = 0; b <= 9; b++) if (b !== a)
      for (let c = 0; c <= 9; c++) if (c !== a && c !== b)
        for (let d = 0; d <= 9; d++) if (d !== a && d !== b && d !== c)
          r.push([a, b, c, d]);
  return r;
}
const ALL_CODES = buildAllCodes();

function filterPoss(poss: number[][], guess: number[], res: { dead: number; wounded: number }) {
  return poss.filter((c) => {
    const s = scoreGuess(guess, c);
    return s.dead === res.dead && s.wounded === res.wounded;
  });
}

type Diff = "easy" | "medium" | "hard";

function aiPickGuess(diff: Diff, poss: number[][]): number[] {
  if (!poss.length) return randomCode();
  if (diff === "easy") return randomCode();
  if (diff === "medium") return poss[Math.floor(Math.random() * poss.length)];
  if (poss.length <= 2) return poss[0];
  let best = poss[0], bw = Infinity;
  for (const c of poss.slice(0, 40)) {
    const bkt: Record<string, number> = {};
    for (const p of poss) {
      const s = scoreGuess(c, p);
      const k = `${s.dead}${s.wounded}`;
      bkt[k] = (bkt[k] || 0) + 1;
    }
    const w = Math.max(...Object.values(bkt));
    if (w < bw) { bw = w; best = c; }
  }
  return best;
}

// Best-guess scoring for timed mode winner determination
interface BestGuess { dead: number; wounded: number; guessNum: number; }

function getBestGuess(guesses: GuessEntry[]): BestGuess | null {
  if (!guesses.length) return null;
  let best = { ...guesses[0], guessNum: 1 };
  for (let i = 1; i < guesses.length; i++) {
    const g = guesses[i];
    if (g.dead > best.dead || (g.dead === best.dead && g.wounded > best.wounded))
      best = { ...g, guessNum: i + 1 };
  }
  return best;
}

function determineTimedWinner(mine: GuessEntry[], theirs: GuessEntry[]): "me" | "opp" | "draw" {
  const m = getBestGuess(mine), t = getBestGuess(theirs);
  if (!m && !t) return "draw";
  if (!m) return "opp";
  if (!t) return "me";
  if (m.dead !== t.dead) return m.dead > t.dead ? "me" : "opp";
  if (m.wounded !== t.wounded) return m.wounded > t.wounded ? "me" : "opp";
  if (m.guessNum !== t.guessNum) return m.guessNum < t.guessNum ? "me" : "opp";
  return "draw";
}

function fmtTime(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ══════════════════════════════════════════════════════════════
// SOUND ENGINE
// ══════════════════════════════════════════════════════════════

let _ctx: AudioContext | null = null;
function ac() {
  if (!_ctx) _ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}

function tone(freq: number, dur: number, vol = 0.18, type: OscillatorType = "square", freqEnd?: number, delayMs = 0) {
  try {
    setTimeout(() => {
      const ctx = ac();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = type;
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + dur);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + dur + 0.01);
    }, delayMs);
  } catch {}
}

const sfx = {
  click:   () => tone(900, 0.06, 0.12, "square", 450),
  digit:   () => tone(780, 0.04, 0.09, "square", 650),
  del:     () => tone(320, 0.05, 0.09, "square", 200),
  lock:    () => { tone(523, 0.1, 0.22, "square"); tone(784, 0.15, 0.25, "square", undefined, 110); },
  submit:  () => tone(560, 0.09, 0.18, "square"),
  result:  (dead: number, wounded: number) => {
    for (let i = 0; i < dead; i++) tone(1320, 0.15, 0.22, "sine", undefined, i * 110);
    for (let i = 0; i < wounded; i++) tone(660, 0.12, 0.14, "triangle", undefined, dead * 110 + i * 90);
    if (!dead && !wounded) tone(180, 0.12, 0.1, "square", 120);
  },
  win:     () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 0.24, "sine", undefined, i * 110)),
  lose:    () => [380, 300, 220, 160].forEach((f, i) => tone(f, 0.18, 0.2, "square", undefined, i * 130)),
  connect: () => { tone(440, 0.1, 0.16, "sine"); tone(880, 0.18, 0.2, "sine", undefined, 120); },
  flip:    () => [800, 600, 400, 900].forEach((f, i) => tone(f, 0.07, 0.12, "square", undefined, i * 60)),
  tick:    () => tone(1100, 0.03, 0.09, "square"),
  timeup:  () => [440, 330, 220, 150].forEach((f, i) => tone(f, 0.2, 0.28, "square", undefined, i * 110)),
};

// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

interface GuessEntry { guess: number[]; dead: number; wounded: number; }
type Screen =
  | "splash" | "avatar" | "resume" | "home" | "guide" | "online-menu" | "create" | "join"
  | "connected" | "ai-diff" | "game-settings" | "code-setup"
  | "waiting-code" | "coin-flip" | "game" | "game-over";
type Role = "p1" | "p2";

type CMsg =
  | { t: "JOIN"; name: string; avatarId: string }
  | { t: "WELCOME"; name: string; first: Role; timed: boolean; limit: number; avatarId: string }
  | { t: "LOCK" }
  | { t: "GUESS"; g: number[] }
  | { t: "RESULT"; g: number[]; dead: number; wnd: number; won: number }
  | { t: "REVEAL"; code: number[] }
  | { t: "TIMEOUT" }
  | { t: "FORFEIT" }
  | { t: "REMATCH" }
  | { t: "REMATCH_OK" };

// ══════════════════════════════════════════════════════════════
// AVATARS
// ══════════════════════════════════════════════════════════════

const AVATARS = [
  { id: "ghost",   name: "GHOST"   },
  { id: "skull",   name: "SKULL"   },
  { id: "oracle",  name: "ORACLE"  },
  { id: "hawk",    name: "HAWK"    },
  { id: "wolf",    name: "WOLF"    },
  { id: "wraith",  name: "WRAITH"  },
  { id: "cipher",  name: "CIPHER"  },
  { id: "viper",   name: "VIPER"   },
  { id: "phantom", name: "PHANTOM" },
];

function AvatarSVG({ id, size = 40 }: { id: string; size?: number }) {
  const shapes: Record<string, React.ReactNode> = {
    ghost: <>
      <ellipse cx="24" cy="20" rx="13" ry="14" />
      <path d="M11 27V40l4.5-3.5L20 40l4-3.5 4 3.5 4.5-3.5L37 40V27Z" />
      <circle cx="19" cy="19" r="3.5" fill="#07090c" />
      <circle cx="29" cy="19" r="3.5" fill="#07090c" />
    </>,
    skull: <>
      <ellipse cx="24" cy="19" rx="12" ry="12" />
      <path d="M16 27h16v7a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2Z" />
      <line x1="24" y1="27" x2="24" y2="36" stroke="#07090c" strokeWidth="1.5" />
      <circle cx="19" cy="18" r="4" fill="#07090c" />
      <circle cx="29" cy="18" r="4" fill="#07090c" />
    </>,
    oracle: <>
      <polygon points="24,5 43,39 5,39" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M13 34 Q24 22 35 34 Q24 46 13 34Z" />
      <circle cx="24" cy="34" r="4.5" fill="#07090c" />
      <circle cx="24" cy="34" r="1.8" />
    </>,
    hawk: <>
      <circle cx="24" cy="17" r="9" />
      <path d="M6 32 Q15 22 24 26 Q33 22 42 32 L38 38 Q30 32 24 34 Q18 32 10 38Z" />
      <circle cx="20" cy="15" r="2" fill="#07090c" />
      <path d="M23 19 L27 25 L24 23 L21 25Z" fill="#07090c" />
    </>,
    wolf: <>
      <path d="M24 6L14 20H8L14 28L10 36H24H38L34 28L40 20H34Z" />
      <circle cx="19" cy="24" r="2.5" fill="#07090c" />
      <circle cx="29" cy="24" r="2.5" fill="#07090c" />
      <path d="M20 30 Q24 33 28 30" fill="none" stroke="#07090c" strokeWidth="1.5" strokeLinecap="round" />
    </>,
    wraith: <>
      <path d="M24 5C10 5 7 16 7 24c0 10 4 19 9 19h16c5 0 9-9 9-19 0-8-3-19-17-19Z" />
      <ellipse cx="19" cy="26" rx="3.5" ry="2.5" fill="#07090c" />
      <ellipse cx="29" cy="26" rx="3.5" ry="2.5" fill="#07090c" />
      <ellipse cx="19" cy="25.5" rx="2" ry="1.2" opacity="0.45" />
      <ellipse cx="29" cy="25.5" rx="2" ry="1.2" opacity="0.45" />
    </>,
    cipher: <>
      <rect x="10" y="13" width="28" height="22" rx="4" />
      <rect x="14" y="19" width="8" height="5" rx="1" fill="#07090c" />
      <rect x="26" y="19" width="8" height="5" rx="1" fill="#07090c" />
      <path d="M18 30h12" stroke="#07090c" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="22" y="8" width="4" height="5" rx="2" />
      <circle cx="24" cy="7" r="1.5" />
    </>,
    viper: <>
      <circle cx="24" cy="13" r="8" />
      <path d="M24 21C24 29 33 31 32 38" stroke="currentColor" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M32 38C32 43 28 45 24 45C20 45 16 43 16 38" stroke="currentColor" strokeWidth="6" fill="none" strokeLinecap="round" />
      <circle cx="20" cy="11" r="2" fill="#07090c" />
      <circle cx="28" cy="11" r="2" fill="#07090c" />
      <path d="M21 17 L18 21 M27 17 L30 21" stroke="#07090c" strokeWidth="1.2" strokeLinecap="round" />
    </>,
    phantom: <>
      <path d="M24 4L32 20L44 16L36 28L42 40L24 34L6 40L12 28L4 16L16 20Z" />
      <circle cx="24" cy="24" r="4.5" fill="#07090c" />
      <circle cx="24" cy="24" r="1.8" />
    </>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="currentColor">
      {shapes[id] ?? shapes["ghost"]}
    </svg>
  );
}

function AvatarBubble({ id, size = 36, dim = false }: { id: string; size?: number; dim?: boolean }) {
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0"
      style={{
        width: size, height: size,
        background: dim ? "rgba(0,245,155,0.05)" : "rgba(0,245,155,0.12)",
        color: dim ? "rgba(0,245,155,0.3)" : "#00f59b",
        border: `1px solid ${dim ? "rgba(0,245,155,0.1)" : "rgba(0,245,155,0.35)"}`,
      }}
    >
      <AvatarSVG id={id} size={Math.round(size * 0.6)} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// GAME BUTTON
// ══════════════════════════════════════════════════════════════

interface GameButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

function GameButton({ children, onClick, disabled, variant = "primary", className = "", style: styleP, ...rest }: GameButtonProps) {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled) { sfx.click(); onClick?.(e); }
  };
  if (variant === "secondary") {
    return (
      <button {...rest} onClick={handleClick} disabled={disabled}
        className={`font-['Share_Tech_Mono',_monospace] tracking-[0.12em] border border-white/[0.08] text-[#6a8090] hover:border-white/[0.14] hover:text-[#9ab0c0] transition-all rounded-[6px] px-4 disabled:opacity-30 disabled:cursor-not-allowed ${className}`}>
        {children}
      </button>
    );
  }
  return (
    <motion.button onClick={handleClick} disabled={disabled}
      whileTap={disabled ? {} : { y: 3, boxShadow: "inset 0 2px 0 rgba(255,255,255,0.2), 0 1px 0 #0a2800, 0 2px 6px rgba(0,0,0,0.45)" }}
      className={`font-['Share_Tech_Mono',_monospace] tracking-[0.12em] font-bold rounded-[10px] px-5 select-none transition-opacity disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      style={{ background: "linear-gradient(to bottom, #92e832 0%, #5ec41a 40%, #3c9408 100%)", border: "2px solid #236507", borderBottom: "4px solid #122f03", color: "#173a00", textShadow: "0 1px 0 rgba(255,255,255,0.2)", boxShadow: "inset 0 3px 0 rgba(255,255,255,0.38), inset 0 -2px 0 rgba(0,0,0,0.1), 0 4px 0 #0a2800, 0 6px 14px rgba(0,0,0,0.55)", ...styleP } as React.CSSProperties}
      {...(rest as object)}>
      {children}
    </motion.button>
  );
}

// ══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ══════════════════════════════════════════════════════════════

function Pips({ dead, wounded }: { dead: number; wounded: number }) {
  return (
    <div className="grid grid-cols-2 gap-[3px] shrink-0">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={`w-[9px] h-[9px] rounded-full ${i < dead ? "bg-[#ff3b5c]" : i < dead + wounded ? "bg-[#ffaa3b]" : "bg-[#1a2530]"}`} />
      ))}
    </div>
  );
}

function GuessRow({ entry, idx }: { entry: GuessEntry; idx: number }) {
  return (
    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03, duration: 0.22 }}
      className="flex items-center gap-2 py-1.5 border-b border-white/[0.04]">
      <span className="text-[10px] text-[#253545] w-4 font-['JetBrains_Mono',_monospace] tabular-nums shrink-0">{idx + 1}</span>
      <div className="flex gap-1 shrink-0">
        {entry.guess.map((d, i) => (
          <div key={i} className="w-7 h-7 bg-[#0c1016] border border-white/[0.07] rounded-[2px] flex items-center justify-center font-['JetBrains_Mono',_monospace] text-sm text-[#90a8b8]">{d}</div>
        ))}
      </div>
      <div className="ml-auto mr-1"><Pips dead={entry.dead} wounded={entry.wounded} /></div>
      <div className="flex gap-2 text-[11px] font-['JetBrains_Mono',_monospace] shrink-0">
        <span className="text-[#ff3b5c]">{entry.dead}<span className="text-[#3d2535]">D</span></span>
        <span className="text-[#ffaa3b]">{entry.wounded}<span className="text-[#3d3020]">W</span></span>
      </div>
    </motion.div>
  );
}

function CodeSlots({ digits, activeIdx, hidden }: { digits: number[]; activeIdx: number; hidden?: boolean }) {
  return (
    <div className="flex gap-3 justify-center">
      {Array.from({ length: 4 }, (_, i) => (
        <motion.div key={i}
          animate={{ boxShadow: i === activeIdx ? "0 0 0 1.5px #00f59b, 0 0 14px rgba(0,245,155,0.12)" : digits[i] !== undefined ? "0 0 0 1px rgba(0,245,155,0.22)" : "0 0 0 1px rgba(0,245,155,0.07)" }}
          className="w-14 h-16 bg-[#0c1016] rounded-[3px] flex items-center justify-center font-['JetBrains_Mono',_monospace] text-3xl font-bold text-[#c2cfd8] select-none">
          {hidden && digits[i] !== undefined ? <span className="text-[#3d5060] text-xl">●</span>
            : digits[i] !== undefined ? digits[i]
            : i === activeIdx ? <motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.55 }} className="w-[2px] h-8 bg-[#00f59b] rounded-full inline-block" /> : null}
        </motion.div>
      ))}
    </div>
  );
}

function Keypad({ onPress, onDel, disabled, used = [] }: { onPress: (n: number) => void; onDel: () => void; disabled?: boolean; used?: number[]; }) {
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, "del"] as const;
  return (
    <div className={`grid grid-cols-3 gap-2 w-full max-w-[216px] mx-auto transition-opacity duration-300 ${disabled ? "opacity-25 pointer-events-none" : ""}`}>
      {keys.map((k, i) => {
        if (k === null) return <div key={i} />;
        const isDel = k === "del"; const num = isDel ? -1 : (k as number); const isUsed = !isDel && used.includes(num);
        return (
          <button key={i} onClick={() => isDel ? onDel() : onPress(num)}
            className={`h-12 rounded-[3px] font-['JetBrains_Mono',_monospace] text-lg transition-all duration-100 active:scale-95 ${isDel ? "text-[#3d5060] bg-[#0c1016] border border-white/[0.05] hover:text-[#7a8fa0] text-base" : isUsed ? "bg-[#0c1016] border border-white/[0.04] text-[#1e2d3a] cursor-not-allowed" : "bg-[#111820] border border-white/[0.08] text-[#b8c8d4] hover:bg-[#172030] hover:border-[rgba(0,245,155,0.18)]"}`}>
            {isDel ? "⌫" : k}
          </button>
        );
      })}
    </div>
  );
}

// Circular countdown ring
function TimerRing({ remaining, limit, size = 48 }: { remaining: number; limit: number; size?: number }) {
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, remaining / limit);
  const dash = circ * pct;
  const urgent = remaining <= 10;
  const warn = remaining <= 30;
  const color = urgent ? "#ff3b5c" : warn ? "#ffaa3b" : "#00f59b";
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a2530" strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.9s linear, stroke 0.3s" }} />
      </svg>
      <span className="absolute font-['JetBrains_Mono',_monospace] font-bold" style={{ fontSize: size < 40 ? 9 : 11, color }}>
        {fmtTime(remaining)}
      </span>
    </div>
  );
}

// Time mode toggle pill
function ModeToggle({ timed, onChange }: { timed: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex rounded-[6px] border border-white/[0.08] overflow-hidden w-full">
      {[false, true].map((v) => (
        <button key={String(v)} onClick={() => { sfx.click(); onChange(v); }}
          className={`flex-1 h-10 font-['Share_Tech_Mono',_monospace] text-xs tracking-[0.12em] transition-all flex items-center justify-center gap-1.5 ${
            timed === v
              ? v ? "bg-[rgba(255,170,59,0.15)] text-[#ffaa3b] border-[#ffaa3b]/40" : "bg-[rgba(0,245,155,0.08)] text-[#00f59b]"
              : "text-[#2d4050] hover:text-[#5a7080]"
          }`}>
          {v && <Timer size={11} />}
          {v ? "TIMED" : "STANDARD"}
        </button>
      ))}
    </div>
  );
}

const TIME_PRESETS = [
  { label: "1:00", secs: 60 },
  { label: "2:00", secs: 120 },
  { label: "3:00", secs: 180 },
  { label: "5:00", secs: 300 },
  { label: "10:00", secs: 600 },
];

function TimePresets({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  const setCustomTime = (nextMinutes: number, nextSeconds: number) => {
    // Timed matches need a meaningful, bounded duration while still supporting
    // any whole-second value a match creator wants within that range.
    onChange(Math.min(3600, Math.max(10, nextMinutes * 60 + nextSeconds)));
  };

  return (
    <div className="space-y-3 w-full">
      <div className="grid grid-cols-5 gap-1.5">
        {TIME_PRESETS.map(({ label, secs }) => (
          <button key={secs} onClick={() => { sfx.click(); onChange(secs); }}
            className={`h-10 rounded-[4px] font-['JetBrains_Mono',_monospace] text-xs transition-all border ${
              value === secs
                ? "bg-[rgba(255,170,59,0.12)] border-[rgba(255,170,59,0.4)] text-[#ffaa3b]"
                : "bg-[#0c1016] border-white/[0.07] text-[#3d5060] hover:text-[#6a8090] hover:border-white/[0.12]"
            }`}>
            {label}
          </button>
        ))}
      </div>
      <div>
        <div className="text-[10px] font-['Share_Tech_Mono',_monospace] tracking-[0.2em] text-[#2d4050] mb-2">CUSTOM TIME</div>
        <div className="flex items-center gap-2">
          <input aria-label="Custom match minutes" type="number" min="0" max="60" value={minutes}
            onChange={(e) => setCustomTime(Number(e.target.value) || 0, seconds)}
            className="w-full h-10 rounded-[4px] bg-[#0c1016] border border-white/[0.07] px-2 text-center font-['JetBrains_Mono',_monospace] text-sm text-[#ffaa3b] focus:outline-none focus:border-[rgba(255,170,59,0.45)]" />
          <span className="font-['JetBrains_Mono',_monospace] text-[#6a4d2e]">:</span>
          <input aria-label="Custom match seconds" type="number" min="0" max="59" value={String(seconds).padStart(2, "0")}
            onChange={(e) => setCustomTime(minutes, Math.min(59, Math.max(0, Number(e.target.value) || 0)))}
            className="w-full h-10 rounded-[4px] bg-[#0c1016] border border-white/[0.07] px-2 text-center font-['JetBrains_Mono',_monospace] text-sm text-[#ffaa3b] focus:outline-none focus:border-[rgba(255,170,59,0.45)]" />
          <span className="w-10 text-[10px] font-mono text-[#3d4030]">MIN:SEC</span>
        </div>
        <div className="mt-1 text-[10px] font-mono text-[#1e3040]">10 seconds to 60 minutes</div>
      </div>
    </div>
  );
}

function FlickerTitle() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const seq = [80, 120, 60, 200, 40, 80, 300]; let i = 0;
    const next = () => { if (i < seq.length) setTimeout(() => { setPhase(p => p + 1); i++; next(); }, seq[i]); };
    next();
  }, []);
  const visible = phase % 2 === 0 || phase >= 7;
  return (
    <h1 className="font-['Share_Tech_Mono',_monospace] text-4xl md:text-5xl tracking-[0.12em] text-center select-none"
      style={{ color: visible ? "#00f59b" : "transparent" }}>
      DEAD AND WOUNDED
    </h1>
  );
}

const TRANS = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -12 }, transition: { duration: 0.22 } };

// ── Session persistence ────────────────────────────────────────
const SAVE_KEY = "dw-session";
interface SavedGame {
  v: 1; mode: "ai" | "online"; diff: string;
  playerName: string; avatarId: string; oppName: string; oppAvatarId: string;
  myCode: number[]; oppCode: number[];
  myGuesses: GuessEntry[]; oppGuesses: GuessEntry[];
  turn: "me" | "opp"; timedMode: boolean; timeLimit: number;
  timeRemaining: number; savedAt: number; roomCode: string;
}
function loadSave(): SavedGame | null {
  try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }

// ══════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════

export default function App() {
  const [screen, setScreen] = useState<Screen>("splash");
  const [avatarId, setAvatarId] = useState("ghost");
  const [oppAvatarId, setOppAvatarId] = useState("cipher");
  const [mode, setMode] = useState<"online" | "ai">("ai");
  const [diff, setDiff] = useState<Diff>("medium");

  const [playerName, setPlayerName] = useState("");
  const [oppName, setOppName] = useState("");
  const [roomCode, setRoomCode] = useState("");

  const [myCode, setMyCode] = useState<number[]>([]);
  const [oppCode, setOppCode] = useState<number[]>([]);
  const [setup, setSetup] = useState<number[]>([]);
  const [curGuess, setCurGuess] = useState<number[]>([]);
  const [myGuesses, setMyGuesses] = useState<GuessEntry[]>([]);
  const [oppGuesses, setOppGuesses] = useState<GuessEntry[]>([]);

  const [turn, setTurn] = useState<"me" | "opp">("me");
  const [winner, setWinner] = useState<"me" | "opp" | null>(null);

  const [oppLocked, setOppLocked] = useState(false);
  const [aiPoss, setAiPoss] = useState<number[][]>(ALL_CODES);
  const [aiThink, setAiThink] = useState(false);

  // Timed mode
  const [timedMode, setTimedMode] = useState(false);
  const [timeLimit, setTimeLimit] = useState(120);
  const [timeRemaining, setTimeRemaining] = useState(120);
  const [timesUp, setTimesUp] = useState(false);
  const [timedResult, setTimedResult] = useState<"me" | "opp" | "draw" | null>(null);

  const [nameInput, setNameInput] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [joinErr, setJoinErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [flipFirst, setFlipFirst] = useState<"me" | "opp">("me");
  const [rematch, setRematch] = useState<"sent" | "received" | null>(null);
  const [waitingJoin, setWaitingJoin] = useState(false);
  const [showForfeit, setShowForfeit] = useState(false);
  const [forfeitFlag, setForfeitFlag] = useState(false);
  const savedGameRef = useRef<SavedGame | null>(loadSave());

  const chanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const myCodeRef = useRef<number[]>([]);
  const handlerRef = useRef<((m: CMsg) => void) | null>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);
  const aiActiveRef = useRef(false);
  const myGuessesRef = useRef<GuessEntry[]>([]);
  const oppGuessesRef = useRef<GuessEntry[]>([]);
  const joinRetryRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const hasMatchedRef = useRef(false);

  // Stable refs so handleMsg never has stale closure values
  const playerNameRef = useRef(playerName);
  const avatarIdRef = useRef(avatarId);
  const timedModeRef = useRef(timedMode);
  const timeLimitRef = useRef(timeLimit);

  // Keep all refs in sync with state
  useEffect(() => { myGuessesRef.current = myGuesses; }, [myGuesses]);
  useEffect(() => { oppGuessesRef.current = oppGuesses; }, [oppGuesses]);
  useEffect(() => { playerNameRef.current = playerName; }, [playerName]);
  useEffect(() => { avatarIdRef.current = avatarId; }, [avatarId]);
  useEffect(() => { timedModeRef.current = timedMode; }, [timedMode]);
  useEffect(() => { timeLimitRef.current = timeLimit; }, [timeLimit]);

  // Splash → resume (if saved) or avatar picker
  useEffect(() => {
    const t = setTimeout(() => setScreen(savedGameRef.current ? "resume" : "avatar"), 4200);
    return () => clearTimeout(t);
  }, []);

  // Channel message handler
  const handleMsg = useCallback((m: CMsg) => {
    switch (m.t) {
      case "JOIN": {
        if (hasMatchedRef.current) break; // already matched — ignore retries
        hasMatchedRef.current = true;
        const first: Role = Math.random() < 0.5 ? "p1" : "p2";
        setOppName(m.name);
        setOppAvatarId(m.avatarId ?? "ghost");
        send({ t: "WELCOME", name: playerNameRef.current, first, timed: timedModeRef.current, limit: timeLimitRef.current, avatarId: avatarIdRef.current } as CMsg);
        setTurn(first === "p1" ? "me" : "opp");
        sfx.connect();
        setScreen("connected");
        setTimeout(() => setScreen("code-setup"), 2600);
        break;
      }
      case "WELCOME": {
        clearInterval(joinRetryRef.current); // stop retrying JOIN
        setOppName(m.name);
        setOppAvatarId(m.avatarId ?? "ghost");
        setTurn(m.first === "p2" ? "me" : "opp");
        setTimedMode(m.timed);
        setTimeLimit(m.limit);
        setTimeRemaining(m.limit);
        sfx.connect();
        setScreen("connected");
        setTimeout(() => setScreen("code-setup"), 2600);
        break;
      }
      case "LOCK": setOppLocked(true); break;
      case "GUESS": {
        const res = scoreGuess(m.g, myCodeRef.current);
        send({ t: "RESULT", g: m.g, dead: res.dead, wnd: res.wounded, won: res.dead === 4 ? 1 : 0 } as CMsg);
        sfx.result(res.dead, res.wounded);
        setOppGuesses((prev) => [...prev, { guess: m.g, dead: res.dead, wounded: res.wounded }]);
        if (res.dead === 4) {
          sfx.lose(); setWinner("opp");
          send({ t: "REVEAL", code: myCodeRef.current } as CMsg);
          setTimeout(() => setScreen("game-over"), 300);
        } else setTurn("me");
        break;
      }
      case "RESULT": {
        sfx.result(m.dead, m.wnd);
        setMyGuesses((prev) => [...prev, { guess: m.g, dead: m.dead, wounded: m.wnd }]);
        if (m.won) {
          sfx.win(); setWinner("me");
          send({ t: "REVEAL", code: myCodeRef.current } as CMsg);
          setTimeout(() => setScreen("game-over"), 300);
        } else setTurn("opp");
        break;
      }
      case "REVEAL": setOppCode(m.code); break;
      case "TIMEOUT": {
        // Opponent's timer also ran out — end game
        const r = determineTimedWinner(myGuessesRef.current, oppGuessesRef.current);
        setTimedResult(r); setTimesUp(true);
        setWinner(r === "draw" ? null : r);
        send({ t: "REVEAL", code: myCodeRef.current } as CMsg);
        setScreen("game-over");
        break;
      }
      case "FORFEIT": {
        sfx.win(); setWinner("me"); setForfeitFlag(true);
        clearSave(); setScreen("game-over");
        break;
      }
      case "REMATCH": setRematch("received"); break;
      case "REMATCH_OK": resetForRematch(); break;
    }
  }, []); // reads only from refs — no stale closure risk

  useEffect(() => { handlerRef.current = handleMsg; }, [handleMsg]);

  // AI turn
  useEffect(() => {
    if (mode !== "ai" || screen !== "game" || turn !== "opp" || winner) return;
    if (aiActiveRef.current) return;
    aiActiveRef.current = true;
    setAiThink(true);
    const delay = diff === "easy" ? 500 : diff === "medium" ? 800 : 1200;
    const myCodeSnapshot = myCodeRef.current;
    const t = setTimeout(() => {
      setAiPoss((prevPoss) => {
        const guess = aiPickGuess(diff, prevPoss);
        const res = scoreGuess(guess, myCodeSnapshot);
        const newPoss = filterPoss(prevPoss, guess, res);
        sfx.result(res.dead, res.wounded);
        setOppGuesses((prev) => [...prev, { guess, dead: res.dead, wounded: res.wounded }]);
        setAiThink(false); aiActiveRef.current = false;
        if (res.dead === 4) { sfx.lose(); setWinner("opp"); setTimeout(() => setScreen("game-over"), 400); }
        else setTurn("me");
        return newPoss;
      });
    }, delay);
    return () => { clearTimeout(t); aiActiveRef.current = false; };
  }, [mode, screen, turn, winner, diff]);

  // Countdown timer
  useEffect(() => {
    if (!timedMode || screen !== "game" || !!winner || timeRemaining <= 0) return;
    const t = setTimeout(() => setTimeRemaining((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timedMode, screen, winner, timeRemaining]);

  // Timer hit zero
  useEffect(() => {
    if (!timedMode || timeRemaining !== 0 || screen !== "game" || !!winner) return;
    sfx.timeup();
    const r = determineTimedWinner(myGuessesRef.current, oppGuessesRef.current);
    setTimedResult(r); setTimesUp(true);
    setWinner(r === "draw" ? null : r);
    if (mode === "online") {
      send({ t: "TIMEOUT" } as CMsg);
      send({ t: "REVEAL", code: myCodeRef.current } as CMsg);
    }
    setScreen("game-over");
  }, [timedMode, timeRemaining, screen, winner, mode]);

  // Urgent tick sound last 10s
  useEffect(() => {
    if (!timedMode || screen !== "game" || timeRemaining <= 0 || timeRemaining > 10) return;
    sfx.tick();
  }, [timedMode, screen, timeRemaining]);

  // waiting-code → coin-flip
  useEffect(() => {
    if (screen === "waiting-code" && oppLocked) {
      setFlipFirst(turn === "me" ? "me" : "opp");
      setScreen("coin-flip"); sfx.flip();
      setTimeout(() => setScreen("game"), 2400);
    }
  }, [oppLocked, screen, turn]);

  // Save game state while in-game
  useEffect(() => {
    if (screen !== "game" || winner || !myCode.length) return;
    const s: SavedGame = { v: 1, mode, diff, playerName, avatarId, oppName, oppAvatarId, myCode, oppCode, myGuesses, oppGuesses, turn, timedMode, timeLimit, timeRemaining, savedAt: Date.now(), roomCode };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch {}
  }, [screen, myGuesses, oppGuesses, turn, timeRemaining, winner]);

  // Clear save when game ends
  useEffect(() => { if (screen === "game-over") clearSave(); }, [screen]);

  function resetForRematch() {
    setMyCode([]); setOppCode([]); setSetup([]);
    setCurGuess([]); setMyGuesses([]); setOppGuesses([]);
    setWinner(null); setOppLocked(false);
    setAiPoss(ALL_CODES); setAiThink(false);
    aiActiveRef.current = false;
    hasMatchedRef.current = false;
    setRematch(null); setTimesUp(false); setTimedResult(null);
    setTimeRemaining(timeLimit); setForfeitFlag(false);
    setScreen("code-setup");
  }

  function fullReset() {
    resetForRematch();
    setRoomCode(""); setOppName(""); setPlayerName("");
    setNameInput(""); setRoomInput(""); setJoinErr("");
    setWaitingJoin(false); setTimedMode(false); setTimeLimit(120); setTimeRemaining(120);
    setShowForfeit(false); setForfeitFlag(false);
    clearInterval(joinRetryRef.current);
    if (chanRef.current) { supabase.removeChannel(chanRef.current); chanRef.current = null; }
    clearSave(); savedGameRef.current = null;
    setScreen("home");
  }

  function doForfeit() {
    setShowForfeit(false);
    if (mode === "online") send({ t: "FORFEIT" } as CMsg);
    sfx.lose(); setWinner("opp"); setForfeitFlag(true);
    clearSave(); setScreen("game-over");
  }

  function doResumeGame() {
    const s = savedGameRef.current; if (!s) return;
    setMode(s.mode as "ai" | "online"); setDiff(s.diff as Diff);
    setPlayerName(s.playerName); playerNameRef.current = s.playerName;
    setAvatarId(s.avatarId); avatarIdRef.current = s.avatarId;
    setOppName(s.oppName); setOppAvatarId(s.oppAvatarId);
    setMyCode(s.myCode); myCodeRef.current = s.myCode;
    setOppCode(s.oppCode);
    setMyGuesses(s.myGuesses); setOppGuesses(s.oppGuesses);
    setTurn(s.turn); setTimedMode(s.timedMode); setTimeLimit(s.timeLimit);
    const elapsed = Math.floor((Date.now() - s.savedAt) / 1000);
    setTimeRemaining(Math.max(0, s.timeRemaining - elapsed));
    setRoomCode(s.roomCode);
    savedGameRef.current = null;
    if (s.mode === "online") {
      openChannel(s.roomCode);
    }
    setScreen("game");
  }

  function openChannel(code: string, onReady?: () => void) {
    if (chanRef.current) { supabase.removeChannel(chanRef.current); chanRef.current = null; }
    const chan = supabase
      .channel(`dw-${code}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "msg" }, ({ payload }) => handlerRef.current?.(payload as CMsg));
    // Single subscribe call — pass callback only when caller needs to act on ready
    chan.subscribe((status) => { if (status === "SUBSCRIBED") onReady?.(); });
    chanRef.current = chan;
    return chan;
  }

  function send(msg: CMsg) {
    chanRef.current?.send({ type: "broadcast", event: "msg", payload: msg });
  }

  function doCreateMatch() {
    const name = nameInput.trim() || "AGENT";
    setPlayerName(name);
    const code = genRoomCode(); setRoomCode(code);
    openChannel(code); // P1 just listens — no onReady needed
    setScreen("create");
  }

  function doJoinMatch() {
    const code = roomInput.trim().toUpperCase();
    if (code.length !== 4) { setJoinErr("Room code must be 4 characters"); return; }
    const name = nameInput.trim() || "AGENT";
    setPlayerName(name); setRoomCode(code);
    setWaitingJoin(true); setJoinErr("");
    // Send JOIN only after subscription is confirmed, then retry every 3s in case P1 missed it
    openChannel(code, () => {
      send({ t: "JOIN", name, avatarId: avatarIdRef.current } as CMsg);
      joinRetryRef.current = setInterval(
        () => send({ t: "JOIN", name, avatarId: avatarIdRef.current } as CMsg),
        3000
      );
    });
  }

  function doStartAI(d: Diff) {
    setDiff(d); setMode("ai");
    setOppName(d === "easy" ? "SENTINEL·I" : d === "medium" ? "CIPHER·VII" : "ORACLE·X");
    setOppAvatarId(d === "easy" ? "wraith" : d === "medium" ? "cipher" : "oracle");
    const aiC = randomCode(); setOppCode(aiC);
    setMyCode([]); setSetup([]); setCurGuess([]);
    setMyGuesses([]); setOppGuesses([]);
    setWinner(null); setOppLocked(false);
    setAiPoss(ALL_CODES); setAiThink(false);
    aiActiveRef.current = false; setRematch(null);
    setTimesUp(false); setTimedResult(null);
    setScreen("game-settings");
  }

  function doConfirmSettings() {
    setTimeRemaining(timeLimit);
    setTimesUp(false); setTimedResult(null);
    setScreen("code-setup");
  }

  function doLockCode() {
    if (!isValidCode(setup)) return;
    const code = [...setup]; setMyCode(code); myCodeRef.current = code;
    sfx.lock();
    if (mode === "ai") {
      const goFirst = Math.random() < 0.5;
      setTurn(goFirst ? "me" : "opp"); setFlipFirst(goFirst ? "me" : "opp");
      setScreen("coin-flip"); sfx.flip();
      setTimeout(() => setScreen("game"), 2400);
    } else {
      send({ t: "LOCK" } as CMsg);
      if (oppLocked) {
        setFlipFirst(turn === "me" ? "me" : "opp");
        setScreen("coin-flip"); sfx.flip();
        setTimeout(() => setScreen("game"), 2400);
      } else setScreen("waiting-code");
    }
  }

  function doSubmitGuess() {
    if (!isValidCode(curGuess) || turn !== "me" || winner) return;
    sfx.submit();
    if (mode === "ai") {
      const res = scoreGuess(curGuess, oppCode);
      setMyGuesses((prev) => [...prev, { guess: [...curGuess], dead: res.dead, wounded: res.wounded }]);
      setCurGuess([]);
      setTimeout(() => sfx.result(res.dead, res.wounded), 80);
      if (res.dead === 4) { sfx.win(); setWinner("me"); setTimeout(() => setScreen("game-over"), 500); }
      else setTurn("opp");
    } else {
      send({ t: "GUESS", g: curGuess } as CMsg);
      setCurGuess([]);
    }
  }

  function onSetupPress(n: number) { sfx.digit(); setSetup((p) => (p.length >= 4 || p.includes(n) ? p : [...p, n])); }
  function onSetupDel() { sfx.del(); setSetup((p) => p.slice(0, -1)); }
  function onGuessPress(n: number) { sfx.digit(); setCurGuess((p) => (p.length >= 4 || p.includes(n) ? p : [...p, n])); }
  function onGuessDel() { sfx.del(); setCurGuess((p) => p.slice(0, -1)); }
  function doCopy() { navigator.clipboard.writeText(roomCode).catch(() => {}); setCopied(true); sfx.click(); setTimeout(() => setCopied(false), 2000); }

  // ── Shared UI atoms ─────────────────────────────────────────
  const BackBtn = ({ onClick }: { onClick: () => void }) => (
    <button onClick={() => { sfx.click(); onClick(); }} className="flex items-center gap-1.5 text-[#2d4050] hover:text-[#4a6070] font-mono text-xs tracking-widest transition-colors">
      <ArrowLeft size={11} /> BACK
    </button>
  );
  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[10px] font-['Share_Tech_Mono',_monospace] tracking-[0.2em] text-[#2d4050] mb-2">{children}</div>
  );
  const divider = <div className="w-full h-px bg-[rgba(0,245,155,0.07)] my-5" />;

  // Settings panel (reused in game-settings screen and create screen)
  const SettingsPanel = () => (
    <div className="w-full space-y-3">
      <SectionLabel>GAME MODE</SectionLabel>
      <ModeToggle timed={timedMode} onChange={(v) => { setTimedMode(v); setTimeRemaining(v ? timeLimit : timeLimit); }} />
      <AnimatePresence>
        {timedMode && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="pt-1 space-y-2">
              <SectionLabel>TIME LIMIT</SectionLabel>
              <TimePresets value={timeLimit} onChange={(v) => { setTimeLimit(v); setTimeRemaining(v); }} />
              <div className="flex items-center gap-2 pt-1">
                <div className="text-[10px] font-mono text-[#1e3040]">Winner = closest guess when time expires</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#07090c] text-[#b8c8d4] overflow-x-hidden">
      <AnimatePresence mode="sync" initial={false}>

        {/* ── SPLASH ─────────────────────────────────────── */}
        {screen === "splash" && (
          <motion.div key="splash" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}
            className="flex flex-col items-center justify-center min-h-screen gap-8 p-8 relative overflow-hidden"
            onClick={() => setScreen("home")} style={{ cursor: "default" }}>
            <div className="absolute inset-0 pointer-events-none z-10" style={{ background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)" }} />
            {[["top-6 left-6", "border-t-2 border-l-2"], ["top-6 right-6", "border-t-2 border-r-2"], ["bottom-6 left-6", "border-b-2 border-l-2"], ["bottom-6 right-6", "border-b-2 border-r-2"]].map(([pos, border], i) => (
              <motion.div key={i} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 + i * 0.1, duration: 0.4 }}
                className={`absolute ${pos} w-8 h-8 ${border} border-[rgba(0,245,155,0.4)]`} />
            ))}
            <div className="flex flex-col gap-1 w-full max-w-xs">
              {[{ text: "SYSTEM BOOT v2.4.1", delay: 0 }, { text: "LOADING CIPHER ENGINE...", delay: 0.35 }, { text: "INITIALIZING DEDUCTION CORE...", delay: 0.7 }, { text: "SECURE CHANNEL READY", delay: 1.05 }].map(({ text, delay }) => (
                <motion.div key={text} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay, duration: 0.25 }}
                  className="font-['JetBrains_Mono',_monospace] text-[10px] text-[#1e4030] tracking-widest flex items-center gap-2">
                  <span className="text-[#00f59b]">›</span> {text}
                  <motion.span initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ delay: delay + 0.5, duration: 0.2 }} className="text-[#00f59b]">_</motion.span>
                </motion.div>
              ))}
            </div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5, duration: 0.1 }} className="flex flex-col items-center gap-3">
              <motion.h1 animate={{ opacity: [0, 1, 0.2, 1, 0.6, 1] }} transition={{ delay: 1.5, duration: 1.0, times: [0, 0.1, 0.25, 0.45, 0.7, 1] }} className="font-['Share_Tech_Mono',_monospace] text-5xl md:text-6xl text-[#00f59b] tracking-[0.1em] text-center">DEAD</motion.h1>
              <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 2.1, duration: 0.5, ease: "easeOut" }} className="h-px w-48 bg-[rgba(0,245,155,0.35)]" />
              <motion.h1 animate={{ opacity: [0, 1, 0.1, 1, 0.8, 1] }} transition={{ delay: 2.0, duration: 0.8, times: [0, 0.05, 0.2, 0.5, 0.75, 1] }} className="font-['Share_Tech_Mono',_monospace] text-5xl md:text-6xl text-[#00f59b] tracking-[0.1em] text-center">WOUNDED</motion.h1>
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.0, duration: 0.5 }} className="flex flex-col items-center gap-2">
              <p className="font-['Share_Tech_Mono',_monospace] text-[#1e4030] text-xs tracking-[0.3em]">// NUMBER DEDUCTION DUEL</p>
              <motion.p animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} className="font-['JetBrains_Mono',_monospace] text-[#2d5040] text-[10px] tracking-widest mt-2">TAP TO CONTINUE</motion.p>
            </motion.div>
            <div className="absolute inset-0 pointer-events-none opacity-[0.025]" style={{ backgroundImage: "linear-gradient(rgba(0,245,155,1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,245,155,1) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
          </motion.div>
        )}

        {/* ── AVATAR PICKER ──────────────────────────────── */}
        {screen === "avatar" && (
          <motion.div key="avatar" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-6 p-6">
            <div className="text-center">
              <div className="font-['Share_Tech_Mono',_monospace] text-xl text-[#00f59b] tracking-widest mb-1">CHOOSE YOUR IDENTITY</div>
              <div className="text-[#1e3040] text-xs font-mono tracking-widest">// select your operative profile</div>
            </div>

            {/* Callsign input */}
            <div className="w-full max-w-xs">
              <div className="text-[10px] font-['Share_Tech_Mono',_monospace] tracking-[0.2em] text-[#2d4050] mb-2">CALLSIGN</div>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="AGENT_NAME"
                maxLength={16}
                className="w-full h-11 bg-[#0c1016] border border-white/[0.08] px-3 font-['JetBrains_Mono',_monospace] text-[#b8c8d4] placeholder:text-[#1e2d3a] focus:outline-none focus:border-[rgba(0,245,155,0.25)] rounded-[3px] tracking-wider"
              />
            </div>

            {/* Avatar grid */}
            <div className="w-full max-w-xs">
              <div className="text-[10px] font-['Share_Tech_Mono',_monospace] tracking-[0.2em] text-[#2d4050] mb-3">OPERATIVE</div>
              <div className="grid grid-cols-3 gap-2">
                {AVATARS.map((av) => {
                  const selected = avatarId === av.id;
                  return (
                    <motion.button
                      key={av.id}
                      onClick={() => { sfx.click(); setAvatarId(av.id); }}
                      whileTap={{ scale: 0.94 }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-[6px] transition-all"
                      style={{
                        background: selected ? "rgba(0,245,155,0.08)" : "rgba(255,255,255,0.02)",
                        border: selected ? "1.5px solid rgba(0,245,155,0.5)" : "1.5px solid rgba(255,255,255,0.06)",
                        boxShadow: selected ? "0 0 12px rgba(0,245,155,0.15)" : "none",
                        color: selected ? "#00f59b" : "rgba(0,245,155,0.25)",
                      }}
                    >
                      <AvatarSVG id={av.id} size={36} />
                      <span className="font-['Share_Tech_Mono',_monospace] text-[8px] tracking-[0.15em]"
                        style={{ color: selected ? "#00f59b" : "#2d4050" }}>
                        {av.name}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Preview + confirm */}
            <div className="flex flex-col items-center gap-4 w-full max-w-xs">
              <div className="flex items-center gap-3">
                <AvatarBubble id={avatarId} size={48} />
                <div>
                  <div className="font-['JetBrains_Mono',_monospace] text-sm text-[#00f59b]">
                    {nameInput.trim() || "AGENT"}
                  </div>
                  <div className="font-['Share_Tech_Mono',_monospace] text-[10px] text-[#2d4050] tracking-widest">
                    {AVATARS.find(a => a.id === avatarId)?.name}
                  </div>
                </div>
              </div>
              <GameButton
                onClick={() => { setPlayerName(nameInput.trim() || "AGENT"); setScreen("home"); }}
                className="w-full h-12"
              >
                ENTER THE FIELD
              </GameButton>
            </div>
          </motion.div>
        )}

        {/* ── RESUME ─────────────────────────────────────── */}
        {screen === "resume" && savedGameRef.current && (
          <motion.div key="resume" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
            <div className="text-center">
              <div className="font-['Share_Tech_Mono',_monospace] text-xl text-[#ffaa3b] tracking-widest mb-1 flex items-center justify-center gap-2">
                <AlertTriangle size={18} /> MATCH IN PROGRESS
              </div>
              <div className="text-[#1e3040] text-xs font-mono">You left a game mid-way</div>
            </div>
            <div className="w-full max-w-xs bg-[#0c1016] border border-[rgba(255,170,59,0.2)] rounded-[6px] p-4 space-y-3">
              <div className="flex items-center gap-3">
                <AvatarBubble id={savedGameRef.current.avatarId} size={40} />
                <div className="text-[#2d4050] text-xs font-mono">vs</div>
                <AvatarBubble id={savedGameRef.current.oppAvatarId} size={40} />
                <div className="ml-2">
                  <div className="font-['JetBrains_Mono',_monospace] text-xs text-[#b8c8d4]">
                    {savedGameRef.current.playerName} vs {savedGameRef.current.oppName}
                  </div>
                  <div className="text-[10px] font-mono text-[#2d4050] mt-0.5">
                    {savedGameRef.current.mode === "ai" ? "VS AI" : "ONLINE"} · {savedGameRef.current.myGuesses.length + savedGameRef.current.oppGuesses.length} guesses made
                  </div>
                  {savedGameRef.current.timedMode && (
                    <div className="text-[10px] font-mono text-[#ffaa3b] flex items-center gap-1 mt-0.5">
                      <Timer size={9} /> {fmtTime(Math.max(0, savedGameRef.current.timeRemaining - Math.floor((Date.now() - savedGameRef.current.savedAt) / 1000)))} remaining
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <GameButton onClick={doResumeGame} className="w-full h-12">CONTINUE MATCH</GameButton>
              <GameButton onClick={() => { clearSave(); savedGameRef.current = null; setScreen("avatar"); }} variant="secondary" className="w-full h-10 text-sm">START FRESH</GameButton>
            </div>
          </motion.div>
        )}

        {/* ── HOME ───────────────────────────────────────── */}
        {screen === "home" && (
          <motion.div key="home" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-10 p-8">
            <div className="flex flex-col items-center gap-3">
              <FlickerTitle />
              <p className="font-['Share_Tech_Mono',_monospace] text-[#1a3028] text-xs tracking-[0.3em]">// NUMBER DEDUCTION DUEL</p>
            </div>
            <div className="flex flex-col gap-4 w-full max-w-xs">
              <GameButton onClick={() => { setMode("online"); setScreen("online-menu"); }} className="h-14 w-full text-base">PLAY ONLINE</GameButton>
              <GameButton onClick={() => setScreen("ai-diff")} className="h-14 w-full text-base" style={{ background: "linear-gradient(to bottom, #6ab028 0%, #4a8a14 40%, #2e6406 100%)" } as React.CSSProperties}>VS AI</GameButton>
              <button onClick={() => { sfx.click(); setScreen("guide"); }} className="flex items-center justify-center gap-2 h-9 text-[#2d4050] hover:text-[#4a6070] font-['Share_Tech_Mono',_monospace] text-xs tracking-widest transition-colors">
                <BookOpen size={12} /> HOW TO PLAY
              </button>
            </div>
            <div className="absolute bottom-6 text-[#0e1c24] text-[9px] font-['JetBrains_Mono',_monospace] tracking-[0.2em] text-center px-4">
              DEAD = RIGHT DIGIT · RIGHT POSITION &nbsp;|&nbsp; WOUNDED = RIGHT DIGIT · WRONG POSITION
            </div>
          </motion.div>
        )}

        {/* ── GUIDE ──────────────────────────────────────── */}
        {screen === "guide" && (
          <motion.div key="guide" {...TRANS} className="flex flex-col min-h-screen p-6 max-w-lg mx-auto w-full">
            <div className="flex items-center gap-3 py-4 mb-2">
              <button onClick={() => { sfx.click(); setScreen("home"); }} className="text-[#2d4050] hover:text-[#4a6070] transition-colors"><ArrowLeft size={16} /></button>
              <div className="font-['Share_Tech_Mono',_monospace] text-lg text-[#00f59b] tracking-widest flex items-center gap-2"><BookOpen size={16} /> HOW TO PLAY</div>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-8 pb-10">
              {[
                { n: 1, title: "THE MISSION", body: "Crack your opponent's secret 4-digit code before they crack yours. First to score 4 DEAD wins instantly." },
                { n: 2, title: "SET YOUR CODE", body: "Pick any 4 digits (0–9). No digit can repeat. There are 5,040 possible codes — your secret is safe." },
                { n: 3, title: "DEAD & WOUNDED", body: null },
                { n: 4, title: "TAKING TURNS", body: "Players alternate one guess per turn. Use the feedback to narrow down the code. There is no guess limit." },
                { n: 5, title: "TIMED MODE", body: "Set a time limit. When the clock hits zero, whoever got the closest single guess wins. Closest = most DEAD → most WOUNDED → fewer guesses taken." },
                { n: 6, title: "PLAY ONLINE", body: "Create a match → share the 4-letter room code → opponent joins on any device. Your secret codes never travel over the network." },
                { n: 7, title: "TIPS", body: null },
              ].map(({ n, title, body }) => (
                <div key={n} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-[rgba(0,245,155,0.12)] border border-[rgba(0,245,155,0.3)] flex items-center justify-center font-['JetBrains_Mono',_monospace] text-[10px] text-[#00f59b] shrink-0">{n}</div>
                    <div className="font-['Share_Tech_Mono',_monospace] text-sm text-[#00f59b] tracking-[0.15em]">{title}</div>
                  </div>
                  <div className="pl-8 space-y-3">
                    {body && <p className="text-xs font-mono text-[#6a8090] leading-relaxed">{body}</p>}
                    {n === 2 && (
                      <div className="flex gap-2">{[3,7,0,9].map((d,i) => (<div key={i} className="w-10 h-11 bg-[#0c1016] border border-[rgba(0,245,155,0.25)] rounded-[3px] flex items-center justify-center font-['JetBrains_Mono',_monospace] text-lg text-[#00f59b]">{d}</div>))}</div>
                    )}
                    {n === 3 && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex items-center gap-2 bg-[#0c1016] border border-white/[0.06] rounded p-2"><div className="w-3 h-3 rounded-full bg-[#ff3b5c] shrink-0"/><span className="text-[10px] font-mono text-[#6a8090]">DEAD — right digit, right position</span></div>
                          <div className="flex items-center gap-2 bg-[#0c1016] border border-white/[0.06] rounded p-2"><div className="w-3 h-3 rounded-full bg-[#ffaa3b] shrink-0"/><span className="text-[10px] font-mono text-[#6a8090]">WOUNDED — right digit, wrong spot</span></div>
                        </div>
                        <div className="bg-[#0c1016] border border-white/[0.06] rounded-[4px] p-3 space-y-2">
                          <div className="flex items-center gap-2 text-[10px] font-['JetBrains_Mono',_monospace]">
                            <span className="text-[#2d4050] w-14">SECRET</span>
                            <div className="flex gap-1">{[3,7,0,9].map((d,i)=><div key={i} className="w-7 h-7 bg-[#111820] border border-white/[0.06] rounded-[2px] flex items-center justify-center text-[#4a6070]">{d}</div>)}</div>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-['JetBrains_Mono',_monospace]">
                            <span className="text-[#2d4050] w-14">GUESS</span>
                            <div className="flex gap-1">{[3,0,7,5].map((d,i)=><div key={i} className="w-7 h-7 bg-[#111820] border border-white/[0.06] rounded-[2px] flex items-center justify-center text-[#c2cfd8]">{d}</div>)}</div>
                            <Pips dead={1} wounded={2} />
                            <span className="text-[#ff3b5c]">1D</span><span className="text-[#ffaa3b]">2W</span>
                          </div>
                          <p className="text-[10px] font-mono text-[#3d5060]">The 3 is DEAD (position 0 matches). 7 and 0 are WOUNDED (in the code, wrong spots). 5 is a miss.</p>
                        </div>
                      </div>
                    )}
                    {n === 7 && (
                      <div className="space-y-1.5">
                        {["Start with digits spread across 0–9 to gather maximum information fast.", "A WOUNDED digit IS in the code — just move it to a different slot.", "Once a digit is confirmed DEAD, lock it in every future guess.", "Hard AI uses minimax — it cracks most codes in 5 guesses. Stay sharp."].map((tip, i) => (
                          <div key={i} className="flex gap-2 text-[10px] font-mono text-[#4a6070]"><span className="text-[#1e3040] shrink-0">›</span>{tip}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── AI DIFFICULTY ──────────────────────────────── */}
        {screen === "ai-diff" && (
          <motion.div key="ai-diff" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
            <div className="text-center">
              <div className="font-['Share_Tech_Mono',_monospace] text-xl text-[#00f59b] tracking-widest mb-1">SELECT OPPONENT</div>
              <div className="text-[#1e3040] text-xs font-mono tracking-widest">VS AI</div>
            </div>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              {([{ d: "easy" as Diff, label: "SENTINEL·I", sub: "Unpredictable. Random guesses." }, { d: "medium" as Diff, label: "CIPHER·VII", sub: "Systematic. Tracks possibilities." }, { d: "hard" as Diff, label: "ORACLE·X", sub: "Optimal. Minimax deduction." }] as const).map(({ d, label, sub }) => (
                <GameButton key={d} onClick={() => doStartAI(d)} className="h-16 w-full text-left"
                  style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", paddingLeft: "1rem" } as React.CSSProperties}>
                  <div className="text-sm tracking-[0.12em]">{label}</div>
                  <div className="text-[10px] font-['Inter',_sans-serif] font-normal opacity-60 mt-0.5">{sub}</div>
                </GameButton>
              ))}
            </div>
            <BackBtn onClick={() => setScreen("home")} />
          </motion.div>
        )}

        {/* ── GAME SETTINGS ──────────────────────────────── */}
        {screen === "game-settings" && (
          <motion.div key="game-settings" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
            <div className="text-center">
              <div className="font-['Share_Tech_Mono',_monospace] text-xl text-[#00f59b] tracking-widest mb-1">GAME SETTINGS</div>
              <div className="text-[#1e3040] text-xs font-mono tracking-widest">configure before your match begins</div>
            </div>
            <div className="w-full max-w-xs space-y-6">
              <SettingsPanel />
              {divider}
              {timedMode && (
                <div className="flex items-center justify-center gap-3 py-2 bg-[rgba(255,170,59,0.05)] border border-[rgba(255,170,59,0.15)] rounded-[6px]">
                  <TimerRing remaining={timeLimit} limit={timeLimit} size={44} />
                  <div>
                    <div className="font-['Share_Tech_Mono',_monospace] text-xs text-[#ffaa3b] tracking-widest">{fmtTime(timeLimit)} MATCH</div>
                    <div className="text-[10px] font-mono text-[#3d4030] mt-0.5">winner = best approximation</div>
                  </div>
                </div>
              )}
              <GameButton onClick={doConfirmSettings} className="w-full h-12">
                {timedMode ? `START ${fmtTime(timeLimit)} MATCH` : "START MATCH"}
              </GameButton>
            </div>
            <BackBtn onClick={() => setScreen("ai-diff")} />
          </motion.div>
        )}

        {/* ── ONLINE MENU ────────────────────────────────── */}
        {screen === "online-menu" && (
          <motion.div key="online-menu" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
            <div className="text-center">
              <div className="font-['Share_Tech_Mono',_monospace] text-xl text-[#00f59b] tracking-widest mb-1">PLAY ONLINE</div>
              <div className="text-[#1e3040] text-[10px] font-mono tracking-widest">works between two browser tabs (same device)</div>
            </div>
            <div className="w-full max-w-xs space-y-4">
              <div>
                <SectionLabel>YOUR CALLSIGN</SectionLabel>
                <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="AGENT_NAME" maxLength={16}
                  className="w-full h-11 bg-[#0c1016] border border-white/[0.08] px-3 font-['JetBrains_Mono',_monospace] text-[#b8c8d4] placeholder:text-[#1e2d3a] focus:outline-none focus:border-[rgba(0,245,155,0.25)] rounded-[3px] tracking-wider" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <GameButton onClick={doCreateMatch} className="h-16 w-full">CREATE MATCH</GameButton>
                <GameButton onClick={() => setScreen("join")} className="h-16 w-full" style={{ background: "linear-gradient(to bottom, #6ab028 0%, #4a8a14 40%, #2e6406 100%)" } as React.CSSProperties}>JOIN MATCH</GameButton>
              </div>
            </div>
            <BackBtn onClick={() => setScreen("home")} />
          </motion.div>
        )}

        {/* ── CREATE MATCH ───────────────────────────────── */}
        {screen === "create" && (
          <motion.div key="create" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-6 p-8">
            <div className="text-center">
              <div className="font-['Share_Tech_Mono',_monospace] text-xl text-[#00f59b] tracking-widest mb-1">MATCH CREATED</div>
              <div className="text-[#1e3040] text-xs font-mono">Share this code with your opponent</div>
            </div>
            <div className="w-full max-w-xs space-y-4">
              <div className="flex gap-2 justify-center">
                {roomCode.split("").map((ch, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.12 }}
                    className="w-14 h-16 bg-[#0c1016] border border-[rgba(0,245,155,0.25)] rounded-[3px] flex items-center justify-center font-['JetBrains_Mono',_monospace] text-3xl font-bold text-[#00f59b]">{ch}</motion.div>
                ))}
              </div>
              <button onClick={doCopy} className="w-full h-10 border border-white/[0.08] bg-[#0c1016] hover:border-white/[0.14] text-[#6a8090] hover:text-[#9ab0c0] font-['Share_Tech_Mono',_monospace] text-xs tracking-widest transition-all rounded-[3px] flex items-center justify-center gap-2">
                {copied ? <Check size={12} className="text-[#00f59b]" /> : <Copy size={12} />} {copied ? "COPIED" : "COPY CODE"}
              </button>
              {divider}
              {/* Settings — host sets before opponent joins */}
              <SettingsPanel />
              {divider}
              <div className="flex flex-col items-center gap-3">
                <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }} className="w-2 h-2 rounded-full bg-[#00f59b]" />
                <div className="font-['Share_Tech_Mono',_monospace] text-sm text-[#2d4050] tracking-widest">WAITING FOR OPPONENT...</div>
                {timedMode && <div className="text-[10px] font-mono text-[#1e3020]">match will be {fmtTime(timeLimit)} · timed mode</div>}
              </div>
            </div>
            <BackBtn onClick={() => { if (chanRef.current) { supabase.removeChannel(chanRef.current); chanRef.current = null; } setScreen("online-menu"); }} />
          </motion.div>
        )}

        {/* ── JOIN MATCH ─────────────────────────────────── */}
        {screen === "join" && (
          <motion.div key="join" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
            <div className="text-center">
              <div className="font-['Share_Tech_Mono',_monospace] text-xl text-[#00f59b] tracking-widest mb-1">JOIN MATCH</div>
              <div className="text-[#1e3040] text-xs font-mono">Enter the room code</div>
            </div>
            <div className="w-full max-w-xs space-y-5">
              <div>
                <SectionLabel>YOUR CALLSIGN</SectionLabel>
                <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="AGENT_NAME" maxLength={16}
                  className="w-full h-11 bg-[#0c1016] border border-white/[0.08] px-3 font-['JetBrains_Mono',_monospace] text-[#b8c8d4] placeholder:text-[#1e2d3a] focus:outline-none focus:border-[rgba(0,245,155,0.25)] rounded-[3px] tracking-wider" />
              </div>
              <div>
                <SectionLabel>ROOM CODE</SectionLabel>
                <div className="flex gap-2 justify-center cursor-text" onClick={() => roomInputRef.current?.focus()}>
                  {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className={`w-14 h-16 bg-[#0c1016] rounded-[3px] flex items-center justify-center font-['JetBrains_Mono',_monospace] text-3xl font-bold transition-all ${roomInput[i] ? "border border-[rgba(0,245,155,0.25)] text-[#00f59b]" : i === roomInput.length ? "border border-[rgba(0,245,155,0.5)]" : "border border-white/[0.07] text-[#1e2d3a]"}`}>
                      {roomInput[i] ?? (i === roomInput.length ? <motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.55 }} className="w-[2px] h-8 bg-[#00f59b] rounded-full inline-block" /> : null)}
                    </div>
                  ))}
                </div>
                <input ref={roomInputRef} value={roomInput} onChange={(e) => { setRoomInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4)); setJoinErr(""); }} className="sr-only" maxLength={4} autoComplete="off" />
              </div>
              {joinErr && <div className="text-[#ff3b5c] text-xs font-mono text-center">{joinErr}</div>}
              {waitingJoin
                ? <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.5 }} className="text-xs font-['Share_Tech_Mono',_monospace] text-[#2d4050] tracking-widest text-center py-2">CONNECTING TO ROOM {roomCode}...</motion.div>
                : <GameButton onClick={doJoinMatch} disabled={roomInput.length !== 4} className="w-full h-12">JOIN</GameButton>}
            </div>
            <BackBtn onClick={() => { setWaitingJoin(false); setRoomInput(""); setJoinErr(""); setScreen("online-menu"); }} />
          </motion.div>
        )}

        {/* ── CONNECTED ──────────────────────────────────── */}
        {screen === "connected" && (
          <motion.div key="connected" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
            <div className="flex flex-col items-center gap-6">
              <div className="flex items-center gap-4">
                <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4 }} className="flex flex-col items-center gap-2">
                  <AvatarBubble id={avatarId} size={52} />
                  <div className="font-['JetBrains_Mono',_monospace] text-xs text-[#00f59b]">{playerName || "YOU"}</div>
                </motion.div>
                <motion.div initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} transition={{ delay: 0.4, duration: 0.4 }} className="h-px w-14 bg-[rgba(0,245,155,0.4)]" />
                <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6, duration: 0.4 }} className="flex flex-col items-center gap-2">
                  <AvatarBubble id={oppAvatarId} size={52} />
                  <div className="font-['JetBrains_Mono',_monospace] text-xs text-[#00f59b]">{oppName || "OPPONENT"}</div>
                </motion.div>
              </div>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 0.4 }} className="font-['Share_Tech_Mono',_monospace] text-[#00f59b] tracking-widest text-sm">LINK ESTABLISHED</motion.div>
              {timedMode && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3, duration: 0.3 }} className="flex items-center gap-2 text-[#ffaa3b] text-xs font-mono">
                  <Timer size={11} /> {fmtTime(timeLimit)} TIMED MATCH
                </motion.div>
              )}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 0.3 }} className="text-[#1e3040] font-mono text-xs">Set your secret codes...</motion.div>
            </div>
          </motion.div>
        )}

        {/* ── CODE SETUP ─────────────────────────────────── */}
        {screen === "code-setup" && (
          <motion.div key="code-setup" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-6 p-8">
            <div className="text-center">
              <div className="font-['Share_Tech_Mono',_monospace] text-xl text-[#00f59b] tracking-widest mb-1">SET YOUR CODE</div>
              <div className="text-[#1e3040] text-xs font-mono">4 digits · no repeats · {mode === "online" ? oppName || "opponent" : "AI"} will try to crack it</div>
              {timedMode && <div className="text-[#ffaa3b] text-[10px] font-mono mt-1 flex items-center justify-center gap-1"><Timer size={9} /> {fmtTime(timeLimit)} timed match</div>}
            </div>
            <div className="flex flex-col items-center gap-5 w-full">
              <CodeSlots digits={setup} activeIdx={setup.length} hidden={setup.length === 4} />
              {setup.length === 4 && <div className="text-[10px] font-mono text-[#2d4050] tracking-widest">code hidden — ready to lock</div>}
              <Keypad onPress={onSetupPress} onDel={onSetupDel} used={setup} />
              <GameButton onClick={doLockCode} disabled={!isValidCode(setup)} className="w-full max-w-[216px] h-12">LOCK IN</GameButton>
            </div>
          </motion.div>
        )}

        {/* ── WAITING FOR OPPONENT CODE ──────────────────── */}
        {screen === "waiting-code" && (
          <motion.div key="waiting-code" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
            <div className="flex flex-col items-center gap-6">
              <div className="font-['Share_Tech_Mono',_monospace] text-xl text-[#00f59b] tracking-widest">CODE LOCKED</div>
              <div className="flex gap-2">{myCode.map((_, i) => (<div key={i} className="w-12 h-14 bg-[#0c1016] border border-[rgba(0,245,155,0.2)] rounded-[3px] flex items-center justify-center text-[#2d4050] text-xl">●</div>))}</div>
              {divider}
              <div className="flex flex-col items-center gap-3">
                <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 2 }} className="w-2 h-2 rounded-full bg-[#00f59b]" />
                <div className="font-['Share_Tech_Mono',_monospace] text-sm text-[#2d4050] tracking-widest">{oppName || "OPPONENT"} IS CHOOSING...</div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── COIN FLIP ──────────────────────────────────── */}
        {screen === "coin-flip" && (
          <motion.div key="coin-flip" {...TRANS} className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
            <div className="flex flex-col items-center gap-6">
              <div className="text-[#1e3040] font-['Share_Tech_Mono',_monospace] text-xs tracking-[0.25em]">DETERMINING FIRST MOVE</div>
              <motion.div animate={{ rotateY: [0, 360, 720, 1080] }} transition={{ duration: 1.6, ease: "easeOut" }} className="w-16 h-16 bg-[rgba(0,245,155,0.08)] border border-[rgba(0,245,155,0.3)] rounded-full flex items-center justify-center" style={{ perspective: "400px" }}>
                <div className="font-['JetBrains_Mono',_monospace] text-[#00f59b] text-2xl font-bold">{flipFirst === "me" ? "Y" : "O"}</div>
              </motion.div>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="text-center">
                <div className="font-['Share_Tech_Mono',_monospace] text-lg tracking-[0.15em]" style={{ color: flipFirst === "me" ? "#00f59b" : "#b8c8d4" }}>
                  {flipFirst === "me" ? "YOU GO FIRST" : `${oppName || "OPPONENT"} GOES FIRST`}
                </div>
                <div className="text-[#1e3040] text-xs font-mono mt-1">Starting match...</div>
              </motion.div>
            </div>
          </motion.div>
        )}

        {/* ── GAME ───────────────────────────────────────── */}
        {screen === "game" && (
          <motion.div key="game" {...TRANS} className="flex flex-col min-h-screen p-4 max-w-lg mx-auto w-full relative">
            {/* Forfeit confirmation overlay */}
            <AnimatePresence>
              {showForfeit && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 bg-black/75 flex items-center justify-center p-6 rounded-[4px]">
                  <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                    className="bg-[#0c1016] border border-[rgba(255,59,92,0.35)] rounded-[8px] p-6 w-full max-w-xs space-y-4">
                    <div className="flex items-center gap-2 font-['Share_Tech_Mono',_monospace] text-sm text-[#ff3b5c] tracking-widest">
                      <AlertTriangle size={16} /> FORFEIT MATCH?
                    </div>
                    <p className="text-[#6a8090] text-xs font-mono leading-relaxed">
                      This counts as a loss. {mode === "online" ? "Your opponent will be notified." : ""}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={doForfeit}
                        className="flex-1 h-10 bg-[rgba(255,59,92,0.15)] border border-[rgba(255,59,92,0.4)] text-[#ff3b5c] font-['Share_Tech_Mono',_monospace] text-xs tracking-widest rounded-[4px] hover:bg-[rgba(255,59,92,0.25)] transition-all">
                        FORFEIT
                      </button>
                      <GameButton onClick={() => setShowForfeit(false)} variant="secondary" className="flex-1 h-10 text-xs">CANCEL</GameButton>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Header */}
            <div className="flex items-center justify-between py-2 mb-2 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AvatarBubble id={turn === "me" ? avatarId : oppAvatarId} size={30} dim={turn !== "me"} />
                {turn === "me"
                  ? <motion.div animate={{ boxShadow: ["0 0 0px rgba(0,245,155,0)", "0 0 10px rgba(0,245,155,0.3)", "0 0 0px rgba(0,245,155,0)"] }} transition={{ repeat: Infinity, duration: 2 }} className="px-2.5 py-1 bg-[rgba(0,245,155,0.1)] border border-[rgba(0,245,155,0.35)] rounded-[3px]">
                      <span className="font-['Share_Tech_Mono',_monospace] text-[#00f59b] text-xs tracking-[0.12em]">YOUR TURN</span>
                    </motion.div>
                  : <div className="px-2.5 py-1 bg-[#0c1016] border border-white/[0.06] rounded-[3px]">
                      <span className="font-['Share_Tech_Mono',_monospace] text-[#2d4050] text-xs tracking-[0.1em] truncate">{aiThink ? `${oppName} THINKING...` : `${oppName || "OPP"} DECODING`}</span>
                    </div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {timedMode
                  ? <TimerRing remaining={timeRemaining} limit={timeLimit} size={44} />
                  : <div className="font-['JetBrains_Mono',_monospace] text-[#1e2d3a] text-xs">{myGuesses.length + oppGuesses.length} MOVES</div>}
                <button onClick={() => setShowForfeit(true)} title="Exit match"
                  className="w-7 h-7 flex items-center justify-center text-[#1e2d3a] hover:text-[#ff3b5c] transition-colors">
                  <LogOut size={13} />
                </button>
              </div>
            </div>

            {/* History columns */}
            <div className="grid grid-cols-2 gap-3 flex-1 mb-4 min-h-0">
              <div className="flex flex-col min-h-0">
                <SectionLabel>YOUR ATTEMPTS</SectionLabel>
                <div className="flex-1 overflow-y-auto scrollbar-hide pr-1">
                  {myGuesses.length === 0 ? <div className="text-[#1a2530] text-[10px] font-mono py-3">No guesses yet</div> : myGuesses.map((e, i) => <GuessRow key={i} entry={e} idx={i} />)}
                </div>
              </div>
              <div className="flex flex-col min-h-0">
                <SectionLabel>INCOMING</SectionLabel>
                <div className="flex-1 overflow-y-auto scrollbar-hide pr-1">
                  {oppGuesses.length === 0 ? <div className="text-[#1a2530] text-[10px] font-mono py-3">No guesses yet</div> : oppGuesses.map((e, i) => <GuessRow key={i} entry={e} idx={i} />)}
                  {aiThink && <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.2 }} className="flex gap-1 py-2">{[0, 1, 2].map((i) => (<motion.div key={i} animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }} className="w-1.5 h-1.5 rounded-full bg-[#1e3040]" />))}</motion.div>}
                </div>
              </div>
            </div>

            {/* Input area */}
            <div className="flex flex-col items-center gap-3 pb-2">
              <div className="w-full h-px bg-[rgba(0,245,155,0.07)]" />
              <CodeSlots digits={curGuess} activeIdx={curGuess.length} />
              <Keypad onPress={onGuessPress} onDel={onGuessDel} disabled={turn !== "me" || !!winner} used={curGuess} />
              <GameButton onClick={doSubmitGuess} disabled={!isValidCode(curGuess) || turn !== "me"} className="w-full max-w-[216px] h-12">SUBMIT GUESS</GameButton>
            </div>
          </motion.div>
        )}

        {/* ── GAME OVER ──────────────────────────────────── */}
        {screen === "game-over" && (
          <motion.div key="game-over" {...TRANS} className="flex flex-col items-center min-h-screen p-6 max-w-lg mx-auto w-full">
            <div className="flex flex-col items-center gap-4 py-8 w-full">
              {/* Result banner */}
              <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }} className="text-center">
                {timesUp ? (
                  <>
                    <div className="font-['Share_Tech_Mono',_monospace] text-2xl tracking-[0.15em] text-[#ffaa3b] mb-1 flex items-center justify-center gap-2">
                      <Timer size={20} /> TIME'S UP
                    </div>
                    <div className="font-['Share_Tech_Mono',_monospace] text-xl tracking-[0.12em] mt-1" style={{ color: timedResult === "me" ? "#00f59b" : timedResult === "opp" ? "#ff3b5c" : "#7a8fa0" }}>
                      {timedResult === "me" ? "CLOSER CRACK — YOU WIN" : timedResult === "opp" ? `CLOSER CRACK — ${oppName || "OPPONENT"} WINS` : "DRAW — EQUAL PROXIMITY"}
                    </div>
                    <div className="text-[#2d4050] text-xs font-mono mt-2">
                      {timedResult === "me"
                        ? `Your best: ${getBestGuess(myGuesses)?.dead ?? 0}D ${getBestGuess(myGuesses)?.wounded ?? 0}W vs their best: ${getBestGuess(oppGuesses)?.dead ?? 0}D ${getBestGuess(oppGuesses)?.wounded ?? 0}W`
                        : timedResult === "opp"
                        ? `Their best: ${getBestGuess(oppGuesses)?.dead ?? 0}D ${getBestGuess(oppGuesses)?.wounded ?? 0}W vs your best: ${getBestGuess(myGuesses)?.dead ?? 0}D ${getBestGuess(myGuesses)?.wounded ?? 0}W`
                        : `Both reached ${getBestGuess(myGuesses)?.dead ?? 0}D ${getBestGuess(myGuesses)?.wounded ?? 0}W`}
                    </div>
                  </>
                ) : forfeitFlag ? (
                  <>
                    <div className="font-['Share_Tech_Mono',_monospace] text-2xl tracking-[0.15em] mb-1 flex items-center justify-center gap-2" style={{ color: winner === "me" ? "#00f59b" : "#ff3b5c" }}>
                      <LogOut size={20} /> {winner === "me" ? "OPPONENT FORFEITED" : "MATCH FORFEITED"}
                    </div>
                    <div className="text-[#2d4050] text-xs font-mono">
                      {winner === "me" ? `${oppName || "Opponent"} left — you win` : "You forfeited the match"}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-['Share_Tech_Mono',_monospace] text-3xl tracking-[0.15em] mb-1" style={{ color: winner === "me" ? "#00f59b" : "#ff3b5c" }}>
                      {winner === "me" ? "CODE CRACKED" : "CODE SECURED"}
                    </div>
                    <div className="text-[#2d4050] text-xs font-mono">
                      {winner === "me"
                        ? `You cracked ${oppName || "opponent"}'s code in ${myGuesses.length} ${myGuesses.length === 1 ? "guess" : "guesses"}`
                        : `${oppName || "Opponent"} cracked your code in ${oppGuesses.length} ${oppGuesses.length === 1 ? "guess" : "guesses"}`}
                    </div>
                  </>
                )}
              </motion.div>

              {divider}

              {/* Code reveal */}
              <div className="w-full grid grid-cols-2 gap-4">
                <div>
                  <SectionLabel>YOUR CODE</SectionLabel>
                  <div className="flex gap-1.5">{myCode.map((d, i) => (<div key={i} className="w-10 h-11 bg-[#0c1016] border border-[rgba(0,245,155,0.2)] rounded-[3px] flex items-center justify-center font-['JetBrains_Mono',_monospace] text-lg text-[#00f59b]">{d}</div>))}</div>
                </div>
                <div>
                  <SectionLabel>{mode === "ai" ? "AI CODE" : `${oppName || "OPP"} CODE`}</SectionLabel>
                  <div className="flex gap-1.5">{(oppCode.length === 4 ? oppCode : [null, null, null, null]).map((d, i) => (<div key={i} className="w-10 h-11 bg-[#0c1016] border border-white/[0.08] rounded-[3px] flex items-center justify-center font-['JetBrains_Mono',_monospace] text-lg text-[#b8c8d4]">{d !== null ? d : <span className="text-[#1e2d3a] text-xs">?</span>}</div>))}</div>
                </div>
              </div>

              {divider}

              {/* Guess histories */}
              <div className="w-full grid grid-cols-2 gap-4">
                <div>
                  <SectionLabel>YOUR ATTEMPTS ({myGuesses.length})</SectionLabel>
                  <div className="max-h-40 overflow-y-auto scrollbar-hide">{myGuesses.map((e, i) => <GuessRow key={i} entry={e} idx={i} />)}</div>
                </div>
                <div>
                  <SectionLabel>INCOMING ({oppGuesses.length})</SectionLabel>
                  <div className="max-h-40 overflow-y-auto scrollbar-hide">{oppGuesses.map((e, i) => <GuessRow key={i} entry={e} idx={i} />)}</div>
                </div>
              </div>

              {divider}

              {/* Actions */}
              <div className="flex flex-col gap-3 w-full">
                {mode === "ai" && <GameButton onClick={() => doStartAI(diff)} className="w-full h-12">REMATCH</GameButton>}
                {mode === "online" && (
                  <>
                    {rematch === null && <GameButton onClick={() => { send({ t: "REMATCH" } as CMsg); setRematch("sent"); }} className="w-full h-12">PROPOSE REMATCH</GameButton>}
                    {rematch === "sent" && <div className="text-center text-[#2d4050] text-xs font-mono py-3">Waiting for {oppName} to accept...</div>}
                    {rematch === "received" && (
                      <>
                        <div className="text-center text-[#2d4050] text-xs font-mono">{oppName} wants a rematch</div>
                        <div className="flex gap-2">
                          <GameButton onClick={() => { send({ t: "REMATCH_OK" } as CMsg); resetForRematch(); }} className="flex-1 h-12">ACCEPT</GameButton>
                          <GameButton onClick={() => setRematch(null)} variant="secondary" className="flex-1 h-12">DECLINE</GameButton>
                        </div>
                      </>
                    )}
                  </>
                )}
                <GameButton onClick={fullReset} variant="secondary" className="w-full h-10 text-sm">MAIN MENU</GameButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <style>{`.scrollbar-hide{scrollbar-width:none}.scrollbar-hide::-webkit-scrollbar{display:none}`}</style>
    </div>
  );
}
