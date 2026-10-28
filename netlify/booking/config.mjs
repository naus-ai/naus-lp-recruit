// 面談予約の設定値(ここだけを書き換えれば、空き枠の出し方が変わる)
// 時刻はすべて日本時間(Asia/Tokyo)で考える
export const BOOKING = {
  timeZone: 'Asia/Tokyo',
  utcOffsetMinutes: 9 * 60, // 日本時間はUTC+9(夏時間なし)
  slotMinutes: 30,          // 1枠の長さ(分)
  stepMinutes: 30,          // 枠の刻み(分)
  // 平日(月〜金)の受付時間。最後の枠は end に終わる枠(=20:30〜21:00)
  weekdayHours: { start: '09:00', end: '21:00' },
  // 土日と祝日の受付時間。最後の枠は 11:30〜12:00
  offdayHours: { start: '08:00', end: '12:00' },
  weekdays: [1, 2, 3, 4, 5], // 平日として扱う曜日(0=日 1=月 … 6=土)。これ以外の曜日と祝日は offdayHours を使う
  bufferMinutes: 0,         // 既存の予定の前後に空ける時間(分)。0=空けない
  minLeadHours: 12,         // 枠の開始時刻の何時間前で締め切るか
  maxDaysAhead: 14,         // 今日から何日後の日付まで予約できるか
  // 祝日の判定に使う、Google公開の「日本の祝日」カレンダー
  holidayCalendarId: 'ja.japanese#holiday@group.v.calendar.google.com',
};

// 予定のタイトル。{last}{first} に姓・名が入る
export const TITLE = '未経験エンジニア求人紹介（30分）/naus {last} {first}様';

// ページごとの区別。予定の説明欄の末尾に付ける目印(空欄なら付けない)
export const SOURCES = {
  recruit_1: '',
  recruit_2: '※メモ：LP2',
  recruit_line: '※メモ：LINE',
};
