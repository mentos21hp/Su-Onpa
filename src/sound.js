// 音波相撲: 効果音（音声ファイルなし。Web Audio で合成する）
(function (root) {
  const KEY = 'onpa-sumo-muted';
  let ac = null, master = null, noiseBuf = null, lastThud = 0;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch { /* 保存不可でも動く */ }

  // iOS はユーザー操作の中で作らないと鳴らないので、ボタンを押した時に呼ぶ
  function unlock() {
    try {
      if (!ac) {
        const AC = root.AudioContext || root.webkitAudioContext;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = muted ? 0 : 0.7;
        master.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state === 'suspended') ac.resume();
    } catch { ac = null; }
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* 無視 */ }
    if (master) master.gain.value = m ? 0 : 0.7;
  }

  // 音程が変わる単音
  function tone(freq, dur, { type = 'sine', vol = 0.5, to = null, at = 0 } = {}) {
    if (!ac || muted) return;
    const t = ac.currentTime + at;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // フィルターを通したノイズ（衝撃音・歓声）
  function noise(dur, { vol = 0.4, freq = 1000, q = 1, type = 'bandpass', at = 0, attack = 0.005 } = {}) {
    if (!ac || muted) return;
    const t = ac.currentTime + at;
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  root.Sfx = {
    unlock, setMuted, isMuted: () => muted,
    beep: (hi = false) => tone(hi ? 880 : 520, 0.15, { type: 'square', vol: 0.25 }),
    // 太鼓: 低い音の急降下 + 胴鳴り
    drum(at = 0) {
      tone(140, 0.35, { to: 50, vol: 0.9, at });
      noise(0.12, { vol: 0.35, freq: 300, q: 0.7, at });
    },
    // 拍子木: カーン
    clack(at = 0) {
      tone(1800, 0.08, { type: 'square', vol: 0.35, at });
      tone(1200, 0.12, { type: 'triangle', vol: 0.4, at });
      noise(0.05, { vol: 0.5, freq: 3000, q: 2, at });
    },
    // ぶつかり合い（連続で鳴りすぎないよう間引く）
    thud() {
      if (!ac || performance.now() - lastThud < 120) return;
      lastThud = performance.now();
      tone(110, 0.25, { to: 40, vol: 0.9 });
      noise(0.15, { vol: 0.6, freq: 500, q: 0.5 });
    },
    // 勝ち: 歓声（ノイズのうねり）+ 上昇音
    win() {
      noise(1.6, { vol: 0.5, freq: 1400, q: 0.4, attack: 0.25 });
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.3, at: 0.1 + i * 0.1 }));
    },
    // 負け: ため息のような下降音
    lose() {
      tone(400, 0.9, { type: 'sawtooth', to: 90, vol: 0.25 });
      noise(0.8, { vol: 0.2, freq: 700, q: 0.4, type: 'lowpass', attack: 0.1 });
    },
  };
})(globalThis);
