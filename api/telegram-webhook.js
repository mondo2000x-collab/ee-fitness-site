const { getAccessToken, getValues, appendValues, updateValues } = require('../lib/google');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const COACH_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const HELP_TEXT =
  'Что я умею:\n\n' +
  '«кбжу калории белки жиры углеводы шаги» — отчёт по питанию за сегодня\nПример: кбжу 1800 100 45 200 8000\n\n' +
  '«замер вес талия бёдра грудь» — новые замеры\nПример: замер 77.1 87 101 98\n\n' +
  'Отчёт по тренировке — каждое упражнение на новой строке, через запятую (название, подходы, повторы, вес):\n' +
  'тренировка:\nЖим лёжа, 4, 10, 60\nПриседания, 3, 12, 80\n\n' +
  'Любое другое сообщение или фото — перешлю тренеру напрямую.\n\n' +
  'В любой момент можно написать /help, чтобы увидеть эту подсказку снова.';

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
      return { rowIndex: i + 2, idClient: row[0], fio: row[1], phone: row[2] || '' };
    }
  }
  return null;
}

async function findClientByNameOrId(text, accessToken) {
  const rows = await getValues(SHEET_ID, 'Клиенты!A2:M1000', accessToken);
  const trimmed = text.trim();

  if (/^\d+$/.test(trimmed)) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (String(row[0]).trim() === trimmed) {
        return { rowIndex: i + 2, idClient: row[0], fio: row[1] };
      }
    }
    return null;
  }

  const normalized = trimmed.toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fio = (row[1] || '').trim().toLowerCase();
    if (fio && (fio === normalized || fio.includes(normalized) || normalized.includes(fio))) {
      return { rowIndex: i + 2, idClient: row[0], fio: row[1] };
    }
  }
  return null;
}

async function getNextClientId(accessToken) {
  const rows = await getValues(SHEET_ID, 'Клиенты!A2:A1000', accessToken);
  let maxId = 0;
  for (const row of rows) {
    const n = parseInt(row[0], 10);
    if (!isNaN(n) && n > maxId) maxId = n;
  }
  return maxId + 1;
}

function extractRowNumber(updatedRange) {
  const match = updatedRange.match(/![A-Z]+(\d+):/);
  return match ? parseInt(match[1], 10) : null;
}

function columnIndexToLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

async function getHeaderRow(sheetName, accessToken) {
  const rows = await getValues(SHEET_ID, sheetName + '!1:1', accessToken);
  return rows[0] || [];
}

function findHeaderIndex(headers, fragment) {
  const target = fragment.toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if ((headers[i] || '').toLowerCase().includes(target)) return i;
  }
  return -1;
}

// Находит первую строку, где колонка A (ID клиента) пустая — туда безопасно писать,
// не задевая формулы в других колонках (например ФИО (авто)).
async function findNextRowByColumnA(sheetName, accessToken) {
  const rows = await getValues(SHEET_ID, sheetName + '!A2:A5000', accessToken);
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i][0] || String(rows[i][0]).trim() === '') return i + 2;
  }
  return rows.length + 2;
}

// Пишет одно значение в ячейку, найденную по фрагменту заголовка. Никогда не трогает
// колонки, для которых фрагмент не передан (в частности — ФИО (авто)).
async function setCellByHeader(sheetName, headers, fragment, rowNumber, value, accessToken) {
  const idx = findHeaderIndex(headers, fragment);
  if (idx < 0) return false;
  const letter = columnIndexToLetter(idx);
  await updateValues(SHEET_ID, sheetName + '!' + letter + rowNumber, [value], accessToken);
  return true;
}

async function linkChatId(rowIndex, chatId, accessToken) {
  await updateValues(SHEET_ID, 'Клиенты!M' + rowIndex, [String(chatId)], accessToken);
}

async function createNewClient(name, chatId, username, accessToken) {
  const nextId = await getNextClientId(accessToken);
  const contact = username ? '@' + username : '';
  const result = await appendValues(
    SHEET_ID,
    'Клиенты!A:H',
    [nextId, name, contact, todayRu(), '', 'Активен', '', ''],
    accessToken
  );

  const updatedRange = result.data && result.data.updates && result.data.updates.updatedRange;
  const rowIndex = updatedRange ? extractRowNumber(updatedRange) : null;

  if (rowIndex) {
    await updateValues(SHEET_ID, 'Клиенты!M' + rowIndex, [String(chatId)], accessToken);
  }

  return { rowIndex: rowIndex, idClient: nextId, fio: name, phone: contact };
}

function parseNumbersAfterPrefix(text, prefixLength) {
  const rest = text.slice(prefixLength).trim();
  const parts = rest.split(/\s+/).map(Number);
  if (parts.length === 0 || parts.some((n) => isNaN(n))) return null;
  return parts;
}

