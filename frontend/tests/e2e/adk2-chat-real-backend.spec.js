import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const chatResponseTimeout = 2 * 60 * 1000;

const prompts = {
  weather: "Якое надвор'е ў Менску",
  speakForecast: 'Агуч яго',
  speakStory: 'Прыдумай і агуч казку',
  drawStory: 'Зрабі малюнак па ёй',
  checkWord: 'Правер гэта слова ў вербум',
};

async function sendChatTurn(page, prompt) {
  const input = page.locator('#message-input');
  const previousBotMessages = await page
    .locator('.message.bot:not(#typing-indicator)')
    .count();

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
  turns.push({ prompt: prompts.weather, text: weather.text, payload: weather });
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
  turns.push({
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

  const audioMessagesBeforeStory = await page.locator('.message.bot audio').count();
  const story = await sendChatTurn(page, prompts.speakStory);
  const storyAudio = await saveBackendArtifact(
    page,
    testInfo,
    story.audio,
    'turn-03-story-audio',
  );
  turns.push({
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
  const imageArtifact = await saveBackendArtifact(
    page,
    testInfo,
    storyImage.image,
    'turn-04-story-image',
  );
  turns.push({
    prompt: prompts.drawStory,
    text: storyImage.text,
    image: imageArtifact,
    payload: storyImage,
  });
  expect(storyImage.image, 'image turn must return a real backend image artifact').toEqual(
    expect.any(String),
  );
  await expect
    .poll(async () => page.locator('.message.bot .image-message img').count(), {
      timeout: 30 * 1000,
    })
    .toBeGreaterThan(imagesBeforeStoryImage);

  const verbum = await sendChatTurn(page, prompts.checkWord);
  turns.push({ prompt: prompts.checkWord, text: verbum.text, payload: verbum });
  expect(verbum.text).toEqual(expect.any(String));
  expect(verbum.text).toMatch(/Verbum|вербум|слова/i);

  await expect(page.locator('.message.user .message-content')).toContainText([
    prompts.weather,
    prompts.speakForecast,
    prompts.speakStory,
    prompts.drawStory,
    prompts.checkWord,
  ]);
  await expect
    .poll(async () => page.locator('.message.bot:not(#typing-indicator)').count(), {
      timeout: 30 * 1000,
    })
    .toBeGreaterThan(4);

  await writeDialogueArtifacts(testInfo, turns);
});
