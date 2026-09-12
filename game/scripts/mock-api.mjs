import http from "node:http";

const headers = {
  "Access-Control-Allow-Origin": "http://localhost:5173",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function reply(response, status, payload) {
  response.writeHead(status, headers);
  response.end(JSON.stringify(payload));
}

function replyAudio(response, buffer) {
  response.writeHead(200, {
    ...headers,
    "Content-Type": "audio/wav",
    "X-Speech-Model": "mock",
    "X-Speech-Voice": "mock",
    "X-Speech-Latency-Ms": "0",
  });
  response.end(buffer);
}

function buildSilentWav(durationSeconds = 0.4, sampleRate = 24000) {
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const dataSize = sampleCount * 2; // 16-bit mono PCM
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

const MOCK_TRANSCRIPT =
  "Hello, I would like to practice my English here, please.";

const earnedWords = new Map(); // key: `${location}:${concept}` -> Set<word lowercased>

function keyFor(location, concept) {
  return `${location}:${concept}`;
}

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS") {
    reply(response, 204, {});
    return;
  }

  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    if (request.method === "POST" && request.url === "/api/session/start") {
      reply(response, 200, { session_id: 1, user_id: 1, location: "bakery", npc_role: "baker" });
      return;
    }

    if (request.method === "POST" && /^\/api\/session\/\d+\/turn$/.test(request.url ?? "")) {
      const parsed = JSON.parse(body || "{}");
      reply(response, 200, {
        accepted: true,
        correction: null,
        npc_response: `Nice to meet you! You said: "${parsed.user_text}" What would you like from the bakery?`,
        response_speaker: "npc",
        updated_scenario_state: { item: null, quantity: null },
        probability_percent: 92,
        evaluation_reason: "Natural and understandable",
        rewards: { gained_xp: 10, gained_coins: 2, total_xp: 10, total_coins: 2 },
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/vocabulary/submit") {
      const parsed = JSON.parse(body || "{}");
      const word = String(parsed.word ?? "").trim().toLowerCase();
      if (!word) {
        reply(response, 200, {
          matched: false,
          already_earned: false,
          reward_coins: 0,
          concept_completed: false,
        });
        return;
      }

      const key = keyFor(parsed.location, parsed.concept);
      const words = earnedWords.get(key) ?? new Set();
      if (words.has(word)) {
        reply(response, 200, {
          matched: true,
          already_earned: true,
          reward_coins: 0,
          words_earned: words.size,
          words_total: words.size,
          concept_completed: true,
        });
        return;
      }

      words.add(word);
      earnedWords.set(key, words);
      reply(response, 200, {
        matched: true,
        already_earned: false,
        reward_coins: 10,
        words_earned: words.size,
        words_total: words.size + 1, // the mock does not know the real total, so it always shows one remaining word
        concept_completed: false,
        total_coins: 10 * words.size,
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/speech/stt") {
      reply(response, 200, {
        text: MOCK_TRANSCRIPT,
        language_code: "en-US",
        mode: "verbatim",
        model: "mock",
        latency_ms: 0,
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/speech/tts") {
      replyAudio(response, buildSilentWav());
      return;
    }

    if (request.method === "GET" && /^\/api\/vocabulary\/progress\/\d+\/[^/]+$/.test(request.url ?? "")) {
      const location = (request.url ?? "").split("/").pop();
      const result = [];
      for (const [key, words] of earnedWords.entries()) {
        const [loc, concept] = key.split(":");
        if (loc !== location) continue;
        result.push({
          concept,
          words: [...words].map((word) => ({ word, earned: true })),
          completed: false,
        });
      }
      reply(response, 200, result);
      return;
    }

    reply(response, 404, { detail: "Not found" });
  });
});

server.listen(8000, "127.0.0.1", () => {
  console.log("Praglish development mock API: http://localhost:8000");
});