function looksLikePhone(text) {
  const cleaned = text.replace(/[\s\-\(\)]/g, '');
  return /^\+?\d{7,15}$/.test(cleaned);
}

async function savePhone(rowIndex, phoneText, accessToken) {
  await updateValues(SHEET_ID, 'Клиенты!C' + rowIndex, [phoneText.trim()], accessToken);
}

async function saveKbzhuReport(client, nums, accessToken) {
  const headers = await getHeaderRow('КБЖУ', accessToken);
  const row = await findNextRowByColumnA('КБЖУ', accessToken);

  await setCellByHeader('КБЖУ', headers, 'id клиента', row, client.idClient, accessToken);
  await setCellByHeader('КБЖУ', headers, 'дата', row, todayRu(), accessToken);
  await setCellByHeader('КБЖУ', headers, 'калории факт', row, nums[0], accessToken);
  await setCellByHeader('КБЖУ', headers, 'белки факт', row, nums[1], accessToken);
  await setCellByHeader('КБЖУ', headers, 'жиры факт', row, nums[2], accessToken);
  await setCellByHeader('КБЖУ', headers, 'углеводы факт', row, nums[3], accessToken);
  await setCellByHeader('КБЖУ', headers, 'шаги факт', row, nums[4], accessToken);
}

async function saveProgressReport(client, nums, accessToken) {
  const headers = await getHeaderRow('Прогресс', accessToken);
  const row = await findNextRowByColumnA('Прогресс', accessToken);

  await setCellByHeader('Прогресс', headers, 'id клиента', row, client.idClient, accessToken);
  await setCellByHeader('Прогресс', headers, 'дата замера', row, todayRu(), accessToken);
  await setCellByHeader('Прогресс', headers, 'вес', row, nums[0], accessToken);
  if (nums[1] !== undefined) await setCellByHeader('Прогресс', headers, 'талия', row, nums[1], accessToken);
  if (nums[2] !== undefined) await setCellByHeader('Прогресс', headers, 'бёдра', row, nums[2], accessToken);
  if (nums[3] !== undefined) await setCellByHeader('Прогресс', headers, 'грудь', row, nums[3], accessToken);
}

function parseExerciseLines(rawText) {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  const exercises = [];
  const badLines = [];

  for (const line of lines) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length !== 4) {
      badLines.push(line);
      continue;
    }
    const [name, setsStr, repsStr, weightStr] = parts;
    const sets = parseInt(setsStr, 10);
    const reps = parseInt(repsStr, 10);
    const weight = parseFloat(weightStr.replace(',', '.'));
    if (!name || isNaN(sets) || isNaN(reps) || isNaN(weight)) {
      badLines.push(line);
      continue;
    }
    exercises.push({ name, sets, reps, weight });
  }

  return { exercises, badLines };
}

async function getValidExerciseNames(accessToken) {
  const headers = await getHeaderRow('Справочники', accessToken);
  const idx = findHeaderIndex(headers, 'упражнени');
  if (idx < 0) return [];
  const colLetter = columnIndexToLetter(idx);
  const rows = await getValues(SHEET_ID, 'Справочники!' + colLetter + '2:' + colLetter + '1000', accessToken);
  return rows.map((r) => (r[0] || '').trim()).filter(Boolean);
}

function matchExerciseName(rawName, validNames) {
  const normalized = rawName.trim().toLowerCase();
  for (const valid of validNames) {
    if (valid.toLowerCase() === normalized) return valid;
  }
  for (const valid of validNames) {
    const validLower = valid.toLowerCase();
    if (validLower.includes(normalized) || normalized.includes(validLower)) return valid;
  }
  return null;
}

