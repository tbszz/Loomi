import assert from "node:assert/strict";
import { test } from "node:test";

import { createJevClient, loadJevApiKey, __testing } from "./jevClient.js";

const choiceRequest = {
  state: { goal: "select the safer application-form decision path" },
  questions: {
    route: {
      type: "choice",
      instructions: "Choose the best route.",
      criteria: {
        fill_blanks: "Fill only blank fields",
        ask_user: "Ask for missing authority",
        none: "No route qualifies"
      }
    }
  }
};

const scoreRequest = {
  state: { artifact: "candidate answer draft" },
  questions: {
    quality: {
      type: "score",
      instructions: "Rate evidence quality.",
      criteria: ["unsupported", "weak", "solid"]
    }
  }
};

const noulRequest = {
  state: { request: "please fill the current webpage" },
  questions: {
    needs_clarification: {
      type: "noul",
      instructions: "Does this request need clarification?",
      criteria: { true: "Needs clarification", false: "Can proceed locally" }
    }
  }
};

test("decide posts a bounded typed request to TypeSafe and validates Choice answers", async () => {
  const calls = [];
  const client = createJevClient({
    apiKey: "typesafe-test-key",
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return jsonResponse({
        model: "jev-1.13.0",
        answers: {
          route: {
            type: "choice",
            choice: "fill_blanks",
            probabilities: { fill_blanks: 0.72, ask_user: 0.18, none: 0.10 }
          }
        },
        usage: { input_tokens: 12, output_tokens: 5 }
      });
    }
  });

  const result = await client.decide(choiceRequest);

  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.answers.route.choice, "fill_blanks");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, "Bearer typesafe-test-key");
  assert.equal(calls[0].body.model, "jev-latest");
  assert.deepEqual(Object.keys(calls[0].body.questions.route.criteria), ["fill_blanks", "ask_user", "none"]);
});

test("Score and Noul validation follows current TypeSafe output shape", async () => {
  const scoreClient = createJevClient({
    apiKey: "score-key",
    fetchImpl: async () => jsonResponse({
      model: "jev-latest",
      answers: {
        quality: {
          type: "score",
          score: 1.25,
          legend: { 0: "unsupported", 1: "weak", 2: "solid" },
          probabilities: { 0: 0.25, 1: 0.25, 2: 0.50 }
        }
      },
      usage: { input_tokens: 20, output_tokens: 8 }
    })
  });
  assert.equal((await scoreClient.decide(scoreRequest)).answers.quality.score, 1.25);

  const noulClient = createJevClient({
    apiKey: "noul-key",
    fetchImpl: async () => jsonResponse({
      model: "jev-latest",
      answers: { needs_clarification: { type: "noul", noul: 0.19 } },
      usage: { input_tokens: 14, output_tokens: 3 }
    })
  });
  assert.equal((await noulClient.decide(noulRequest)).answers.needs_clarification.noul, 0.19);
});

test("invalid typed outputs fail closed instead of becoming decisions", async () => {
  const badChoice = createJevClient({
    apiKey: "key",
    fetchImpl: async () => jsonResponse({
      model: "jev-latest",
      answers: {
        route: {
          type: "choice",
          choice: "ask_user",
          probabilities: { fill_blanks: 0.80, ask_user: 0.10, none: 0.10 }
        }
      },
      usage: { input_tokens: 1, output_tokens: 1 }
    })
  });
  await assert.rejects(badChoice.decide(choiceRequest), /highest probability/);

  const badScore = createJevClient({
    apiKey: "key",
    fetchImpl: async () => jsonResponse({
      model: "jev-latest",
      answers: {
        quality: {
          type: "score",
          score: 2,
          legend: { 0: "unsupported", 1: "weak", 2: "solid" },
          probabilities: { 0: 0.25, 1: 0.25, 2: 0.50 }
        }
      },
      usage: { input_tokens: 1, output_tokens: 1 }
    })
  });
  await assert.rejects(badScore.decide(scoreRequest), /weighted mean/);

  const extraAnswer = createJevClient({
    apiKey: "key",
    fetchImpl: async () => jsonResponse({
      model: "jev-latest",
      answers: {
        needs_clarification: { type: "noul", noul: 0.4 },
        unrequested: { type: "noul", noul: 0.9 }
      },
      usage: { input_tokens: 1, output_tokens: 1 }
    })
  });
  await assert.rejects(extraAnswer.decide(noulRequest), /unrequested answer/);
});

