// Googleとの通信(認証・空き状況・祝日・予定の作成・予約の通知メール)
// 認証情報はNetlifyの環境変数から読む。コードには一切書かない
import { BOOKING } from './config.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

export class GoogleError extends Error {
  constructor(message, status, reason = '') {
    super(message);
    this.status = status;
    this.reason = reason; // Googleが返したエラー名(invalid_grant / notFound など。秘密の値は含まない)
  }
}

// エラー名だけを取り出す。英字と記号の短い名前だけを通し、それ以外(説明文・IDなど)はログに出さない
function safeName(v) {
  return typeof v === 'string' && /^[A-Za-z_.]{1,60}$/.test(v) ? v : '';
}

// Googleのエラー応答から、エラー名と理由だけを取り出す
async function errorReason(res) {
  try {
    const b = await res.json();
    if (typeof b.error === 'string') return safeName(b.error); // 合鍵の確認: invalid_grant / invalid_client など
    const e = b.error || {};
    const reasons = (e.errors || []).map((x) => safeName(x.reason)).filter(Boolean);
    return [safeName(e.status)].concat(reasons).filter(Boolean).join(',') || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function readEnv(env = process.env) {
  return {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: env.GOOGLE_REFRESH_TOKEN || '',
    calendarId: env.BOOKING_CALENDAR_ID || '',
    notifyEmails: parseEmails(env.BOOKING_NOTIFY_EMAILS),
  };
}

// 予約の通知メールを送るアドレス(環境変数 BOOKING_NOTIFY_EMAILS。カンマ区切りで複数可)
// 形式が正しくないものは無視する。未設定・空なら通知メールは送らない
const EMAIL = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[^\s@<>()"',;:\\]{2,}$/;

export function parseEmails(v) {
  if (typeof v !== 'string') return [];
  const out = [];
  for (const raw of v.split(',')) {
    const s = raw.trim();
    if (s.length > 254 || !EMAIL.test(s)) continue;
    if (out.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
  }
  return out;
}

export function hasCredentials(e) {
  return Boolean(e.clientId && e.clientSecret && e.refreshToken && e.calendarId);
}

// アクセストークンは1時間ほど有効。同じ実行環境の中では使い回す
let cached = { token: '', exp: 0 };

async function accessToken(e) {
  if (cached.token && Date.now() < cached.exp - 60 * 1000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: e.clientId,
      client_secret: e.clientSecret,
      refresh_token: e.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new GoogleError('token', res.status, await errorReason(res));
  const data = await res.json();
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

async function call(e, path, { method = 'GET', query, body } = {}) {
  const token = await accessToken(e);
  const url = new URL(API + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new GoogleError(`${method} ${path.split('/')[1]}`, res.status, await errorReason(res));
  return res.json();
}

// 担当者カレンダーの埋まっている時間帯
export async function getBusy(e, startMs, endMs) {
  const data = await call(e, '/freeBusy', {
    method: 'POST',
    body: {
      timeMin: new Date(startMs).toISOString(),
      timeMax: new Date(endMs).toISOString(),
      timeZone: BOOKING.timeZone,
      items: [{ id: e.calendarId }],
    },
  });
  const cal = data.calendars && data.calendars[e.calendarId];
  if (!cal) throw new GoogleError('freeBusy calendar', 502, 'calendar_missing_in_response');
  if (cal.errors && cal.errors.length) {
    throw new GoogleError('freeBusy calendar', 502, cal.errors.map((x) => safeName(x.reason)).filter(Boolean).join(',') || 'unknown');
  }
  return (cal.busy || []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
}

// Googleの「日本の祝日」カレンダーの予定が、国民の祝日(振替休日を含む)かどうか
// 説明欄の1行目が「祝日」なら祝日、「祭日」なら記念日(七五三・クリスマス・節分など)。
// 記念日の説明欄の2行目には「…[日本の祝日] に移動してください」と「祝日」の文字が入るため、1行目だけで判定する。
// 説明欄が無い場合は、予約を誤って受けないよう祝日として扱う
export function isPublicHoliday(ev) {
  const d = (ev && ev.description) || '';
  if (!d.trim()) return true;
  return d.split(/\r?\n|\\n/)[0].trim() === '祝日';
}

// 期間内の祝日('YYYY-MM-DD'の集合)
export async function getHolidays(e, startMs, endMs) {
  const data = await call(e, `/calendars/${encodeURIComponent(BOOKING.holidayCalendarId)}/events`, {
    query: {
      timeMin: new Date(startMs).toISOString(),
      timeMax: new Date(endMs).toISOString(),
      singleEvents: 'true',
      maxResults: 100,
    },
  });
  const set = new Set();
  for (const ev of data.items || []) {
    if (isPublicHoliday(ev) && ev.start && ev.start.date) set.add(ev.start.date);
  }
  return set;
}

// 指定した時間帯に入っている予定(キャンセル済み・「空き時間」扱いの予定は除く)
export async function listEvents(e, startMs, endMs) {
  const data = await call(e, `/calendars/${encodeURIComponent(e.calendarId)}/events`, {
    query: {
      timeMin: new Date(startMs).toISOString(),
      timeMax: new Date(endMs).toISOString(),
      singleEvents: 'true',
      maxResults: 50,
    },
  });
  return (data.items || []).filter((ev) => ev.status !== 'cancelled' && ev.transparency !== 'transparent');
}

// 予定を作る(Google Meetを自動発行し、参加者に招待メールを送る)
export async function insertEvent(e, event) {
  return call(e, `/calendars/${encodeURIComponent(e.calendarId)}/events`, {
    method: 'POST',
    query: { conferenceDataVersion: 1, sendUpdates: 'all' },
    body: event,
  });
}

export async function getEvent(e, id) {
  return call(e, `/calendars/${encodeURIComponent(e.calendarId)}/events/${encodeURIComponent(id)}`);
}

export async function deleteEvent(e, id) {
  return call(e, `/calendars/${encodeURIComponent(e.calendarId)}/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    query: { sendUpdates: 'all' },
  });
}

// 予定に付いたMeetのURL
export function meetUrl(ev) {
  if (!ev) return '';
  if (ev.hangoutLink) return ev.hangoutLink;
  const ep = ev.conferenceData && (ev.conferenceData.entryPoints || []).find((p) => p.entryPointType === 'video');
  return ep ? ep.uri : '';
}

// ---- 予約の通知メール(Gmail API。予約を受けるアカウント自身から送る) ----
// 合鍵(GOOGLE_REFRESH_TOKEN)に gmail.send の許可が含まれていないと、Googleが403を返して送れない
const GMAIL_SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

// 日本語の件名を、メールの決まりに沿った形(=?UTF-8?B?…?=)に変換する
// 1かたまりが長くなりすぎないよう、文字の途中で切らずに区切って並べる
function encodeSubject(s) {
  const words = [];
  let chunk = '';
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

// 送信するメールの中身(宛先・件名・本文)を、Gmail APIに渡す形に組み立てる
export function buildRawMail({ to, subject, text }) {
  const body = Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const mime = [
    `To: ${to.join(', ')}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

// メールを送る。timeoutMs を過ぎたら打ち切ってエラーにする
export async function sendMail(e, mail, timeoutMs = 4000) {
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new GoogleError('gmail send', 504, 'timeout'));
    }, timeoutMs);
  });
  const run = (async () => {
    const token = await accessToken(e);
    const res = await fetch(GMAIL_SEND, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: buildRawMail(mail) }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new GoogleError('gmail send', res.status, await errorReason(res));
    return true;
  })();
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
    run.catch(() => {}); // 打ち切った後に届いたエラーは無視する
  }
}
