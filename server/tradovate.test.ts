import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateCosts, detectFormat, isTradingCost, parseTradovateCash, parseTradovateOrders } from './tradovate.ts';

const TZ = 'America/New_York';
const HEADER =
  'orderId,Account,Order ID,B/S,Contract,Product,Product Description,avgPrice,filledQty,Fill Time,lastCommandId,Status,_priceFormat,_priceFormatType,_tickSize,spreadDefinitionId,Version ID,Timestamp,Date,Quantity,Text,Type,Limit Price,Stop Price,decimalLimit,decimalStop,Filled Qty,Avg Fill Price,decimalFillAvg,Venue,Notional Value,Currency';

// Fictional orders in the shape of a real Tradovate export.
function order(id: number, side: string, avg: string, qty: string, fill: string, placed: string, status: string, type: string, stop = '') {
  const notional = qty ? `"${(Number(avg) * Number(qty) * 2).toLocaleString('en-US', { minimumFractionDigits: 2 })}"` : '';
  return `${id},DEMO1,${id}, ${side},MNQH5,MNQ,Micro E-mini NASDAQ-100,${avg},${qty},${fill},${id}, ${status},-2,0,0.25,,${id},${placed},3/3/25,10,, ${type},,${stop},,,${qty},${avg},${avg},,${notional},USD`;
}

const ORDERS = [
  HEADER,
  order(1, 'Sell', '20000.25', '20', '03/03/2025 09:51:04', '03/03/2025 09:51:04', 'Filled', 'Market'),
  order(2, 'Buy', '19962.50', '15', '03/03/2025 09:54:07', '03/03/2025 09:51:44', 'Filled', 'Limit'),
  order(3, 'Buy', '19966.50', '5', '03/03/2025 09:54:22', '03/03/2025 09:54:22', 'Filled', 'Market'),
  order(4, 'Sell', '20100.00', '10', '03/03/2025 10:30:10', '03/03/2025 10:29:30', 'Filled', 'Limit'),
  order(5, 'Buy', '20045.25', '10', '03/03/2025 10:31:04', '03/03/2025 10:30:37', 'Filled', 'Limit'),
  order(6, 'Buy', '', '', '', '03/03/2025 10:30:52', 'Canceled', 'Stop', '20142.25'),
].join('\n');

const CASH = `Account,Transaction ID,Timestamp,Date,Delta,Amount,Cash Change Type,Currency,Contract
DEMO1,100,03/03/2025 09:48:42,2025-03-03,"50,000.00","50,000.00", Fund Transaction,USD,
DEMO1,101,03/03/2025 09:51:04,2025-03-03,-10.00,"49,990.00", Commission,USD,MNQH5
DEMO1,102,03/03/2025 09:54:07,2025-03-03,-7.50,"49,982.50", Commission,USD,MNQH5
DEMO1,103,03/03/2025 09:54:07,2025-03-03,"1,132.50","51,115.00", Trade Paired,USD,MNQH5
DEMO1,104,03/03/2025 09:54:22,2025-03-03,-2.50,"51,112.50", Commission,USD,MNQH5
DEMO1,105,03/03/2025 09:54:22,2025-03-03,337.50,"51,450.00", Trade Paired,USD,MNQH5
DEMO1,106,03/03/2025 10:30:10,2025-03-03,-5.00,"51,445.00", Commission,USD,MNQH5
DEMO1,107,03/03/2025 10:31:04,2025-03-03,-5.00,"51,440.00", Commission,USD,MNQH5
DEMO1,108,03/03/2025 10:31:04,2025-03-03,"1,095.00","52,535.00", Trade Paired,USD,MNQH5`;

test('recognizes each export by its columns', () => {
  assert.equal(detectFormat(ORDERS), 'tradovate-orders');
  assert.equal(detectFormat(CASH), 'tradovate-cash');
  assert.equal(detectFormat('Id,ContractName,EnteredAt,ExitedAt'), 'topstep');
  assert.equal(detectFormat('Fill ID,Order ID,B/S,Quantity,Price'), 'tradovate-other');
  assert.equal(detectFormat('name,email'), 'unknown');
});

test('pairs one entry with two exits into two rows, matching Trade Paired', () => {
  const { trades, unmatched } = parseTradovateOrders(ORDERS, TZ);
  assert.equal(unmatched, 0);
  assert.deepEqual(trades.map((t) => [t.side, t.qty, t.gross_pnl]), [['Short', 15, 1132.5], ['Short', 5, 337.5], ['Short', 10, 1095]]);
  assert.equal(trades[0].external_id, 'tv:1:2');
  assert.equal(trades[0].symbol, 'MNQ');
  assert.equal(trades[0].open_time, '09:51:04');
  assert.equal(trades[0].duration_sec, 183);
  assert.equal(trades[0].entry_type, 'Market');
  assert.equal(trades[0].exit_type, 'Limit');
});

test('reads the canceled stop as planned risk', () => {
  const { trades } = parseTradovateOrders(ORDERS, TZ);
  assert.equal(trades[2].stop_price, 20142.25);
  assert.equal(trades[2].risk_amount, 845);
  assert.equal(trades[0].risk_amount, null);
});

test('a reversal closes the old position and opens a new one', () => {
  const text = [
    HEADER,
    order(1, 'Buy', '20000.00', '2', '03/03/2025 10:00:00', '03/03/2025 10:00:00', 'Filled', 'Market'),
    order(2, 'Sell', '20010.00', '5', '03/03/2025 10:01:00', '03/03/2025 10:01:00', 'Filled', 'Market'),
    order(3, 'Buy', '20005.00', '3', '03/03/2025 10:02:00', '03/03/2025 10:02:00', 'Filled', 'Market'),
  ].join('\n');
  const { trades, unmatched } = parseTradovateOrders(text, TZ);
  assert.equal(unmatched, 0);
  assert.deepEqual(trades.map((t) => [t.side, t.qty, t.gross_pnl]), [['Long', 2, 40], ['Short', 3, 30]]);
});

test('counts partial fills on canceled orders and flags open positions', () => {
  const text = [
    HEADER,
    order(1, 'Buy', '20000.00', '3', '03/03/2025 10:00:00', '03/03/2025 10:00:00', 'Canceled', 'Limit'),
    order(2, 'Sell', '20010.00', '1', '03/03/2025 10:01:00', '03/03/2025 10:01:00', 'Filled', 'Market'),
  ].join('\n');
  const { trades, unmatched } = parseTradovateOrders(text, TZ);
  assert.equal(trades[0].qty, 1);
  assert.equal(unmatched, 2);
});

test('Cash History commissions land on the right trades and net to the cent', () => {
  const { trades } = parseTradovateOrders(ORDERS, TZ);
  const cash = parseTradovateCash(CASH, TZ);
  assert.equal(cash[0].type, 'Fund Transaction');
  assert.equal(cash[0].amount, 50000);
  const rows = trades.map((t, id) => ({ ...t, id }));
  const { costs, unmatched } = allocateCosts(rows, cash.filter(isTradingCost));
  assert.equal(unmatched, 0);
  assert.deepEqual(rows.map((t) => costs.get(t.id)), [15, 5, 10]);
  assert.deepEqual(rows.map((t) => t.gross_pnl - costs.get(t.id)!), [1117.5, 332.5, 1085]);
});
