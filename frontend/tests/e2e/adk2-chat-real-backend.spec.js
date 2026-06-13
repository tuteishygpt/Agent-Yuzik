import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const chatResponseTimeout = 2 * 60 * 1000;

const prompts = {
  weather: "Якое надвор'е ў Менску",
  speakForecast: 'Агуч яго',
  speakStory: 'Прыдумай і агуч казку',
  drawStory: 'Зрабі малюнак па ёй',
  checkWord: 'Правер гэта слова ў вербум',
  describeFile: 'Атрымай файл і раскажы пра яго',
  readNews: 'Знайдзі і прачытай навіны пра Беларусь',
  tellJoke: 'Раскажы анекдот',
};

async function sendChatTurn(page, prompt, options = {}) {
  const input = page.locator('#message-input');
  const previousBotMessages = await page
    .locator('.message.bot:not(#typing-indicator)')
    .count();

  if (options.filePath) {
    await page.setInputFiles('#file-input', options.filePath);
  }

  await input.fill(prompt);

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/api/chat') &&
        candidate.request().method() === 'POST',
      { timeout: chatResponseTimeout },
    ),
    page.locator('#send-btn').click(),
  ]);

  const responseBody = await response.text();
  expect(response.status(), `${prompt} returned HTTP ${response.status()}: ${responseBody}`).toBe(
    200,
  );
  const payload = JSON.parse(responseBody);
  expect(
    Boolean(payload.text || payload.audio || payload.image),
    `${prompt} produced no visible chat output`,
  ).toBe(true);

  await expect(page.locator('#typing-indicator')).toHaveCount(0);
  await expect
    .poll(
      async () => page.locator('.message.bot:not(#typing-indicator)').count(),
      { timeout: 30 * 1000 },
    )
    .toBeGreaterThan(previousBotMessages);

  return payload;
}

function artifactExtension(contentType) {
  if (contentType.includes('audio/wav')) {
    return '.wav';
  }
  if (contentType.includes('image/png')) {
    return '.png';
  }
  if (contentType.includes('image/jpeg')) {
    return '.jpg';
  }
  return '.bin';
}

