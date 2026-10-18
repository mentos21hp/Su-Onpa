// 音波相撲: 画面進行・録音・描画
(() => {
  const C = OnpaCore;
  const $ = id => document.getElementById(id);
  const canvas = $('stage'), ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const SCALE = W / 720, GROUND = H * 0.78;
  const FONT = '"Yuji Syuku","Hiragino Mincho ProN","Yu Mincho",serif';
  const GHOST_KEY = 'onpa-sumo-ghosts', YOKO_KEY = 'onpa-sumo-yokozuna', PLAYED_KEY = 'onpa-sumo-played';
  const REC_MS = 1000;

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存不可でも遊べる */ } },
  };

  // ---- 状態 ----
  let me = null;                 // 自分の力士
  let g = null;                  // 進行中の取組
  let phase = 'title';           // title | naming | intro | fight | result
  let phaseT = 0;
  let streak = 0, wear = { scale: 1, push: 1 }, myEnv = null;
  let lastKimarite = '';
  let shake = 0, confetti = [];
  let lastNow = performance.now();

  const setStatus = t => { $('status').textContent = t; };
  const setHud = () => {
    $('rank').textContent = streak >= 10 ? `第${store.get(YOKO_KEY, 0) + 1}代 音波横綱` : C.rankOf(streak);
    $('streak').textContent = `${streak}人抜き`;
    $('opp').textContent = g ? `対 ${g.enemy.shikona}` : (me ? me.shikona : '');
  };

  // ---- 録音 ----
  // iOS Safari は、タップ直後にマイクと AudioContext を開始しないと音が取れないため、
  // カウントダウン前に開いておき、1秒間だけチャンクを溜める
  async function openMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } });
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    await ac.resume();
    const src = ac.createMediaStreamSource(stream);
    const proc = ac.createScriptProcessor(4096, 1, 1);
    const mic = { stream, ac, src, proc, chunks: [], on: false };
    proc.onaudioprocess = e => { if (mic.on) mic.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    const mute = ac.createGain(); mute.gain.value = 0;   // 自分の声がスピーカーから出ないように
    src.connect(proc); proc.connect(mute); mute.connect(ac.destination);
    return mic;
  }

  async function capture(mic, ms) {
    mic.on = true;
    await new Promise(r => setTimeout(r, ms));
    mic.on = false;
    mic.proc.disconnect(); mic.src.disconnect();
    mic.stream.getTracks().forEach(t => t.stop());
    const sr = mic.ac.sampleRate; mic.ac.close();
    const all = new Float32Array(mic.chunks.reduce((n, c) => n + c.length, 0));
    let o = 0; for (const c of mic.chunks) { all.set(c, o); o += c.length; }
    return C.analyzeSamples(all.subarray(0, Math.min(all.length, Math.floor(sr * ms / 1000))), sr);
  }

  // 録音中、残り時間を減っていくバーで見せる
  function recordWithBar(mic) {
    const bar = $('recbar'), fill = $('recfill');
    bar.hidden = false;
    fill.style.transition = 'none'; fill.style.width = '100%';
    void fill.offsetWidth;                       // 初期値を確定させてからアニメーション開始
    fill.style.transition = `width ${REC_MS}ms linear`; fill.style.width = '0%';
    return capture(mic, REC_MS).finally(() => { bar.hidden = true; });
  }

  async function onRecord() {
    Sfx.unlock();
    $('btnRec').disabled = true; $('btnRandom').disabled = true;
    try {
      const mic = await openMic();
      // 初回は 3・2・1 と数え、慣れた2回目以降は 1 だけにして素早く始める
      const count = store.get(PLAYED_KEY, false) ? [1] : [3, 2, 1];
      for (const n of count) { setStatus(`${n}…`); Sfx.beep(); await new Promise(r => setTimeout(r, 1000)); }
      setStatus('今だ、叫べ！！');
      const spec = await recordWithBar(mic);
      store.set(PLAYED_KEY, true);
      if (!spec) { setStatus('声が小さすぎる！もう一度。'); return enableButtons(); }
      startCareer(spec);
    } catch (e) {
      setStatus('マイクが使えません。「ランダム」で遊べます。');
      enableButtons();
    }
  }
  const enableButtons = () => { $('btnRec').disabled = false; $('btnRandom').disabled = false; };

  function startCareer(spec) {
    me = spec; myEnv = spec.env.slice();
    streak = 0; wear = { scale: 1, push: 1 }; lastKimarite = '';
    phase = 'naming'; phaseT = 0; g = null;
    $('result').hidden = true;
    setHud();
    setStatus(`四股名『${me.shikona}』 体重 ${C.weightKg(me)}kg`);
  }

  // ---- 取組 ----
  function pickEnemy() {
    const ghosts = store.get(GHOST_KEY, []);
    if (ghosts.length && Math.random() < 0.5) {
      const gh = ghosts[Math.floor(Math.random() * ghosts.length)];
      return { ...gh, ghost: true };
    }
    return C.randomSpec(Math.random, streak);
  }

  function startBout() {
    const enemy = pickEnemy();
    const specL = { ...me, env: myEnv };
    g = { enemy, battle: C.createBattle(specL, enemy, { scaleL: wear.scale, pushL: wear.push }), decided: 0 };
    phase = 'intro'; phaseT = 0;
    Sfx.drum(); Sfx.drum(0.35);              // 土俵入りの太鼓
    setHud();
    setStatus(`${enemy.shikona}（${C.weightKg(enemy)}kg）が土俵入り`);
  }

  function onDecided(res) {
    lastKimarite = res.kimarite.name;
    g.decided = 0;
    shake = 14;
    Sfx.clack(); (res.winner === 'L' ? Sfx.win : Sfx.lose)();
    if (res.winner === 'L') for (let i = 0; i < 60; i++) {
      confetti.push({ x: W / 2, y: H * 0.3, vx: (Math.random() - .5) * 8, vy: -Math.random() * 6 - 2, c: `hsl(${Math.random() * 360},80%,60%)`, t: 0 });
    }
  }

  function afterBout() {
    const res = g.battle.over;
    if (res.winner === 'L') {
      streak++;
      wear.scale *= 0.97;                 // 突起が丸くなる
      wear.push *= 0.95;                  // 疲労で推進力ダウン
      myEnv = C.smoothEnv(myEnv, 0.06);
      startBout();
    } else {
      finish();
    }
  }

  // ---- 結果 ----
  function finish() {
    phase = 'result';
    const ghosts = store.get(GHOST_KEY, []);
    ghosts.push({ shikona: me.shikona, env: me.env, loud: me.loud, peak: me.peak, spread: me.spread, win_streak: streak });
    store.set(GHOST_KEY, ghosts.slice(-30));
    let title = C.rankOf(streak);
    if (streak >= 10) {
      const n = store.get(YOKO_KEY, 0) + 1; store.set(YOKO_KEY, n);
      title = `第${n}代 音波横綱`;
    }
    $('card').src = makeCard(title).toDataURL('image/png');
    $('result').hidden = false;
    setStatus('');
  }

  function silhouette(c, env, x, y, h, color) {
    const w = h * 0.55, s = h * 0.45;
    c.fillStyle = color; c.beginPath();
    c.moveTo(x, y);
    env.forEach((a, i) => c.lineTo(x + w + s * a, y + h * 0.8 * i / (env.length - 1)));
    c.lineTo(x + w, y + h * 0.8); c.lineTo(x + w + 20, y + h); c.lineTo(x - 10, y + h); c.lineTo(x - 10, y + h * 0.8);
    c.lineTo(x, y); c.fill();
    c.beginPath(); c.arc(x + w * 0.5, y - h * 0.1, h * 0.12, 0, Math.PI * 2); c.fill();
  }

  function makeCard(title) {
    const cv = document.createElement('canvas'); cv.width = 600; cv.height = 800;
    const c = cv.getContext('2d');
    c.fillStyle = '#f4e9d0'; c.fillRect(0, 0, 600, 800);
    c.strokeStyle = '#8b1a1a'; c.lineWidth = 8; c.strokeRect(14, 14, 572, 772);
    c.textAlign = 'center'; c.fillStyle = '#222';
    c.font = `bold 40px ${FONT}`; c.fillText('音波相撲 番付', 300, 90);
    c.fillStyle = '#8b1a1a'; c.font = `bold 84px ${FONT}`; c.fillText(title, 300, 210);
    c.fillStyle = '#222'; c.font = `bold 56px ${FONT}`; c.fillText(me.shikona, 300, 300);
    silhouette(c, me.env, 190, 360, 200, '#222');
    c.font = `bold 64px ${FONT}`; c.fillStyle = '#c62828'; c.fillText(`${streak}人抜き`, 300, 640);
    c.fillStyle = '#222'; c.font = `32px ${FONT}`;
    c.fillText(lastKimarite ? `最後の決まり手：${lastKimarite}` : '', 300, 700);
    c.font = `22px ${FONT}`; c.fillText('あなたの叫び声が、そのまま力士になる。', 300, 755);
    return cv;
  }

  const shareText = () => `『${me.shikona}』が${streak}人抜き達成！（最後の決まり手：${lastKimarite}） #音波相撲`;

  function cardBlob() {
    const img = $('card'); const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    cv.getContext('2d').drawImage(img, 0, 0);
    return new Promise(r => cv.toBlob(r, 'image/png'));
  }
  async function onShare() {
    const file = new File([await cardBlob()], 'onpa-sumo.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], text: shareText() }); return; } catch { /* キャンセル */ }
    }
    window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText()), '_blank');
  }
  function onSave() {
    const a = document.createElement('a'); a.href = $('card').src; a.download = 'onpa-sumo.png'; a.click();
  }

  // ---- 描画 ----
  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, '#2a1a14'); sky.addColorStop(1, '#6b3a22');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // 観客
    ctx.fillStyle = '#120b08';
    for (let i = 0; i < 20; i++) {
      const x = i * 32 + 8, h = 26 + (i * 37 % 17);
      ctx.beginPath(); ctx.arc(x + 12, GROUND - 150 - h * 0.3, 11, 0, 7); ctx.fill();
      ctx.fillRect(x, GROUND - 140 - h * 0.3, 24, 60);
    }
    ctx.fillStyle = '#8b1a1a'; ctx.fillRect(W / 2 - 60, 20, 120, 8);
    ctx.fillStyle = '#3a2418'; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.save();
    ctx.translate(W / 2, GROUND); ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#d9b36b'; ctx.fillRect(-310, 0, 620, 40);       // 土俵
    ctx.fillStyle = '#8a6a30';
    for (const x of [-300, 300]) ctx.fillRect(x - 11, -6, 22, 6);    // 俵
    ctx.restore();
  }

  function drawRikishi(r, color) {
    ctx.save();
    ctx.translate(W / 2, GROUND); ctx.scale(SCALE, SCALE);
    ctx.fillStyle = color; ctx.strokeStyle = '#1a0f0a'; ctx.lineWidth = 1.5;
    r.body.parts.slice(1).forEach((p, i) => {
      ctx.beginPath(); p.vertices.forEach((v, j) => j ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)); ctx.closePath();
      ctx.fill();
      if (i < 2) ctx.stroke();            // 輪郭線は胴と足だけ（凹凸が潰れないように）
      else { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore(); } // 継ぎ目を消す
    });
    // 頭とまげ
    const a = r.body.angle, up = { x: Math.sin(a), y: -Math.cos(a) };
    const hx = r.body.position.x + up.x * (C.H0 / 2 + 14), hy = r.body.position.y + up.y * (C.H0 / 2 + 14);
    ctx.beginPath(); ctx.arc(hx, hy, 14, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx + r.dir * 5, hy - 2, 3, 0, 7); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(hx + r.dir * 6, hy - 2, 1.5, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawText(t, y, size, color = '#fff') {
    ctx.textAlign = 'center'; ctx.font = `bold ${size}px ${FONT}`;
    ctx.lineWidth = size / 8; ctx.strokeStyle = '#000'; ctx.strokeText(t, W / 2, y);
    ctx.fillStyle = color; ctx.fillText(t, W / 2, y);
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    drawBackground();
    if (g) { drawRikishi(g.battle.L, '#e8c3a0'); drawRikishi(g.battle.R, '#a0b8e8'); }
    if (phase === 'naming' && me) {
      silhouette(ctx, me.env, W / 2 - 80, 230, 220, '#e8c3a0');
      drawText(me.shikona, 150, 72, '#ffcf4d');
    }
    if (phase === 'title') drawText('音波相撲', 220, 90, '#ffcf4d');
    if (phase === 'intro') drawText(phaseT < 1.2 ? `${g.enemy.shikona} 土俵入り` : 'はっけよい…', 130, 48);
    if (phase === 'fight' && phaseT < 0.8) drawText('のこった！', 130, 64, '#ff5252');
    if (g?.battle.over) {
      const k = g.battle.over.kimarite;
      drawText(k.name, 190, 110, g.battle.over.winner === 'L' ? '#ffcf4d' : '#ff5252');
      drawText(k.text, 250, 32);
    }
    for (const p of confetti) { ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 6, 6); }
    ctx.restore();
  }

  // ---- ループ ----
  function update(dt) {
    phaseT += dt;
    shake = Math.max(0, shake - dt * 40);
    for (const p of confetti) { p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.t += dt; }
    confetti = confetti.filter(p => p.t < 2.5);

    if (phase === 'naming' && phaseT > 2.4) startBout();
    else if (phase === 'intro') {
      if (phaseT > 1.2 && !g.hakkeyoi) { g.hakkeyoi = true; Sfx.clack(); }
      if (phaseT > 2.2) { phase = 'fight'; phaseT = 0; Sfx.drum(); setStatus('のこった、のこった！'); }
    } else if (phase === 'fight') {
      const b = g.battle;
      if (!b.over) {
        b.step(1);
        if (b.impact) { shake = Math.max(shake, 6); Sfx.thud(); }
        if (b.over) onDecided(b.over);
      } else {
        g.decided += dt;
        b.step(g.decided < 1.2 ? 0.25 : 1);  // 決着直後はスローモーション
        if (g.decided > 2.6) {
          setStatus(b.over.winner === 'L' ? `${b.over.kimarite.name}で勝ち！` : `${b.over.kimarite.name}で敗れる…`);
          afterBout();
        }
      }
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
    update(dt); draw(); requestAnimationFrame(frame);
  }

  $('btnRec').onclick = onRecord;
  $('btnRandom').onclick = () => { Sfx.unlock(); startCareer(C.randomSpec(Math.random, 0)); };
  const muteBtn = $('btnMute');
  const showMute = () => { muteBtn.textContent = Sfx.isMuted() ? '🔇' : '🔊'; };
  muteBtn.onclick = () => { Sfx.unlock(); Sfx.setMuted(!Sfx.isMuted()); showMute(); };
  showMute();
  $('btnShare').onclick = onShare;
  $('btnSave').onclick = onSave;
  $('btnRetry').onclick = () => {
    $('result').hidden = true; g = null; phase = 'title'; me = null; streak = 0;
    setHud(); enableButtons(); setStatus('マイクに向かって1秒、叫べ。');
  };

  setHud();
  requestAnimationFrame(frame);
})();
