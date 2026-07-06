import { useState, useEffect, useRef, useCallback } from "react";

const API_URL = "https://api.anthropic.com/v1/messages";

// ── Colour tokens ──────────────────────────────────────────────
const C = {
  bg:        "#0a0a0f",
  panel:     "#11111a",
  border:    "#1e1e2e",
  gold:      "#d4a847",
  goldLight: "#f0c860",
  goldDim:   "#8a6e2a",
  green:     "#00d48a",
  red:       "#ff4d6a",
  blue:      "#4d9fff",
  muted:     "#4a4a6a",
  text:      "#e8e8f0",
  textDim:   "#7a7a9a",
};

// ── Helpers ────────────────────────────────────────────────────
function fmt(n, d = 2) { return Number(n).toFixed(d); }
function ts() { return new Date().toLocaleTimeString("en-GB", { hour12: false }); }

// ── Tiny sparkline ─────────────────────────────────────────────
function Sparkline({ data, color }) {
  if (!data || data.length < 2) return null;
  const w = 120, h = 36;
  const mn = Math.min(...data), mx = Math.max(...data);
  const range = mx - mn || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - mn) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── Signal badge ───────────────────────────────────────────────
function SignalBadge({ signal }) {
  const cfg = {
    BUY:  { color: C.green, bg: "#00d48a18", label: "▲ BUY" },
    SELL: { color: C.red,   bg: "#ff4d6a18", label: "▼ SELL" },
    HOLD: { color: C.gold,  bg: "#d4a84718", label: "◆ HOLD" },
  }[signal] || { color: C.muted, bg: "#4a4a6a18", label: "— —" };

  return (
    <span style={{
      display: "inline-block", padding: "4px 14px", borderRadius: 4,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40`,
      fontFamily: "monospace", fontWeight: 700, fontSize: 13, letterSpacing: 1,
    }}>
      {cfg.label}
    </span>
  );
}

// ── Stat tile ──────────────────────────────────────────────────
function Stat({ label, value, color, sub }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 6, padding: "12px 16px", flex: 1, minWidth: 0,
    }}>
      <div style={{ color: C.textDim, fontSize: 10, letterSpacing: 1.5, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: color || C.text, fontSize: 18, fontFamily: "monospace", fontWeight: 700 }}>{value ?? "—"}</div>
      {sub && <div style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── Price candlestick (simple bar chart simulation) ─────────────
function CandleChart({ candles }) {
  if (!candles || candles.length === 0) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 160, color: C.muted, fontSize: 12 }}>
      Awaiting price data…
    </div>
  );
  const w = 360, h = 140, pad = 20;
  const vals = candles.flatMap(c => [c.h, c.l]);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const range = mx - mn || 1;
  const cw = Math.floor((w - pad * 2) / candles.length);

  function yOf(v) { return pad + ((mx - v) / range) * (h - pad * 2); }

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {candles.map((c, i) => {
        const x = pad + i * cw + cw * 0.15;
        const bw = cw * 0.7;
        const bull = c.c >= c.o;
        const col = bull ? C.green : C.red;
        const top = yOf(Math.max(c.o, c.c));
        const bot = yOf(Math.min(c.o, c.c));
        const ht = Math.max(bot - top, 1);
        return (
          <g key={i}>
            <line x1={x + bw / 2} y1={yOf(c.h)} x2={x + bw / 2} y2={yOf(c.l)} stroke={col} strokeWidth="1" />
            <rect x={x} y={top} width={bw} height={ht} fill={col} opacity="0.85" rx="1" />
          </g>
        );
      })}
    </svg>
  );
}

// ── Main app ───────────────────────────────────────────────────
export default function App() {
  const [price, setPrice]       = useState(null);
  const [priceHist, setPriceHist] = useState([]);
  const [candles, setCandles]   = useState([]);
  const [change, setChange]     = useState(null);
  const [signal, setSignal]     = useState(null);
  const [analysis, setAnalysis] = useState("");
  const [entry, setEntry]       = useState(null);
  const [sl, setSl]             = useState(null);
  const [tp1, setTp1]           = useState(null);
  const [tp2, setTp2]           = useState(null);
  const [confidence, setConf]   = useState(null);
  const [log, setLog]           = useState([]);
  const [loading, setLoading]   = useState(false);
  const [scanning, setScanning] = useState(false);
  const [interval, setInterval_] = useState(60);
  const [countdown, setCountdown] = useState(0);
  const [lastScan, setLastScan] = useState(null);
  const [error, setError]       = useState(null);
  const timerRef = useRef(null);
  const cdRef    = useRef(null);

  // ── Fetch XAUUSD price from Yahoo Finance via proxy ────────────
  const fetchPrice = useCallback(async () => {
    try {
      // Use Yahoo Finance v8 endpoint (CORS-friendly via allorigins)
      const url = `https://api.allorigins.win/raw?url=${encodeURIComponent("https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=5m&range=2d")}`;
      const res  = await fetch(url);
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error("No data");

      const meta    = result.meta;
      const quotes  = result.indicators?.quote?.[0];
      const times   = result.timestamp;

      const live = meta.regularMarketPrice;
      const prev = meta.previousClose || meta.chartPreviousClose;
      const pct  = ((live - prev) / prev) * 100;

      setPrice(live);
      setChange({ raw: live - prev, pct });
      setPriceHist(h => [...h.slice(-29), live]);

      // Build last 20 candles
      if (quotes && times) {
        const len   = Math.min(times.length, 20);
        const start = times.length - len;
        const cs    = [];
        for (let i = start; i < times.length; i++) {
          if (quotes.open[i] != null) {
            cs.push({ o: quotes.open[i], h: quotes.high[i], l: quotes.low[i], c: quotes.close[i] });
          }
        }
        setCandles(cs);
        return { live, prev, pct, quotes, times, meta };
      }
      return { live, prev, pct };
    } catch (e) {
      setError("Price fetch failed — check connection");
      return null;
    }
  }, []);

  // ── Generate AI signal via Claude API ─────────────────────────
  const generateSignal = useCallback(async (priceData) => {
    if (!priceData) return;
    setLoading(true);
    setError(null);
    try {
      const { live, prev, pct, quotes, times } = priceData;

      // Build recent OHLCV summary for AI
      let ohlcSummary = "";
      if (quotes && times) {
        const len   = Math.min(times.length, 10);
        const start = times.length - len;
        for (let i = start; i < times.length; i++) {
          if (quotes.open[i] != null) {
            const d = new Date(times[i] * 1000);
            ohlcSummary += `${d.toISOString().slice(11,16)} O:${fmt(quotes.open[i])} H:${fmt(quotes.high[i])} L:${fmt(quotes.low[i])} C:${fmt(quotes.close[i])}\n`;
          }
        }
      }

      const prompt = `You are an expert XAUUSD (Gold/USD) day trader. Analyse the following live market data and generate a precise trading signal.

CURRENT DATA:
- Live Price: ${fmt(live, 2)}
- Previous Close: ${fmt(prev, 2)}
- Change: ${pct >= 0 ? "+" : ""}${fmt(pct, 3)}%

RECENT 5-MINUTE CANDLES (last 10):
${ohlcSummary || "Not available"}

Based on price action, momentum, and intraday structure:
1. Determine direction: BUY, SELL, or HOLD
2. Identify key technical levels
3. Set precise Entry, Stop Loss, TP1, TP2
4. Give a confidence score 1-100

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "signal": "BUY" | "SELL" | "HOLD",
  "entry": <number>,
  "stop_loss": <number>,
  "tp1": <number>,
  "tp2": <number>,
  "confidence": <1-100>,
  "reasoning": "<2-3 sentence technical rationale>",
  "bias": "<brief market bias e.g. bullish momentum above 2340 support>"
}`;

      const res  = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await res.json();
      const raw  = data.content?.map(b => b.text || "").join("") || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      setSignal(parsed.signal);
      setEntry(parsed.entry);
      setSl(parsed.stop_loss);
      setTp1(parsed.tp1);
      setTp2(parsed.tp2);
      setConf(parsed.confidence);
      setAnalysis(parsed.reasoning + (parsed.bias ? " " + parsed.bias : ""));
      setLastScan(ts());

      setLog(prev => [{
        time: ts(),
        signal: parsed.signal,
        price: live,
        entry: parsed.entry,
        sl: parsed.stop_loss,
        tp1: parsed.tp1,
        confidence: parsed.confidence,
      }, ...prev.slice(0, 9)]);

    } catch (e) {
      setError("Signal generation failed: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Full scan: price then signal ───────────────────────────────
  const runScan = useCallback(async () => {
    const pd = await fetchPrice();
    await generateSignal(pd);
  }, [fetchPrice, generateSignal]);

  // ── Auto-scan loop ─────────────────────────────────────────────
  useEffect(() => {
    if (scanning) {
      runScan();
      timerRef.current = setInterval(runScan, interval * 1000);
      setCountdown(interval);
      cdRef.current = setInterval(() => {
        setCountdown(c => (c <= 1 ? interval : c - 1));
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      clearInterval(cdRef.current);
    }
    return () => { clearInterval(timerRef.current); clearInterval(cdRef.current); };
  }, [scanning, interval, runScan]);

  // ── Styles ─────────────────────────────────────────────────────
  const s = {
    root: {
      minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      padding: "16px", boxSizing: "border-box", maxWidth: 480, margin: "0 auto",
    },
    header: {
      display: "flex", justifyContent: "space-between", alignItems: "center",
      marginBottom: 16,
    },
    logo: {
      display: "flex", alignItems: "center", gap: 8,
    },
    logoMark: {
      width: 32, height: 32, borderRadius: 6,
      background: `linear-gradient(135deg, ${C.goldDim}, ${C.gold})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 900, fontSize: 14, color: "#0a0a0f", letterSpacing: -1,
    },
    logoText: {
      fontSize: 15, fontWeight: 700, letterSpacing: 0.5, color: C.goldLight,
    },
    logoSub: { fontSize: 10, color: C.muted, letterSpacing: 1 },
    dot: (on) => ({
      width: 8, height: 8, borderRadius: "50%",
      background: on ? C.green : C.muted,
      boxShadow: on ? `0 0 6px ${C.green}` : "none",
    }),
    card: {
      background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 8, marginBottom: 12, overflow: "hidden",
    },
    cardHead: {
      padding: "10px 14px", borderBottom: `1px solid ${C.border}`,
      fontSize: 10, letterSpacing: 2, color: C.muted, textTransform: "uppercase",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    },
    cardBody: { padding: "14px" },
    priceNum: {
      fontSize: 36, fontFamily: "monospace", fontWeight: 800,
      color: C.goldLight, letterSpacing: -1, lineHeight: 1,
    },
    changePill: (up) => ({
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      background: up ? "#00d48a18" : "#ff4d6a18",
      color: up ? C.green : C.red,
      fontSize: 12, fontFamily: "monospace", marginLeft: 8,
    }),
    statsRow: { display: "flex", gap: 8, marginBottom: 12 },
    levelRow: {
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "7px 0", borderBottom: `1px solid ${C.border}`,
    },
    levelLabel: { fontSize: 11, color: C.textDim, letterSpacing: 1 },
    btn: (primary, active) => ({
      padding: "10px 20px", borderRadius: 6, border: "none", cursor: "pointer",
      fontWeight: 700, fontSize: 13, letterSpacing: 0.5, transition: "all 0.2s",
      background: primary
        ? (active ? C.red : `linear-gradient(135deg, ${C.goldDim}, ${C.gold})`)
        : C.border,
      color: primary ? (active ? C.text : "#0a0a0f") : C.textDim,
    }),
    select: {
      background: C.border, border: `1px solid ${C.muted}`, borderRadius: 4,
      color: C.text, padding: "6px 10px", fontSize: 12, cursor: "pointer",
    },
    logRow: {
      display: "flex", gap: 8, alignItems: "center",
      padding: "6px 0", borderBottom: `1px solid ${C.border}`,
      fontSize: 11, fontFamily: "monospace",
    },
    confBar: (pct) => ({
      height: 4, borderRadius: 2, width: "100%", background: C.border,
      position: "relative", overflow: "hidden",
    }),
    confFill: (pct) => ({
      position: "absolute", left: 0, top: 0, height: "100%",
      width: `${pct}%`, borderRadius: 2,
      background: pct >= 70 ? C.green : pct >= 50 ? C.gold : C.red,
    }),
  };

  const up = change?.pct >= 0;

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.logo}>
          <div style={s.logoMark}>Au</div>
          <div>
            <div style={s.logoText}>XAUUSD Signal</div>
            <div style={s.logoSub}>GOLD · DAY TRADER</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={s.dot(scanning)} />
          <span style={{ fontSize: 11, color: scanning ? C.green : C.muted }}>
            {scanning ? `LIVE · ${countdown}s` : "OFFLINE"}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "#ff4d6a15", border: `1px solid ${C.red}40`, borderRadius: 6, padding: "8px 14px", marginBottom: 12, fontSize: 12, color: C.red }}>
          ⚠ {error}
        </div>
      )}

      {/* Price card */}
      <div style={s.card}>
        <div style={s.cardHead}>
          <span>Live Price</span>
          {lastScan && <span>Last scan {lastScan}</span>}
        </div>
        <div style={s.cardBody}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={s.priceNum}>
                {price ? fmt(price, 2) : "—"}
                {change && (
                  <span style={s.changePill(up)}>
                    {up ? "+" : ""}{fmt(change.pct, 2)}%
                  </span>
                )}
              </div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
                USD / troy oz · XAU/USD (GC=F)
                {change && <span style={{ marginLeft: 8, color: up ? C.green : C.red }}>{up ? "▲" : "▼"} {fmt(Math.abs(change.raw), 2)}</span>}
              </div>
            </div>
            <Sparkline data={priceHist} color={C.gold} />
          </div>
        </div>
      </div>

      {/* Candle chart */}
      <div style={s.card}>
        <div style={s.cardHead}><span>5m Candles · Last 20</span></div>
        <div style={{ padding: "8px 14px 12px" }}>
          <CandleChart candles={candles} />
        </div>
      </div>

      {/* AI Signal */}
      <div style={{ ...s.card, border: signal ? `1px solid ${signal === "BUY" ? C.green : signal === "SELL" ? C.red : C.gold}40` : `1px solid ${C.border}` }}>
        <div style={s.cardHead}>
          <span>AI Signal</span>
          {loading && <span style={{ color: C.gold }}>● Analysing…</span>}
        </div>
        <div style={s.cardBody}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <SignalBadge signal={signal || "—"} />
            {confidence != null && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>CONFIDENCE</div>
                <div style={{ fontSize: 16, fontFamily: "monospace", fontWeight: 700, color: confidence >= 70 ? C.green : confidence >= 50 ? C.gold : C.red }}>
                  {confidence}%
                </div>
              </div>
            )}
          </div>

          {confidence != null && (
            <div style={{ marginBottom: 12 }}>
              <div style={s.confBar(confidence)}><div style={s.confFill(confidence)} /></div>
            </div>
          )}

          {analysis && (
            <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginBottom: 12, padding: "8px 10px", background: "#ffffff06", borderRadius: 4 }}>
              {analysis}
            </div>
          )}

          {/* Levels */}
          {entry != null && (
            <div>
              {[
                { label: "ENTRY",     val: entry, color: C.blue },
                { label: "STOP LOSS", val: sl,    color: C.red },
                { label: "TARGET 1",  val: tp1,   color: C.green },
                { label: "TARGET 2",  val: tp2,   color: C.goldLight },
              ].map(({ label, val, color }) => (
                <div key={label} style={s.levelRow}>
                  <span style={s.levelLabel}>{label}</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 700, color, fontSize: 15 }}>
                    {val ? fmt(val, 2) : "—"}
                  </span>
                </div>
              ))}
              {entry && sl && tp1 && (
                <div style={{ marginTop: 8, fontSize: 11, color: C.muted, textAlign: "right" }}>
                  R:R to TP1 = 1 : {fmt(Math.abs(tp1 - entry) / Math.abs(entry - sl), 1)}
                  {tp2 && ` · TP2 = 1 : ${fmt(Math.abs(tp2 - entry) / Math.abs(entry - sl), 1)}`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={s.card}>
        <div style={s.cardHead}><span>Scan Settings</span></div>
        <div style={{ ...s.cardBody, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, letterSpacing: 1 }}>INTERVAL</div>
            <select
              style={s.select}
              value={interval}
              onChange={e => setInterval_(Number(e.target.value))}
              disabled={scanning}
            >
              <option value={30}>30 sec</option>
              <option value={60}>1 min</option>
              <option value={120}>2 min</option>
              <option value={300}>5 min</option>
              <option value={600}>10 min</option>
            </select>
          </div>
          <div style={{ flex: 1, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={s.btn(false)} onClick={runScan} disabled={loading}>
              {loading ? "…" : "Scan Now"}
            </button>
            <button style={s.btn(true, scanning)} onClick={() => setScanning(v => !v)}>
              {scanning ? "Stop" : "Auto Scan"}
            </button>
          </div>
        </div>
      </div>

      {/* Signal log */}
      {log.length > 0 && (
        <div style={s.card}>
          <div style={s.cardHead}><span>Signal History</span></div>
          <div style={{ padding: "0 14px 8px" }}>
            {log.map((l, i) => (
              <div key={i} style={s.logRow}>
                <span style={{ color: C.muted, minWidth: 48 }}>{l.time}</span>
                <span style={{ color: l.signal === "BUY" ? C.green : l.signal === "SELL" ? C.red : C.gold, minWidth: 38 }}>
                  {l.signal}
                </span>
                <span style={{ color: C.textDim }}>${fmt(l.price, 2)}</span>
                <span style={{ marginLeft: "auto", color: l.confidence >= 70 ? C.green : C.gold }}>
                  {l.confidence}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ textAlign: "center", color: C.muted, fontSize: 10, marginTop: 8, letterSpacing: 1 }}>
        FOR REFERENCE ONLY · NOT FINANCIAL ADVICE
      </div>
    </div>
  );
}
