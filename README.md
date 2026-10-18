# 音波相撲

マイクに2秒叫ぶと、その波形が力士の肉体（凹凸のある剛体）になる。過去の力士と押し合う連勝サバイバル。

- 遊び方: `index.html` をブラウザで開く（マイクは `localhost` / `https` / `file://` で許可が必要）
- 物理: Matter.js 0.19.0（`vendor/` に同梱、MIT）
- `src/core.js` 音声解析・力士生成・バトル判定 / `src/main.js` 画面と進行
- 対戦相手: 過去の自分の力士（localStorage）と、ランダム生成の力士。サーバー保存は未実装

## プライバシー
マイクの音声はブラウザの中だけで処理され、サーバーには送信・保存されません。保存されるのは、力士の形（24個の数値）・四股名・連勝数だけで、あなたの端末の localStorage にのみ残ります。

## 検証（ヘッドレス）
- `test/sim.html`: 60番の対戦を自動で回し、決着率・決まり手・所要時間を表示（物理パラメータ調整用）
  `msedge --headless --allow-file-access-from-files --virtual-time-budget=60000 --dump-dom test/sim.html`
- `test/e2e.html`: ランダム力士で自動開始する画面確認用ページ（スクリーンショット用）
