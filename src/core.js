// 音波相撲: 音声解析・力士生成・バトル物理（DOM非依存）
(function (root) {
  const { Engine, Bodies, Body, Composite, Events, Vertices } = root.Matter;

  const N = 24;            // 波形の代表点数
  const W0 = 50, H0 = 90;  // 胴体の幅・高さ
  const FOOT_H = 14;       // 足（台座）の高さ
  const HALF = 300;        // 土俵の半幅（俵の位置）
  const TICK = 1000 / 60;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  // ---------- 音声解析 ----------

  // 周波数帯をGoertzel法で走査してピーク周波数を求める
  function peakFreq(x, sr) {
    const len = Math.min(2048, x.length);
    let bestI = 0, bestE = 0;
    const step = 256;
    for (let i = 0; i + len <= x.length; i += step) {
      let e = 0;
      for (let j = 0; j < len; j++) e += x[i + j] * x[i + j];
      if (e > bestE) { bestE = e; bestI = i; }
    }
    let best = 0, bestP = 0;
    for (let k = 0; k < 96; k++) {
      const f = 80 * Math.pow(3000 / 80, k / 95);
      const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w);
      let s1 = 0, s2 = 0;
      for (let j = 0; j < len; j++) {
        const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / (len - 1));
        const s0 = x[bestI + j] * win + c * s1 - s2;
        s2 = s1; s1 = s0;
      }
      const p = s1 * s1 + s2 * s2 - c * s1 * s2;
      if (p > bestP) { bestP = p; best = f; }
    }
    return best;
  }

  // 生の音声 → 力士の元データ。無音なら null
  function analyzeSamples(x, sr) {
    const seg = Math.floor(x.length / N);
    if (seg < 1) return null;
    let env = [];
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let j = 0; j < seg; j++) m = Math.max(m, Math.abs(x[i * seg + j]));
      env.push(m);
    }
    env = env.map((v, i) => (env[Math.max(0, i - 1)] + 2 * v + env[Math.min(N - 1, i + 1)]) / 4);
    const max = Math.max(...env);
    if (max < 0.01) return null;
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    const rms = Math.sqrt(sum / x.length);
    const envN = env.map(v => v / max);
    const mean = envN.reduce((a, b) => a + b, 0) / N;
    const spread = Math.sqrt(envN.reduce((a, v) => a + (v - mean) ** 2, 0) / N);
    const spec = {
      env: envN,
      loud: clamp(rms / 0.2, 0.1, 1),
      peak: peakFreq(x, sr),
      spread,
    };
    spec.shikona = makeShikona(spec, Math.random);
    return spec;
  }

  // ---------- 四股名 ----------

  // 前半: 声の「形」で決まる。真面目な力士名と、笑える名前を混ぜる
  const PRE = {
    loudLow: ['轟', '巌', '金剛', 'ドスドス', 'ずっしり', 'ゴリゴリ'],
    loudHigh: ['絶叫', '雷電', '紫電', 'キーキー', 'ぴえん', 'ギャー'],
    softLow: ['ささやき', '微風', '深海', 'こそこそ', 'ひっそり', 'ぬるぬる'],
    softHigh: ['ひそひそ', 'ちゅんちゅん', 'ふわふわ', 'ぷるぷる'],
    wild: ['乱れ', '怒涛', '渦潮', 'ぐにゃぐにゃ', '情緒不安定', 'ジェットコースター'],
    stutter: ['がやがや', 'ブルブル', 'ガタガタ', 'ビビり', 'どもり'],
    fading: ['しょんぼり', '尻すぼみ', '燃え尽き', '三日坊主'],
    late: ['寝起き', '出遅れ', 'エンジン音', '助走つき'],
    oneshot: ['一発屋', '瞬間最大', '打ち上げ花火'],
  };
  const POST = ['山', '海', '富士', '川', '丸', '錦', '龍', '嵐'];
  const POST_FUNNY = ['大福', '猫', 'うどん', 'ペンギン', 'だんご', 'もち', 'ぽん', 'ぴよ', 'カレー', 'ぬこ'];
  // まれに出る特別な名前（スクショ用）
  const RARE = ['ただのおじさん', '朝まで生ハム', '腹ペコ大関', '二度寝の達人', '猫まっしぐら', '月曜日の憂鬱', '給料日前'];

  // 声の形: 立ち上がり・尻すぼみ・山の数
  function shapeOf(env) {
    const avg = (a, b) => env.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);
    const early = avg(0, 8), late = avg(16, 24);
    let peaks = 0;
    for (let i = 1; i < env.length - 1; i++) if (env[i] > 0.6 && env[i] > env[i - 1] && env[i] >= env[i + 1]) peaks++;
    return { early, late, peaks };
  }

  function makeShikona(spec, rng) {
    if (rng() < 0.04) return pick(rng, RARE);
    const high = spec.peak > 400, loud = spec.loud > 0.45;
    const { early, late, peaks } = shapeOf(spec.env);
    const group = peaks >= 6 ? PRE.stutter
      : spec.spread > 0.3 ? PRE.wild
      : late < early * 0.5 ? PRE.fading
      : early < late * 0.5 ? PRE.late
      : peaks === 1 ? PRE.oneshot
      : loud ? (high ? PRE.loudHigh : PRE.loudLow)
      : (high ? PRE.softHigh : PRE.softLow);
    return pick(rng, group) + pick(rng, rng() < 0.3 ? POST_FUNNY : POST);
  }

  // 対戦相手（過去プレイヤーの代役）をランダム生成。連勝数が増えるほど手強くなる
  function randomSpec(rng, streak) {
    const f1 = 1 + Math.floor(rng() * 4), f2 = 5 + Math.floor(rng() * 8);
    const ph = rng() * 6, ph2 = rng() * 6;
    let env = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      env.push(Math.abs(Math.sin(t * f1 * Math.PI + ph)) * 0.7 + Math.abs(Math.sin(t * f2 * Math.PI + ph2)) * 0.3 * rng() + 0.1);
    }
    const max = Math.max(...env);
    env = env.map(v => v / max);
    const mean = env.reduce((a, b) => a + b, 0) / N;
    const spec = {
      env,
      loud: clamp(0.25 + 0.05 * streak + rng() * 0.5, 0.15, 1),
      peak: 100 + rng() * 1400,
      spread: Math.sqrt(env.reduce((a, v) => a + (v - mean) ** 2, 0) / N),
    };
    spec.shikona = makeShikona(spec, rng);
    return spec;
  }

  const weightKg = spec => Math.round(80 + spec.loud * 120);

  // ---------- 力士の肉体 ----------

  // side: 'L'（右向き・左側）/ 'R'（左向き・右側）
  function buildRikishi(spec, side, scale) {
    const dir = side === 'L' ? 1 : -1;
    const cx = -dir * 150;
    const S = (28 + 40 * clamp(spec.spread / 0.4, 0, 1)) * scale; // リーチ: 抑揚が激しいほど突起が大きい
    const frontFr = 0.15 + 0.6 * clamp(spec.peak / 1500, 0, 1);   // 高音ほどザラザラ
    const toWorld = ([lx, ly]) => ({ x: cx + dir * (lx - W0 / 2), y: ly - (H0 + FOOT_H) });
    const mk = (pts, fr) => {
      const v = pts.map(toWorld);
      const c = Vertices.centre(v);
      return Bodies.fromVertices(c.x, c.y, [v], {
        friction: fr, frictionStatic: fr * 1.5, restitution: 0, density: 0.001,
      });
    };

    const parts = [
      mk([[0, 0], [W0, 0], [W0, H0], [0, H0]], 0.3),                      // 胴
      mk([[-6, H0], [W0 + 6, H0], [W0 + 6, H0 + FOOT_H], [-6, H0 + FOOT_H]], 0.5), // 足
    ];
    for (let i = 0; i < N - 1; i++) {                                     // 前面の凹凸
      const s0 = Math.max(1.5, S * spec.env[i]), s1 = Math.max(1.5, S * spec.env[i + 1]);
      const y0 = H0 / (N - 1) * i, y1 = H0 / (N - 1) * (i + 1);
      parts.push(mk([[W0, y0], [W0 + s0, y0], [W0 + s1, y1], [W0, y1]], frontFr));
    }

    const body = Body.create({ parts, frictionAir: 0.02 });
    Body.setMass(body, 5 + 15 * spec.loud);        // 声が大きいほど重い
    Body.setInertia(body, body.inertia * 5);     // 簡単には転ばない
    return { body, side, dir, spec, mass: body.mass };
  }

  // ---------- バトル ----------

  const normAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

  // opts: { scaleL, pushL }  連勝による摩耗と疲労
  function createBattle(specL, specR, opts = {}) {
    const engine = Engine.create();
    engine.gravity.y = 1;
    const floor = Bodies.rectangle(0, 25, 3000, 50, { isStatic: true, friction: 0.6, frictionStatic: 0.8 });
    const taw = x => Bodies.circle(x, 4, 8, { isStatic: true, friction: 0.8 });
    const L = buildRikishi(specL, 'L', opts.scaleL ?? 1);
    const R = buildRikishi(specR, 'R', 1);
    Composite.add(engine.world, [floor, taw(-HALF), taw(HALF), L.body, R.body]);

    const battle = { engine, L, R, time: 0, over: null, lastContact: -9, impact: 0, contact: false };
    // 推進力: 床との摩擦(質量比例)に勝てるよう質量に比例させる。重いほど絶対値は大きい
    // 長引いたら両者の力が徐々に増して決着を促す
    const pushOf = r => (0.015 + 0.0033 * r.mass) * (r === L ? (opts.pushL ?? 1) : 1) * (1 + 0.6 * Math.max(0, battle.time - 2));

    Events.on(engine, 'collisionActive', e => {
      for (const p of e.pairs) {
        const a = p.bodyA.parent, b = p.bodyB.parent;
        if ((a === L.body && b === R.body) || (a === R.body && b === L.body)) battle.contact = true;
      }
    });
    Events.on(engine, 'collisionStart', e => {
      for (const p of e.pairs) {
        const a = p.bodyA.parent, b = p.bodyB.parent;
        if ((a === L.body && b === R.body) || (a === R.body && b === L.body)) battle.impact = 1;
      }
    });

    battle.step = function (timeScale = 1) {
      battle.contact = false; battle.impact = 0;
      if (!battle.over) {
        for (const r of [L, R]) Body.applyForce(r.body, r.body.position, { x: r.dir * pushOf(r), y: 0 });
      }
      Engine.update(engine, TICK * timeScale);
      battle.time += TICK * timeScale / 1000;
      if (battle.contact) battle.lastContact = battle.time;
      if (!battle.over) battle.over = judge(battle);
      return battle.over;
    };
    return battle;
  }

  function judge(b) {
    const { L, R } = b;
    let loser = null, how = null;
    const ang = r => normAngle(r.body.angle);
    const fallen = r => Math.abs(ang(r)) > Math.PI / 3;

    // 重心が俵を越えたら場外（体の幅が約130pxあるため、全頂点では判定が遅すぎる）
    const outL = L.body.position.x < -(HALF + 10);
    const outR = R.body.position.x > HALF + 10;
    if (outL || outR) { loser = outL ? L : R; how = 'out'; }
    else if (fallen(L) || fallen(R)) {
      loser = !fallen(R) ? L : !fallen(L) ? R : (Math.abs(ang(L)) > Math.abs(ang(R)) ? L : R);
      how = 'fall';
    } else if (b.time > 15) {
      // 膠着: より押し込まれた方の負け
      loser = L.body.position.x * L.dir < R.body.position.x * R.dir ? L : R;
      how = 'timeout';
    }
    if (!loser) return null;

    const winner = loser === L ? R : L;
    return { loser: loser.side, winner: winner.side, how, kimarite: kimarite(b, winner, loser, how) };
  }

  function kimarite(b, winner, loser, how) {
    const lean = normAngle(loser.body.angle) * loser.dir; // +: 相手側（前）へ傾く
    const wx = winner.body.position.x, lx = loser.body.position.x;
    if (how === 'out') {
      // 勝者が土俵際で、敗者が勝者の後ろ（自陣側）へ飛ばされた
      const beyond = (lx - wx) * winner.dir < 0;
      if (Math.abs(wx) > 240 && beyond) return { name: 'うっちゃり', text: '大逆転のうっちゃり！' };
      if (loser.body.bounds.max.y < -30) return { name: '吊り出し', text: '豪快な吊り出し！' };
      if (b.time - b.lastContact < 0.4 && Math.abs(lean) < Math.PI / 6) return { name: '寄り切り', text: '王道の寄り切り！' };
      return { name: '押し出し', text: '圧倒的な押し出し！' };
    }
    if (how === 'fall') {
      if (lean < 0 && Math.abs(wx - lx) < 90) return { name: '浴びせ倒し', text: '重圧の浴びせ倒し！' };
      return { name: '突き落とし', text: '鮮やかな突き落とし！' };
    }
    return { name: '押し出し', text: '圧倒的な押し出し！' };
  }

  // 摩耗: 突起を少し丸める
  function smoothEnv(env, k) {
    return env.map((v, i) => v * (1 - k) + k * (env[Math.max(0, i - 1)] + env[Math.min(N - 1, i + 1)]) / 2);
  }

  const RANKS = [[10, '横綱'], [8, '大関'], [5, '関脇'], [3, '十両'], [1, '幕下'], [0, '序ノ口']];
  const rankOf = wins => RANKS.find(([n]) => wins >= n)[1];

  root.OnpaCore = {
    N, W0, H0, FOOT_H, HALF, analyzeSamples, randomSpec, makeShikona, weightKg,
    createBattle, smoothEnv, rankOf,
  };
})(globalThis);
