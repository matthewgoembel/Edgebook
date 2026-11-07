import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDuration, parseTopstepCsv, rootSymbol } from './csv.ts';
import { dailyStats, mergeCopies, netRoi, outcome, summarize, tradeOutcome, type TradeRow } from './metrics.ts';
import { toPositions } from './analysis.ts';

const CSV = `Id,ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type,TradeDay,TradeDuration,Commissions
1001,MNQZ6,03/03/2025 09:36:34 -05:00,03/03/2025 09:37:33 -05:00,18713.000000000,18677.500000000,1.4400,-142.000000000,2,Long,03/03/2025 00:00:00 -06:00,00:00:58.3780310,1.0000
1002,MNQZ6,03/03/2025 09:36:34 -05:00,03/03/2025 09:37:33 -05:00,18713.250000000,18677.500000000,2.1600,-214.500000000,3,Long,03/03/2025 00:00:00 -06:00,00:00:58.3780310,1.5000
1003,MNQZ6,03/03/2025 09:46:07 -05:00,03/03/2025 09:48:01 -05:00,18718.000000000,18741.750000000,3.6000,-237.500000000,5,Short,03/03/2025 00:00:00 -06:00,00:01:53.6051590,2.5000
1004,MNQZ6,03/03/2025 09:48:33 -05:00,03/03/2025 10:12:13 -05:00,18717.250000000,18744.500000000,0.7200,-54.500000000,1,Short,03/03/2025 00:00:00 -06:00,00:23:39.8532780,0.5000
1005,MNQZ6,03/03/2025 09:48:33 -05:00,03/03/2025 10:12:13 -05:00,18717.000000000,18744.500000000,2.8800,-220.000000000,4,Short,03/03/2025 00:00:00 -06:00,00:23:39.8532780,2.0000
1006,NQZ6,03/03/2025 10:22:43 -05:00,03/03/2025 10:24:04 -05:00,18837.750000000,18837.500000000,2.7800,5.000000000,1,Short,03/03/2025 00:00:00 -06:00,00:01:20.6063100,1.0000
1007,NQZ6,03/03/2025 10:25:10 -05:00,03/03/2025 10:26:45 -05:00,18861.000000000,18861.250000000,2.7800,-5.000000000,1,Short,03/03/2025 00:00:00 -06:00,00:01:34.8266240,1.0000
1008,NQZ6,03/03/2025 10:28:01 -05:00,03/03/2025 10:32:36 -05:00,18884.000000000,18835.250000000,2.7800,975.000000000,1,Short,03/03/2025 00:00:00 -06:00,00:04:35.2606170,1.0000
`;

// Evening trades, which fall on the next Topstep trade day.
const EVENING = `9000000001,MNQZ6,03/03/2025 20:09:13 -05:00,03/03/2025 20:15:00 -05:00,18224.000000000,18204.250000000,0.7200,-39.500000000,1,Long,03/04/2025 00:00:00 -06:00,00:05:47.0000000,0.5000
1009,MNQZ6,03/03/2025 20:09:13 -05:00,03/03/2025 20:15:00 -05:00,18223.750000000,18204.250000000,2.1600,-116.500000000,3,Long,03/04/2025 00:00:00 -06:00,00:05:47.0000000,1.5000
1010,MNQZ6,03/03/2025 20:09:13 -05:00,03/03/2025 20:15:00 -05:00,18223.250000000,18204.250000000,0.7200,-38.000000000,1,Long,03/04/2025 00:00:00 -06:00,00:05:47.0000000,0.5000
1011,NQZ6,03/03/2025 20:23:28 -05:00,03/03/2025 20:25:00 -05:00,18225.500000000,18225.750000000,2.7800,5.000000000,1,Long,03/04/2025 00:00:00 -06:00,00:01:32.0000000,1.0000
`;

const rows = (text: string) =>
  parseTopstepCsv(text, 'America/New_York').map((t, i) => ({ ...t, id: i + 1, account_id: 1, import_id: 1, strategy_id: null, risk_amount: null, rating: null })) as TradeRow[];

test('net P&L = PnL - Fees - Commissions', () => {
  const t = rows(CSV);
  assert.equal(t[7].net_pnl, 971.22);
  assert.equal(t[5].net_pnl, 1.22);
  assert.equal(t[6].net_pnl, -8.78);
});

test('reproduces a full day summary', () => {
  const s = summarize(rows(CSV + EVENING), 75);
  assert.equal(s.count, 12);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 5);
  assert.equal(s.breakevens, 6);
  assert.equal(s.gross.toFixed(2), '-82.50');
  assert.equal(s.costs.toFixed(2), '39.52');
  assert.equal(s.net.toFixed(2), '-122.02');
  assert.equal(s.winRate.toFixed(2), '16.67');
  assert.equal(s.profitFactor.toFixed(2), '1.02');
  assert.equal(s.volume, 24);
});

test('evening trades stay on the calendar date but remember the Topstep trade day', () => {
  const t = rows(['Id,ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type,TradeDay,TradeDuration,Commissions', EVENING].join(String.fromCharCode(10)));
  assert.equal(t[0].date, '2025-03-03');
  assert.equal(t[0].session_date, '2025-03-04');
  assert.equal(t[0].open_time, '20:09:13');
  assert.equal(dailyStats(rows(CSV + EVENING), 75).length, 1);
});

