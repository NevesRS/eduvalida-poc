function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

class TxCollector {
  constructor() {
    this.txs = [];
    this.startTime = null;
    this.endTime = null;
  }

  start() {
    this.startTime = Date.now();
  }

  stop() {
    this.endTime = Date.now();
  }

  add({ gas = 0, latency, success = true, error = null }) {
    this.txs.push({ gas, latency, success, error, timestamp: Date.now() });
  }

  get total() {
    return this.txs.length;
  }

  get successCount() {
    return this.txs.filter((t) => t.success).length;
  }

  get failedCount() {
    return this.txs.filter((t) => !t.success).length;
  }

  summary() {
    const gasValues = this.txs.filter((t) => t.gas > 0).map((t) => t.gas);
    const latencyValues = this.txs.map((t) => t.latency);
    const elapsed = (this.endTime - this.startTime) / 1000;

    return {
      total: this.total,
      success: this.successCount,
      failed: this.failedCount,
      successRate: this.total > 0 ? ((this.successCount / this.total) * 100).toFixed(1) : "0.0",
      elapsed: elapsed.toFixed(2),
      throughput: elapsed > 0 ? (this.total / elapsed).toFixed(1) : "0.0",
      gas: {
        avg: gasValues.length > 0 ? Math.round(avg(gasValues)) : 0,
        min: gasValues.length > 0 ? Math.min(...gasValues) : 0,
        max: gasValues.length > 0 ? Math.max(...gasValues) : 0,
        total: gasValues.reduce((a, b) => a + b, 0),
        stddev: gasValues.length > 0 ? Math.round(stddev(gasValues)) : 0,
      },
      latency: {
        min: latencyValues.length > 0 ? Math.min(...latencyValues) : 0,
        max: latencyValues.length > 0 ? Math.max(...latencyValues) : 0,
        avg: latencyValues.length > 0 ? Math.round(avg(latencyValues)) : 0,
        p50: latencyValues.length > 0 ? percentile(latencyValues, 50) : 0,
        p95: latencyValues.length > 0 ? percentile(latencyValues, 95) : 0,
        p99: latencyValues.length > 0 ? percentile(latencyValues, 99) : 0,
        stddev: latencyValues.length > 0 ? Math.round(stddev(latencyValues)) : 0,
      },
    };
  }
}

module.exports = { TxCollector, percentile, avg, stddev };