async function saveBackendArtifact(page, testInfo, url, label) {
  const accessToken = await page.evaluate(async () => {
    const { getSupabaseAccessToken } = await import('/src/supabase.js');
    return getSupabaseAccessToken();
  });
  const response = await page.request.get(new URL(url, page.url()).toString(), {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  expect(response.status(), `${label} artifact download returned HTTP ${response.status()}`).toBe(
    200,
  );

  const contentType = response.headers()['content-type'] || 'application/octet-stream';
  const body = await response.body();
  const filename = `${label}${artifactExtension(contentType)}`;
  const artifactPath = testInfo.outputPath(filename);

  await writeFile(artifactPath, body);
  await testInfo.attach(filename, {
    path: artifactPath,
    contentType,
  });

  return {
    label,
    url,
    path: artifactPath,
    contentType,
    sizeBytes: body.length,
  };
}

async function writeDialogueArtifacts(testInfo, turns) {
  const markdown = [
    '# ADK2 Chat E2E Dialogue',
    '',
    ...turns.flatMap((turn, index) => [
      `## Turn ${index + 1}`,
      '',
      `**User:** ${turn.prompt}`,
      '',
      turn.inputFile ? `**Input file:** ${turn.inputFile}` : '',
      '',
      `**Assistant:** ${turn.text || '(no text)'}`,
      '',
      turn.audio ? `**Audio:** ${turn.audio.path}` : '',
      turn.image ? `**Image:** ${turn.image.path}` : '',
      '',
    ]),
  ]
    .filter(Boolean)
    .join('\n');

  const markdownPath = testInfo.outputPath('adk2-chat-dialogue.md');
  const jsonPath = testInfo.outputPath('adk2-chat-dialogue.json');

  await writeFile(markdownPath, markdown, 'utf8');
  await writeFile(jsonPath, JSON.stringify(turns, null, 2), 'utf8');
  await testInfo.attach('adk2-chat-dialogue.md', {
    path: markdownPath,
    contentType: 'text/markdown',
  });
  await testInfo.attach('adk2-chat-dialogue.json', {
    path: jsonPath,
    contentType: 'application/json',
  });
}

async function recordTurn(testInfo, turns, turn) {
  turns.push(turn);
  await writeDialogueArtifacts(testInfo, turns);
}

async function waitForBackendAuth(page) {
  let lastProbe = { status: 0, body: 'not requested' };

  for (let attempt = 0; attempt < 15; attempt += 1) {
    lastProbe = await page.evaluate(async () => {
      const { getSupabaseAccessToken } = await import('/src/supabase.js');
      const accessToken = await getSupabaseAccessToken();
      const response = await fetch('/api/chat/history', {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });

      return {
        status: response.status,
        body: await response.text(),
      };
    });

    if (lastProbe.status === 200) {
      return;
    }

    await page.waitForTimeout(1000);
  }

  expect(
    lastProbe.status,
    `chat history auth readiness returned HTTP ${lastProbe.status}: ${lastProbe.body}`,
  ).toBe(200);
}

test('chat mode keeps one ADK2 conversation context across weather, TTS, story, image, and Verbum tools', async ({
  page,
}, testInfo) => {
  test.setTimeout(10 * 60 * 1000);
  const turns = [];

  const initialized = page.waitForEvent('console', (message) =>
    message.text().includes('Yuzik Frontend initialized'),
  );
  await page.goto('/');
  await initialized;
  await waitForBackendAuth(page);
  await expect(page.locator('#message-input')).toBeVisible();
  await expect(page.locator('#send-btn')).toBeVisible();

  const weather = await sendChatTurn(page, prompts.weather);
  await recordTurn(testInfo, turns, { prompt: prompts.weather, text: weather.text, payload: weather });
  expect(weather.text).toEqual(expect.any(String));
  expect(weather.text).toMatch(/Менск|Мінск|надвор|прагноз|°/i);

  const audioMessagesBeforeForecast = await page.locator('.message.bot audio').count();
  const spokenForecast = await sendChatTurn(page, prompts.speakForecast);
  const forecastAudio = await saveBackendArtifact(
    page,
    testInfo,
    spokenForecast.audio,
    'turn-02-forecast-audio',
  );
  await recordTurn(testInfo, turns, {
    prompt: prompts.speakForecast,
    text: spokenForecast.text,
    audio: forecastAudio,
    payload: spokenForecast,
  });
  expect(spokenForecast.audio, 'forecast turn must return a real backend audio artifact').toEqual(
    expect.any(String),
  );
  await expect
    .poll(async () => page.locator('.message.bot audio').count(), {
      timeout: 30 * 1000,
    })
    .toBeGreaterThan(audioMessagesBeforeForecast);

  const voiceReply = await sendChatTurn(page, '', { filePath: forecastAudio.path });
  await recordTurn(testInfo, turns, {
    prompt: '[voice upload: forecast audio]',
    inputFile: forecastAudio.path,
    text: voiceReply.text,
    payload: voiceReply,
  });
  expect(voiceReply.text).toEqual(expect.any(String));
  expect(voiceReply.text).not.toMatch(/памылк|не атрымалася|sorry|error/i);

  const audioMessagesBeforeStory = await page.locator('.message.bot audio').count();
  const story = await sendChatTurn(page, prompts.speakStory);
  const storyAudio = await saveBackendArtifact(
    page,
    testInfo,
    story.audio,
    'turn-03-story-audio',
  );
  await recordTurn(testInfo, turns, {
    prompt: prompts.speakStory,
    text: story.text,
    audio: storyAudio,
    payload: story,
  });
  expect(story.text).toEqual(expect.any(String));
  expect(story.text).toMatch(/казк|казач|казц|гістор|жыў-быў|жыў сабе|жыла-была|жыла сабе|светлячок/i);
  expect(story.audio, 'story turn must return a real backend audio artifact').toEqual(
    expect.any(String),
  );
  await expect
    .poll(async () => page.locator('.message.bot audio').count(), {
      timeout: 30 * 1000,
    })
    .toBeGreaterThan(audioMessagesBeforeStory);

  const imagesBeforeStoryImage = await page.locator('.message.bot .image-message img').count();
  const storyImage = await sendChatTurn(page, prompts.drawStory);
  expect
    .soft(storyImage.image, 'image turn must return a real backend image artifact')
    .toEqual(expect.any(String));
  const imageArtifact = storyImage.image
    ? await saveBackendArtifact(
        page,
        testInfo,
        storyImage.image,
        'turn-04-story-image',
      )
    : null;
  await recordTurn(testInfo, turns, {
    prompt: prompts.drawStory,
    text: storyImage.text,
    image: imageArtifact,
    payload: storyImage,
  });
  if (storyImage.image) {
    await expect
      .poll(async () => page.locator('.message.bot .image-message img').count(), {
        timeout: 30 * 1000,
      })
      .toBeGreaterThan(imagesBeforeStoryImage);
  }

  const verbum = await sendChatTurn(page, prompts.checkWord);
  await recordTurn(testInfo, turns, { prompt: prompts.checkWord, text: verbum.text, payload: verbum });
  expect(verbum.text).toEqual(expect.any(String));
  expect(verbum.text).toMatch(/Verbum|вербум|слова/i);
  expect
    .soft(verbum.text, 'Verbum turn should resolve "гэта слова" from the existing chat context')
    .not.toMatch(/якое менавіта|напішыце яго|напішы.*слова|удакладні/i);

  const inputFilePath = testInfo.outputPath('turn-07-input-file.txt');
  await writeFile(
    inputFilePath,
    [
      'Гэта тэставы файл для комплекснага ADK2 e2e сцэнару.',
      'У ім згадваюцца Менск, Verbum, навіны, галасавыя паведамленні і генерацыя малюнкаў.',
      'Асістэнт павінен коратка расказаць, што знаходзіцца ў файле.',
    ].join('\n'),
    'utf8',
  );
  const fileReply = await sendChatTurn(page, prompts.describeFile, { filePath: inputFilePath });
  await recordTurn(testInfo, turns, {
    prompt: prompts.describeFile,
    inputFile: inputFilePath,
    text: fileReply.text,
    payload: fileReply,
  });
  expect(fileReply.text).toEqual(expect.any(String));
  expect(fileReply.text).toMatch(/файл|ADK2|тэст|Менск|Verbum/i);

  const news = await sendChatTurn(page, prompts.readNews);
  await recordTurn(testInfo, turns, { prompt: prompts.readNews, text: news.text, payload: news });
  expect(news.text).toEqual(expect.any(String));
  expect(news.text).toMatch(/навін|Беларус|апошн|сёння|паводле/i);

  const joke = await sendChatTurn(page, prompts.tellJoke);
  await recordTurn(testInfo, turns, { prompt: prompts.tellJoke, text: joke.text, payload: joke });
  expect(joke.text).toEqual(expect.any(String));
  expect(joke.text.trim().length).toBeGreaterThan(20);

  for (const prompt of [
    prompts.weather,
    prompts.speakForecast,
    prompts.speakStory,
    prompts.drawStory,
    prompts.checkWord,
    prompts.describeFile,
    prompts.readNews,
    prompts.tellJoke,
  ]) {
    await expect(
      page.locator('.message.user .message-content').filter({ hasText: prompt }).first(),
    ).toBeVisible();
  }
  await expect
    .poll(async () => page.locator('.message.bot:not(#typing-indicator)').count(), {
      timeout: 30 * 1000,
    })
    .toBeGreaterThan(8);
});
