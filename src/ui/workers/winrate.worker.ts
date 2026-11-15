// 胜率估算 Worker：主线程只发一条任务，worker 分批跑并回报进度（可随时 terminate 取消）。
import { mergeTally, simulateBatch, type SimInput, type SimOptions, type SimTally } from '../../app/winrate';

interface SimTask {
  input: SimInput;
  options: SimOptions;
  /** 每批局数（进度粒度） */
  batchSize: number;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SimTask>) => void) | null;
  postMessage: (msg: unknown) => void;
};

ctx.onmessage = (e) => {
  const { input, options, batchSize } = e.data;
  let tally: SimTally = { trials: 0, wins: [0, 0, 0, 0], undecided: 0, winTurnSum: 0, winCount: 0 };
  let done = 0;
  try {
    while (done < options.trials) {
      const n = Math.min(batchSize, options.trials - done);
      tally = mergeTally(
        tally,
        simulateBatch(input, { trials: n, horizonWall: options.horizonWall, seedStart: options.seedStart + done }),
      );
      done += n;
      ctx.postMessage({ type: 'progress', done, total: options.trials });
    }
    ctx.postMessage({ type: 'done', tally });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
