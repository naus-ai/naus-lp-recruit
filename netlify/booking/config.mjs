// 面談予約の設定値(ここだけを書き換えれば、空き枠の出し方が変わる)
// 時刻はすべて日本時間(Asia/Tokyo)で考える
export const BOOKING = {
  timeZone: 'Asia/Tokyo',
  utcOffsetMinutes: 9 * 60, // 日本時間はUTC+9(夏時間なし)
  slotMinutes: 30,          // 1枠の長さ(分)
  stepMinutes: 30,          // 枠の刻み(分)
  dayStart: '09:00',        // 受付開始(最初の枠の開始時刻)
  dayEnd: '20:00',          // 受付終了(最後の枠はこの時刻に終わる=19:30〜20:00)
  weekdays: [1, 2, 3, 4, 5], // 受付する曜日(0=日 1=月 … 6=土)。祝日は別途除外
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
