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
          [client.idClient, client.fio, todayRu(), nums[0], nums[1]  '', nums[2]  '', nums[3] || ''],
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