async function saveWorkoutExercises(client, exercises, accessToken) {
  const headers = await getHeaderRow('Тренировки', accessToken);
  const validNames = await getValidExerciseNames(accessToken);
  const unmatched = [];

  for (const ex of exercises) {
    const matched = matchExerciseName(ex.name, validNames);
    if (matched) {
      ex.name = matched;
    } else {
      unmatched.push(ex.name);
    }
  }

  let row = await findNextRowByColumnA('Тренировки', accessToken);

  for (const ex of exercises) {
    await setCellByHeader('Тренировки', headers, 'id клиента', row, client.idClient, accessToken);
    await setCellByHeader('Тренировки', headers, 'дата', row, todayRu(), accessToken);
    await setCellByHeader('Тренировки', headers, 'упражнени', row, ex.name, accessToken);

    for (let s = 1; s <= 4; s++) {
      if (s <= ex.sets) {
        await setCellByHeader('Тренировки', headers, 'п' + s + ' вес', row, ex.weight, accessToken);
        await setCellByHeader('Тренировки', headers, 'п' + s + ' повтор', row, ex.reps, accessToken);
      }
    }

    await setCellByHeader('Тренировки', headers, 'статус', row, 'Выполнено', accessToken);
    row++;
  }

  return { savedCount: exercises.length, unmatched: unmatched };
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
        await sendMessage(chatId, 'Здравствуйте! Напишите, пожалуйста, ваше имя и фамилию (или ваш ID клиента, если тренер его сообщил), чтобы я вас нашёл.');
        res.status(200).send('ok');
        return;
      }

      if (!text || text.length < 2) {
        await sendMessage(chatId, 'Напишите, пожалуйста, ваше имя и фамилию текстом.');
        res.status(200).send('ok');
        return;
      }

      let found = await findClientByNameOrId(text, accessToken);
      let isNew = false;

      if (!found) {
        found = await createNewClient(text, chatId, message.from && message.from.username, accessToken);
        isNew = true;
      } else {
        await linkChatId(found.rowIndex, chatId, accessToken);
      }

      await sendMessage(
        chatId,
        (isNew ? 'Записал вас, ' : 'Отлично, ') + found.fio + '! Вы подключены.\n\n' +
        (isNew ? 'Пришлите, пожалуйста, ваш номер телефона для связи (например: +7 900 111-22-33).\n\n' : '') +
        HELP_TEXT
      );

      if (isNew) {
        await sendMessage(COACH_CHAT_ID, 'Новый клиент через бота: ' + found.fio + ' (ID ' + found.idClient + '). Заполните тариф и остальные данные в таблице.');
      }

      res.status(200).send('ok');
      return;
    }

    const lowerText = text.toLowerCase();

    if (lowerText === '/help' || lowerText === '/start') {
      await sendMessage(chatId, HELP_TEXT);
      res.status(200).send('ok');
      return;
    }

    if (!client.phone && looksLikePhone(text)) {
      await savePhone(client.rowIndex, text, accessToken);
      await sendMessage(chatId, 'Записал номер, спасибо!');
      res.status(200).send('ok');
      return;
    }

    if (lowerText.startsWith('кбжу')) {
      const nums = parseNumbersAfterPrefix(text, 4);
      if (nums && nums.length === 5) {
        await saveKbzhuReport(client, nums, accessToken);
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
        await saveProgressReport(client, nums, accessToken);
        await sendMessage(chatId, 'Замеры записаны, спасибо!');
        await sendMessage(COACH_CHAT_ID, client.fio + ' прислал(а) новые замеры.');
      } else {
        await sendMessage(chatId, 'Не разобрал формат. Пришлите так:\nзамер 77.1 87 101 98\n(вес талия бёдра грудь)');
      }
      res.status(200).send('ok');
      return;
    }

    if (lowerText.startsWith('тренировка')) {
      const rawAfterPrefix = text.slice('тренировка'.length).replace(/^[:\s]+/, '');
      const { exercises, badLines } = parseExerciseLines(rawAfterPrefix);

      if (exercises.length === 0) {
        await sendMessage(
          chatId,
          'Не разобрал формат. Пришлите так, каждое упражнение на новой строке:\n' +
          'тренировка:\nЖим лёжа, 4, 10, 60\nПриседания, 3, 12, 80\n' +
          '(название, подходы, повторы, вес)'
        );
        res.status(200).send('ok');
        return;
      }

      const result = await saveWorkoutExercises(client, exercises, accessToken);

      let reply = 'Записал ' + result.savedCount + ' упражнени' + (result.savedCount === 1 ? 'е' : 'й') + ', спасибо!';
      if (badLines.length > 0) {
        reply += '\n\nНе разобрал эти строки (проверьте формат):\n' + badLines.join('\n');
      }
      await sendMessage(chatId, reply);

      const summary = exercises.map((e) => e.name + ' ' + e.sets + 'x' + e.reps + ' ' + e.weight + 'кг').join('\n');
      let coachMessage = client.fio + ' прислал(а) отчёт по тренировке:\n' + summary;
      if (result.unmatched.length > 0) {
        coachMessage += '\n\n⚠️ Не нашёл в справочнике точное совпадение для: ' + result.unmatched.join(', ') + '. Проверьте написание в таблице.';
      }
      await sendMessage(COACH_CHAT_ID, coachMessage);

      res.status(200).send('ok');
      return;
    }

    await sendMessage(COACH_CHAT_ID, 'Сообщение от ' + client.fio + ':');
    await forwardMessage(chatId, message.message_id);
    await sendMessage(chatId, 'Передал тренеру, спасибо!');

    res.status(200).send('ok');
  } catch (err) {
    console.log('Webhook error:', err.message);
    try {
      await sendMessage(COACH_CHAT_ID, '⚠️ Ошибка в боте при обработке сообщения: ' + err.message);
    } catch (notifyErr) {
      console.log('Failed to notify coach about error:', notifyErr.message);
    }
    res.status(200).send('ok');
  }
};
