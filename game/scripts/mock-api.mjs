import http from "node:http";

const headers = {
  "Access-Control-Allow-Origin": "http://localhost:5173",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function reply(response, status, payload) {
  response.writeHead(status, headers);
  response.end(JSON.stringify(payload));
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
        npc_response: `Nice to meet you! You said: “${parsed.user_text}” What would you like from the bakery?`,
        updated_scenario_state: { item: null, quantity: null },
        probability_percent: 92,
        evaluation_reason: "Natural and understandable",
        rewards: { gained_xp: 10, gained_coins: 2, total_xp: 10, total_coins: 2 },
      });
      return;
    }

    reply(response, 404, { detail: "Not found" });
  });
});

server.listen(8000, "127.0.0.1", () => {
  console.log("Praglish development mock API: http://localhost:8000");
});
