// 試験が子プロセスを起こす時の node の実行ファイル。
//
// 試験は scripts/run-electron-node.mjs 経由で Electron を node として動かす（better-sqlite3 の
// ABI をそろえるため）ので、試験の中の process.execPath は electron.exe になる。Electron の node 形は
// 仮想アドレスを約 3.5 TB 予約し、PC が忙しいと子の終了まで 5〜24 秒かかることがある（素の node は約 0.1 秒）。
// 時間の上限（timeout）を付けた試験が、全体実行の中でだけ ETIMEDOUT で落ちる原因になる。
// Electron の ABI が要らない子（better-sqlite3 も Electron の API も読まない）は、素の node で起こす。
// 要る子は process.execPath のまま残し、同じ行か直前の行に `// electron-abi: <理由>` を付ける
// （tests/test-child-process-node.test.mjs が印の無い使用を落とす）。
export const nodeExecPath = process.env.TASKEN_NODE_EXEC_PATH || process.execPath;
