'use strict';

const { geminiModel } = require('../config');

function extractFirstJsonObject(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

function logTokenUsage(pool, endpoint, usageMetadata) {
  if (!usageMetadata) return;

  pool.query(
    'INSERT INTO token_usage (endpoint, prompt_tokens, output_tokens, total_tokens) VALUES ($1,$2,$3,$4)',
    [
      endpoint,
      usageMetadata.promptTokenCount ?? 0,
      usageMetadata.candidatesTokenCount ?? 0,
      usageMetadata.totalTokenCount ?? 0,
    ]
  ).catch(error => console.error('[TOKEN_LOG]', error.message));
}

async function postGeminiRequest(body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`;
    throw Object.assign(new Error(`Gemini: ${message}`), {
      geminiError: true,
      httpStatus: response.status,
    });
  }

  return data;
}

function createGeminiClient(pool) {
  async function callGemini(userText, {
    maxOutputTokens = 512,
    temperature = 0.2,
    systemPrompt = null,
    history = [],
    endpoint = 'unknown',
  } = {}) {
    const body = {
      contents: [...history, { role: 'user', parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens, temperature },
    };

    if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

    const data = await postGeminiRequest(body);
    logTokenUsage(pool, endpoint, data?.usageMetadata);

    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  async function callGeminiJSON(userText, options = {}) {
    const text = await callGemini(userText, options);
    const parsed = extractFirstJsonObject(text);
    if (!parsed) throw new Error(`Gemini returned no JSON. Got: ${text.slice(0, 120)}`);
    return parsed;
  }

  async function callGeminiVision(textPrompt, imageBase64, options = {}) {
    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: textPrompt },
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
        ],
      }],
      generationConfig: {
        maxOutputTokens: options.maxOutputTokens || 600,
        temperature: options.temperature || 0.2,
      },
    };

    const data = await postGeminiRequest(body);
    logTokenUsage(pool, options.endpoint || 'plant-vision', data?.usageMetadata);

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = extractFirstJsonObject(text);
    if (!parsed) throw new Error(`Gemini Vision returned no JSON. Got: ${text.slice(0, 200)}`);
    return parsed;
  }

  return { callGemini, callGeminiJSON, callGeminiVision };
}

module.exports = { createGeminiClient, extractFirstJsonObject };
