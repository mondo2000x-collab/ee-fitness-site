module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    res.status(500).json({ ok: false, error: 'Server is not configured' });
    return;
  }

  const body = req.body || {};
  const name = body.name;
  const contact = body.contact;
  const goal = body.goal;

  if (!name || !contact) {
    res.status(400).json({ ok: false, error: 'Missing required fields' });
    return;
  }

  const text =
    'Новая заявка с сайта E&E Fitness\n' +
    'Имя: ' + name + '\n' +
    'Контакт: ' + contact + '\n' +
    'Цель/комментарий: ' + (goal || '—');

  try {
    const tgResponse = await fetch(
      'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT_ID, text: text }),
      }
    );

    const tgData = await tgResponse.json();

    if (!tgData.ok) {
      res.status(502).json({ ok: false, error: 'Telegram API error' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Unexpected error' });
  }
};
