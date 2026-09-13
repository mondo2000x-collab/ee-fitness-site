const { getAccessToken, getValues } = require('../lib/google');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function todayRu() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return dd + '.' + mm + '.' + yyyy;
}

function sendMessage(chatId, text) {
  return fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text }),
  }).then((r) => r.json());
}

module.exports = async function handler(req, res) {
  try {
    const accessToken = await getAccessToken();

    const clients = await getValues(SHEET_ID, 'Клиенты!A2:M1000', accessToken);
    const kbzhu = await getValues(SHEET_ID, 'КБЖУ!A2:C5000', accessToken);

    const today = todayRu();
    const reportedIdsToday = new Set(
      kbzhu.filter((row) => row[2] === today).map((row) => String(row[0]))
    );

    let remindersSent = 0;

    for (const row of clients) {
      const idClient = row[0];
      const fio = row[1];
      const status = row[5];
      const chatId = row[12];

      if (!chatId) continue;
      if (status && status.trim() !== 'Активен') continue;
      if (reportedIdsToday.has(String(idClient))) continue;

      await sendMessage(
        chatId,
        'Привет! Не забудьте прислать сегодняшний отчёт по питанию:\nкбжу калории белки жиры углеводы шаги\nНапример: кбжу 1800 100 45 200 8000'
      );
      remindersSent++;
    }

    res.status(200).json({ ok: true, remindersSent: remindersSent });
  } catch (err) {
    console.log('Reminder error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