test("transient HTTP failures retry once, auth and credential failures do not retry without leaking causes", async () => {
  let transientCalls = 0;
  const transient = createJevClient({
    apiKey: "retry-key",
    fetchImpl: async () => {
      transientCalls += 1;
      return transientCalls === 1
        ? jsonResponse({ error: "busy" }, { status: 429 })
        : jsonResponse({
          model: "jev-latest",
          answers: {
            route: {
              type: "choice",
              choice: "fill_blanks",
              probabilities: { fill_blanks: 0.6, ask_user: 0.3, none: 0.1 }
            }
          },
          usage: { input_tokens: 1, output_tokens: 1 }
        });
    }
  });
  assert.equal((await transient.decide(choiceRequest)).answers.route.choice, "fill_blanks");
  assert.equal(transientCalls, 2);

  let authCalls = 0;
  const auth = createJevClient({
    apiKey: "bad-key",
    fetchImpl: async () => {
      authCalls += 1;
      return jsonResponse({ error: "unauthorized" }, { status: 401 });
    }
  });
  await assert.rejects(auth.decide(choiceRequest), /authentication/i);
  assert.equal(authCalls, 1);

  let credentialCalls = 0;
  const credential = createJevClient({
    credentialLoader: async () => {
      credentialCalls += 1;
      const error = new Error("cannot read secret-provider-detail");
      error.code = "credential_error";
      throw error;
    },
    fetchImpl: async () => {
      throw new Error("must not fetch without credentials");
    }
  });
  await assert.rejects(credential.decide(choiceRequest), (error) => {
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(String(error.stack), /secret-provider-detail/);
    return /credential/i.test(error.message);
  });
  assert.equal(credentialCalls, 1);
});

test("missing keys, aborts, and oversize inputs fail before leaking secrets", async () => {
  const previous = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    await assert.rejects(loadJevApiKey({ pythonRunner: async () => ({ stdout: "" }) }), /TypeSafe API key/);
  } finally {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previous;
  }

  const controller = new AbortController();
  controller.abort();
  const client = createJevClient({
    apiKey: "secret-key-that-must-not-appear",
    fetchImpl: async () => {
      throw new Error("must not fetch after pre-abort");
    }
  });
  await assert.rejects(client.decide({ ...choiceRequest, signal: controller.signal }), /aborted/i);

  await assert.rejects(
    createJevClient({ apiKey: "secret-key-that-must-not-appear", fetchImpl: async () => jsonResponse({}) })
      .decide({ state: { text: "x".repeat(70_000) }, questions: choiceRequest.questions }),
    (error) => {
      assert.doesNotMatch(String(error.stack), /secret-key-that-must-not-appear/);
      return /too large/i.test(error.message);
    }
  );
});

test("response bodies are read as streams with size and timeout guards", async () => {
  const oversize = createJevClient({
    apiKey: "stream-key",
    fetchImpl: async () => streamResponse([new Uint8Array(200_000), new Uint8Array(70_000)])
  });
  await assert.rejects(oversize.decide(choiceRequest), /too large/i);

  const stalled = createJevClient({
    apiKey: "stream-key",
    timeoutMs: 20,
    fetchImpl: async () => streamResponse([], { neverClose: true })
  });
  await assert.rejects(stalled.decide(choiceRequest), /timed out|aborted/i);
});

test("credential loading observes caller aborts/timeouts before any HTTP request", async () => {
  let fetchCalls = 0;
  let sawSignal = false;
  const controller = new AbortController();
  const client = createJevClient({
    credentialLoader: async ({ signal }) => {
      sawSignal = Boolean(signal);
      await wait(100, signal);
      return "late-key";
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not fetch after credential abort");
    }
  });
  const started = Date.now();
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(client.decide({ ...choiceRequest, signal: controller.signal }), /aborted/i);
  assert.equal(sawSignal, true);
  assert.equal(fetchCalls, 0);
  assert.equal(Date.now() - started < 80, true);

  const timeout = createJevClient({
    timeoutMs: 20,
    credentialLoader: async () => new Promise(() => {}),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not fetch after credential timeout");
    }
  });
  await assert.rejects(
    Promise.race([
      timeout.decide(choiceRequest),
      wait(200).then(() => { throw new Error("credential loader hung past timeout"); })
    ]),
    /timed out|aborted/i
  );
  assert.equal(fetchCalls, 0);
});

test("credential helper environment is minimal and excludes unrelated API keys", () => {
  const env = __testing.createCredentialHelperEnv({
    env: {
      PATH: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      COMSPEC: "cmd.exe",
      TYPESAFE_API_KEY: "must-not-inherit",
      ANTHROPIC_API_KEY: "must-not-inherit",
      MINIMAX_API_KEY: "must-not-inherit"
    }
  });
  assert.equal(env.RESUME_PROTOCOL_JEV_CREDENTIAL_HELPER, "1");
  assert.equal(env.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(env.PYTHONIOENCODING, "utf-8");
  assert.equal(env.PATH, "C:\\Windows\\System32");
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.COMSPEC, "cmd.exe");
  assert.equal("TYPESAFE_API_KEY" in env, false);
  assert.equal("ANTHROPIC_API_KEY" in env, false);
  assert.equal("MINIMAX_API_KEY" in env, false);
});

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    }
  };
}

function streamResponse(chunks, { status = 200, neverClose = false } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        if (!neverClose) controller.close();
      }
    }),
    async text() {
      throw new Error("response.text must not be used for JEV responses");
    }
  };
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}