test('Net ROI matches', () => {
  const t = rows(CSV);
  assert.equal(netRoi(t[7]).toFixed(2), '0.26');
  assert.equal(netRoi(t[6]).toFixed(2), '-0.00');
});

test('break-even band', () => {
  assert.equal(outcome(1.22, 75), 'be');
  assert.equal(outcome(-55.72, 75), 'be');
  assert.equal(outcome(-85.72, 75), 'loss');
  assert.equal(outcome(971.22, 75), 'win');
});

test('partial fills merge into positions', () => {
  const p = toPositions(rows(CSV + EVENING), 75);
  assert.equal(p.length, 8);
  assert.equal(p[0].qty, 5);
  assert.equal(p[0].net.toFixed(2), '-362.60');
  assert.equal(p[0].outcome, 'loss');
  assert.equal(p[2].seq, 3);
  assert.equal(p[2].prev, 'loss');
});

test('symbols and durations', () => {
  assert.equal(rootSymbol('MNQZ6'), 'MNQ');
  assert.equal(rootSymbol('NQZ26'), 'NQ');
  assert.equal(rootSymbol('MESH7'), 'MES');
  assert.equal(parseDuration('00:23:39.8532780').toFixed(2), '1419.85');
  assert.equal(parseDuration('1.02:00:00.0'), 93600);
});

const T0 = Date.parse('2025-03-03T15:00:00Z');
let nextId = 1;
const fill = (account_id: number, over: Partial<TradeRow> = {}) =>
  ({
    id: nextId++,
    account_id,
    date: '2025-03-03',
    symbol: 'NQ',
    side: 'Long',
    qty: 1,
    entry_price: 20000,
    exit_price: 20010,
    entered_ts: T0,
    exited_ts: T0 + 60000,
    gross_pnl: 200,
    fees: 2,
    commissions: 2,
    net_pnl: 196,
    duration_sec: 60,
    risk_amount: null,
    strategy_id: null,
    ...over,
  }) as TradeRow;

test('five accounts taking one trade become one trade with combined P&L', () => {
  const merged = mergeCopies([1, 2, 3, 4, 5].map((a) => fill(a, { entered_ts: T0 + a * 400, exited_ts: T0 + 60000 + a * 300, entry_price: 20000 + a * 0.25 })));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].copies, 5);
  assert.equal(merged[0].net_pnl, 980);
  assert.equal(merged[0].qty, 5);
  assert.equal(merged[0].member_ids!.length, 5);
  const s = summarize(merged, 75);
  assert.equal(s.count, 1);
  assert.equal(s.wins, 1);
  assert.equal(s.net, 980);
  assert.equal(s.volume, 5);
});

test('a trade only one account took stays its own trade', () => {
  const merged = mergeCopies([fill(1), fill(2), fill(3), fill(2, { entered_ts: T0 + 600000, exited_ts: T0 + 660000, net_pnl: -300 })]);
  assert.deepEqual(merged.map((t) => [t.copies ?? 1, t.net_pnl]), [[3, 588], [1, -300]]);
});

test('accounts can split the same trade into different partial fills', () => {
  const merged = mergeCopies([
    fill(1, { qty: 5, net_pnl: 980 }),
    fill(2, { qty: 2, net_pnl: 392 }),
    fill(2, { qty: 3, net_pnl: 588, entered_ts: T0 + 1000 }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].copies, 2);
  assert.equal(merged[0].qty, 10);
  assert.equal(merged[0].net_pnl, 1960);
});

test('a copied NQ trade matches its MNQ copy', () => {
  assert.equal(mergeCopies([fill(1), fill(2, { symbol: 'MNQ', net_pnl: 19 })]).length, 1);
});

test('different trades are never merged', () => {
  const cases: Partial<TradeRow>[] = [
    { side: 'Short' },
    { symbol: 'ES' },
    { entered_ts: T0 + 30000 },
    { exited_ts: T0 + 120000 },
    { entry_price: 20100 },
    { date: '2025-03-04' },
  ];
  for (const change of cases) assert.equal(mergeCopies([fill(1), fill(2, change)]).length, 2, JSON.stringify(change));
});

test('one account never merges with itself', () => {
  assert.equal(mergeCopies([fill(1), fill(2, { entered_ts: T0 + 120000, exited_ts: T0 + 180000 }), fill(1, { entered_ts: T0 + 120000, exited_ts: T0 + 180000 })]).length, 2);
  const same = [fill(1), fill(1, { id: 999, side: 'Short' })];
  assert.equal(mergeCopies(same).length, 2);
});

test('the break-even band is per account, so small copied wins stay break-even', () => {
  const [t] = mergeCopies([1, 2, 3, 4, 5].map((a) => fill(a, { net_pnl: 40 })));
  assert.equal(t.net_pnl, 200);
  assert.equal(tradeOutcome(t, 75), 'be');
});

test('planned risk scales with the combined size', () => {
  const [t] = mergeCopies([fill(1, { risk_amount: 500 }), fill(2)]);
  assert.equal(t.risk_amount, 1000);
});
