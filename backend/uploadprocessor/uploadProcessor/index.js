"use strict";

const WORKER_TOKEN_HEADER = "x-forestgeo-upload-worker-token";

function getJobID(message) {
  const candidate = typeof message === "string" ? JSON.parse(message) : message;
  const jobID = Number(candidate && candidate.jobID);
  if (!Number.isSafeInteger(jobID) || jobID <= 0) {
    throw new Error(`Invalid upload job message: ${JSON.stringify(message)}`);
  }
  return jobID;
}

function getProcessorBaseUrl() {
  const baseUrl = process.env.ASYNC_UPLOAD_PROCESSOR_BASE_URL;
  if (!baseUrl) {
    throw new Error("ASYNC_UPLOAD_PROCESSOR_BASE_URL is not configured");
  }
  return baseUrl.replace(/\/+$/, "");
}

function getWorkerToken() {
  const token = process.env.ASYNC_UPLOAD_WORKER_TOKEN;
  if (!token) {
    throw new Error("ASYNC_UPLOAD_WORKER_TOKEN is not configured");
  }
  return token;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

module.exports = async function uploadProcessor(context, message) {
  const jobID = getJobID(message);
  const workerID = `${process.env.WEBSITE_INSTANCE_ID || "local"}:${context.invocationId}`;

  if (process.env.ASYNC_UPLOAD_WORKER_ENABLED !== "true") {
    context.log.warn(
      `Async upload worker is disabled; leaving job ${jobID} queued.`,
    );
    return;
  }

  const response = await fetch(
    `${getProcessorBaseUrl()}/api/uploadjobs/${encodeURIComponent(jobID)}/process`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WORKER_TOKEN_HEADER]: getWorkerToken(),
        "x-worker-id": workerID,
      },
      body: JSON.stringify({ workerID }),
    },
  );
  const body = await readResponseBody(response);

  if (!response.ok) {
    const messageText =
      body.error ||
      body.details ||
      `Upload processor returned HTTP ${response.status}`;
    context.log.error(`Upload job ${jobID} failed: ${messageText}`);
    throw new Error(messageText);
  }

  if (body.skipped) {
    context.log.warn(
      `Upload job ${jobID} was skipped by processor: ${body.reason || "no reason provided"}`,
    );
    return;
  }

  context.log(`Upload job ${jobID} processed successfully.`);
};
