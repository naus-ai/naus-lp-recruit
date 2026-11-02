// 予約の通知メールの文面を作る(外部と通信しない、文面を組み立てるだけの部品)
// 宛先は環境変数 BOOKING_NOTIFY_EMAILS。候補者(申込者)には送らない
import { BOOKING, SOURCES } from './config.mjs';
import { jstDate } from './slots.mjs';

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const MIN = 60 * 1000;

// 流入元の表示名。config.mjs の SOURCES(※メモ：LP2 など)から「※メモ：」を除いた部分を使う
// SOURCES が空欄のページ(通常版)は「通常版」と表示する
export function sourceLabel(source) {
  const memo = SOURCES[source] || '';
  return memo.replace(/^※メモ：/, '') || '通常版';
}

// UTCのミリ秒 → 日本時間の 'HH:MM'
function hhmm(ms) {
  const d = new Date(ms + BOOKING.utcOffsetMinutes * MIN);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * 通知メールの件名と本文
 * @param {object} v     入力値(last / first / email / source)
 * @param {object} slot  予約した枠(start / end はUTCのミリ秒)
 * @param {string} url   Google MeetのURL(取れなかった場合は空)
 */
export function buildNotifyMail(v, slot, url) {
  const p = jstDate(slot.start);
  const dow = DOW[p.dow];
  const label = sourceLabel(v.source);
  const subject = `【求人LP予約】${p.m}/${p.d}(${dow}) ${hhmm(slot.start)}〜 ${v.last} ${v.first} 様(${label})`;
  const text = [
    `日時: ${p.y}年${p.m}月${p.d}日(${dow}) ${hhmm(slot.start)}〜${hhmm(slot.end)}`,
    `氏名: ${v.last} ${v.first}`,
    `メールアドレス: ${v.email}`,
    `流入元: ${label}`,
    `Google Meet: ${url || 'カレンダーの予定でご確認ください'}`,
    '',
    'この通知は求人LPの予約フォームから自動送信されています',
  ].join('\n');
  return { subject, text };
}
