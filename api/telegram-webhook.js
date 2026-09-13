const { getAccessToken, getValues, appendValues, updateValues } = require('../lib/google');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const COACH_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function todayRu() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return dd + '.' + mm + '.' + yyyy;
}

function tgApi(method, payload) {
  return fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
}

function sendMessage(chatId, text) {
  return tgApi('sendMessage', { chat_id: chatId, text: text });
}

function forwardMessage(fromChatId, messageId) {
  return tgApi('forwardMessage', {
    chat_id: COACH_CHAT_ID,
    from_chat_id: fromChatId,
    message_id: messageId,
  });
}

async function findClientByChatId(chatId, accessToken) {
  const rows = await getValues(SHEET_ID, 'Клиенты!A2:M1000', accessToken);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const telegramChatId = row[12];
    if (telegramChatId && String(telegramChatId).trim() === String(chatId)) {
      return { rowIndex: i + 2, idClient: row[0], fio: row[1] };
    }
  }
  return null;
}

async function findClientByName(name, accessToken) {
  const rows = await getValues(SHEET_ID, 'Клиенты!A2:M1000', accessToken);
  const normalized = name.trim().toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fio = (row[1] || '').trim().toLowerCase();
    if (fio && (fio === normalized || fio.includes(normalized) || normalized.includes(fio))) {
      return { rowIndex: i + 2, idClient: row[0], fio: row[1] };
    }
  }
  return null;
}

async function linkChatId(rowIndex, chatId, accessToken) {
  await updateValues(SHEET_ID, 'Клиенты!M' + rowIndex, [String(chatId)], accessToken);
}

function parseNumbersAfterPrefix(text, prefixLength) {
  const rest = text.slice(prefixLength).trim();
  const parts = rest.split(/\s+/).map(Number);
  if (parts.length === 0 || parts.some((n) => isNaN(n))) return null;
  return parts;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  const update = req.body || {};
  const message = update.message;

  if (!message) {
    res.status(200).send('ok');
    return;
  }

  const chatId = message.chat.id;
  const text = (message.text || '').trim();

  try {
    const accessToken = await getAccessToken();
    let client = await findClientByChatId(chatId, accessToken);

    if (!client) {
      if (text.toLowerCase() === '/start') {
        await sendMessage(chatId, 'Здравствуйте! Напишите, пожалуйста, ваше имя и фамилию, как их записал тренер, чтобы я вас узнал.');
        res.status(200).send('ok');
        return;
      }

      const found = await findClientByName(text, accessToken);
      if (found) {
        await linkChatId(found.rowIndex, chatId, accessToken);
        await sendMessage(
          chatId,
          'Отлично, ' + found.fio + '! Вы подключены.\n\n' +
          'Как присылать отчёты:\n' +
          '«кбжу калории белки жиры углеводы шаги» — например:\nкбжу 1800 100 45 200 8000\n\n' +
          '«замер вес талия бёдра грудь» — например:\nзамер 77.1 87 101 98\n\n' +
          'Любое другое сообщение или фото — я перешлю тренеру.'
        );
      } else {
        await sendMessage(chatId, 'Не нашёл вас в базе клиентов. Проверьте, что имя написано так же, как у тренера, и попробуйте ещё раз, либо напишите тренеру напрямую.');
      }
      res.status(200).send('ok');
      return;
    }

    const lowerText = text.toLowerCase();

    if (lowerText.startsWith('кбжу')) {
      const nums = parseNumbersAfterPrefix(text, 4);
      if (nums && nums.length === 5) {
        await appendValues(
          SHEET_ID,
          'КБЖУ!A:H',
          [client.idClient, client.fio, todayRu(), nums[0], nums[1], nums[2], nums[3], nums[4]],
          accessToken
        );
        await sendMessage(chatId, 'Записал! Калории: ' + nums[0] + ', Б/Ж/У: ' + nums[1] + '/' + nums[2] + '/' + nums[3] + ', шаги: ' + nums[4] + '.');
        await sendMessage(COACH_CHAT_ID, client.fio + ' прислал(а) отчёт КБЖУ за сегодня.');
      } else {
        await sendMessage(chatId, 'Не разобрал формат. Пришлите так:\nкбжу 1800 100 45 200 8000\n(калории белки жиры углеводы шаги)');
      }
      res.status(200).send('ok');
      return;
    }

    if (lowerText.startsWith('замер')) {
      const nums = parseNumbersAfterPrefix(text, 5);
      if (nums && nums.length >= 1) {
        await appendValues(
          SHEET_ID,
          'Прогресс!A:G',
          [client.idClient, client.fio, todayRu(), nums[0], nums[1] || '', nums[2] || '', nums[3] || ''],
          accessToken
        );
        await sendMessage(chatId, 'Замеры записаны, спасибо!');
        await sendMessage(COACH_CHAT_ID, client.fio + ' прислал(а) новые замеры.');
      } else {
        await sendMessage(chatId, 'Не разобрал формат. Пришлите так:\nзамер 77.1 87 101 98\n(вес талия бёдра грудь)');
      }
      res.status(200).send('ok');
      return;
    }

    await sendMessage(COACH_CHAT_ID, 'Сообщение от ' + client.fio + ':');
    await forwardMessage(chatId, message.message_id);
    await sendMessage(chatId, 'Передал тренеру, спасибо!');

    res.status(200).send('ok');
  } catch (err) {
    console.log('Webhook error:', err.message);
    res.status(200).send('ok');
  }
};
