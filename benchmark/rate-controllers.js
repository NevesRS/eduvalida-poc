function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FixedRateController {
  constructor(opts) {
    this.tps = opts.tps || 10;
    this.interval = 1000 / this.tps;
  }

  async wait(txIndex, startTime) {
    const expected = txIndex * this.interval;
    const elapsed = Date.now() - startTime;
    const waitMs = expected - elapsed;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
}

class MaximumRateController {
  constructor() {}

  async wait() {
    // No delay — send as fast as possible
  }
}

class LinearRateController {
  constructor(opts) {
    this.startingTps = opts.startingTps || 10;
    this.finishingTps = opts.finishingTps || 100;
    this.totalDuration = opts.durationMs || 15000;
  }

  async wait(txIndex, startTime, totalTx) {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / this.totalDuration, 1);
    const currentTps = this.startingTps + (this.finishingTps - this.startingTps) * progress;
    const interval = 1000 / currentTps;
    const expected = txIndex * interval;
    const waitMs = expected - elapsed;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
}

function createRateController(config) {
  switch (config.type) {
    case "fixed-rate":
      return new FixedRateController(config.opts || {});
    case "maximum-rate":
      return new MaximumRateController();
    case "linear-rate":
      return new LinearRateController(config.opts || {});
    default:
      console.warn(`Unknown rate controller '${config.type}', falling back to fixed-rate`);
      return new FixedRateController({ tps: 10 });
  }
}

module.exports = { createRateController, FixedRateController, MaximumRateController, LinearRateController };
