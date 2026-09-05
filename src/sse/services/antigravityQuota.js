/**
 * Antigravity live quota cache — in-memory, refreshed on demand.
 * Used by auth.js pre-filter to skip accounts with exhausted model quota.
 * Also triggered by 409/429 error handler to sync exact resetAt from upstream.
 */

import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getAntigravityUsage } from "open-sse/services/usage/google.js";
import * as log from "../utils/logger.js";

// In-memory cache: connectionId → { [modelId]: { remainingPercentage, resetAt } }
const quotaCache = new Map();
// Track last refresh per connection to avoid hammering
const lastRefreshAt = new Map();
// In-flight refresh promises — dedup concurrent 409/429 bursts
const inflightRefresh = new Map();

const MIN_REFRESH_INTERVAL_MS = 30_000; // 30s between refreshes per connection

/**
 * Get the quota cache (read-only reference for auth.js pre-filter).
 */
export function getAntigravityQuotaCache() {
  return quotaCache;
}

/**
 * Refresh quota for a single antigravity connection from upstream API.
 * Updates in-memory cache only. Cache expiry is the upstream model resetAt.
 * @returns {object|null} quotas map or null on failure
 */
export async function refreshAntigravityQuota(connectionId, accessToken, providerSpecificData) {
  const now = Date.now();
  // Coalesce concurrent refreshes before applying the interval gate.
  const inflight = inflightRefresh.get(connectionId);
  if (inflight) return inflight;

  const lastRefresh = lastRefreshAt.get(connectionId) || 0;
  if (now - lastRefresh < MIN_REFRESH_INTERVAL_MS) {
    log.debug("AG_QUOTA", `${connectionId.slice(0, 8)} | skip refresh (${Math.round((now - lastRefresh) / 1000)}s ago)`);
    return quotaCache.get(connectionId) || null;
  }

  // Record every attempt so failed quota calls cannot amplify an upstream 429 burst.
  lastRefreshAt.set(connectionId, now);
  const promise = _doRefresh(connectionId, accessToken, providerSpecificData, now);
  inflightRefresh.set(connectionId, promise);
  try {
    return await promise;
  } finally {
    inflightRefresh.delete(connectionId);
  }
}

async function _doRefresh(connectionId, accessToken, providerSpecificData, now) {
  try {
    const proxyCfg = await resolveConnectionProxyConfig(providerSpecificData || {});
    const proxyOptions = {
      connectionProxyEnabled: proxyCfg.connectionProxyEnabled === true,
      connectionProxyUrl: proxyCfg.connectionProxyUrl || "",
      connectionNoProxy: proxyCfg.connectionNoProxy || "",
      vercelRelayUrl: proxyCfg.vercelRelayUrl || "",
      strictProxy: proxyCfg.strictProxy === true,
    };

    const usage = await getAntigravityUsage(accessToken, providerSpecificData, proxyOptions);
    // 401/403 usage responses can contain an empty quotas object plus message.
    // Preserve known cache instead of replacing it with an upstream error response.
    if (!usage?.quotas || usage.message) return null;

    // Update in-memory cache. Caller logs CACHE_BLOCK only if requested model is exhausted.
    quotaCache.set(connectionId, usage.quotas);

    return usage.quotas;
  } catch (e) {
    log.warn("AG_QUOTA", `${connectionId.slice(0, 8)} | refresh failed: ${e.message}`);
    return null;
  }
}

/**
 * Resolve the matching quota entry from Antigravity quotas map for a requested model.
 * Groups models by family:
 * - Anything with "flash" matches "Flash (High)" quota (gemini-3-flash-agent, etc.)
 *   completely skipping model version strings for robust checking.
 * - Anything with "pro" matches "Pro" quota (gemini-pro-agent, etc.)
 * - Claude Sonnet / Opus matches their respective quotas.
 * - Fallback to exact modelKey or matching displayName.
 *
 * @param {object|null|undefined} quotas - The quotas map from Antigravity usage API
 * @param {string|null|undefined} model - The requested model ID or alias
 * @returns {object|null} The matching quota entry or null
 */
export function findAntigravityQuota(quotas, model) {
  if (!quotas || typeof quotas !== "object" || !model) return null;

  const rawModel = String(model).trim();
  const cleanModel = rawModel.replace(/^(ag|antigravity)\//i, "");
  const modelLower = cleanModel.toLowerCase();

  // 1. Direct key match if present
  if (quotas[cleanModel]) return quotas[cleanModel];
  if (quotas[rawModel]) return quotas[rawModel];

  // 2. Flash group: anything with "flash" (gemini-3.8-flash-high, gemini-3.7-flash-high, etc.)
  // syncs with "Flash (High)" quota (upstream key gemini-3-flash-agent, or displayName with "flash" and "high")
  if (modelLower.includes("flash")) {
    if (quotas["gemini-3-flash-agent"]) return quotas["gemini-3-flash-agent"];
    for (const [key, q] of Object.entries(quotas)) {
      const name = (q.displayName || "").toLowerCase();
      if ((key.includes("flash") || name.includes("flash")) && (name.includes("high") || key.includes("high") || key.includes("agent"))) {
        return q;
      }
    }
    // Fallback: any flash quota
    for (const [key, q] of Object.entries(quotas)) {
      if (key.includes("flash") || (q.displayName && q.displayName.toLowerCase().includes("flash"))) {
        return q;
      }
    }
  }

  // 3. Pro group: anything with "pro" (gemini-pro-agent, gemini-3.1-pro-low, etc.)
  if (modelLower.includes("pro")) {
    if (quotas["gemini-pro-agent"]) return quotas["gemini-pro-agent"];
    for (const [key, q] of Object.entries(quotas)) {
      if (key.includes("pro") || (q.displayName && q.displayName.toLowerCase().includes("pro"))) {
        return q;
      }
    }
  }

  // 4. Claude Sonnet group
  if (modelLower.includes("sonnet")) {
    if (quotas["claude-sonnet-4-6"]) return quotas["claude-sonnet-4-6"];
    for (const [key, q] of Object.entries(quotas)) {
      if (key.includes("sonnet") || (q.displayName && q.displayName.toLowerCase().includes("sonnet"))) {
        return q;
      }
    }
  }

  // 5. Claude Opus group
  if (modelLower.includes("opus")) {
    if (quotas["claude-opus-4-6-thinking"]) return quotas["claude-opus-4-6-thinking"];
    for (const [key, q] of Object.entries(quotas)) {
      if (key.includes("opus") || (q.displayName && q.displayName.toLowerCase().includes("opus"))) {
        return q;
      }
    }
  }

  // 6. Generic displayName check
  for (const [key, q] of Object.entries(quotas)) {
    if (q.displayName && q.displayName.toLowerCase() === modelLower) {
      return q;
    }
  }

  return null;
}

/**
 * Handle Antigravity 409/429 — refresh RAM cache and return model resetAt when exhausted.
 * Called from chat handler error path.
 * @returns {number|null} resetAt timestamp ms (for resetsAtMs passthrough) or null
 */
export async function handleAntigravityQuotaError(connectionId, status, model, accessToken, providerSpecificData) {
  log.info("AG_QUOTA", `${connectionId.slice(0, 8)} | ${status} on ${model} — refreshing quota`);

  // Throttle applies to error paths too: one quota request per account/30s.
  // The first 409/429 populates cache; concurrent or repeated errors reuse it.
  const quotas = await refreshAntigravityQuota(connectionId, accessToken, providerSpecificData);
  const quota = findAntigravityQuota(quotas, model);
  if (!quota || quota.remainingPercentage > 0 || !quota.resetAt) return null;

  const resetMs = new Date(quota.resetAt).getTime();
  if (resetMs <= Date.now()) return null;

  log.warn("AG_QUOTA", `${connectionId.slice(0, 8)} | UPSTREAM_${status} ${model} — quota exhausted; CACHE_BLOCK until ${quota.resetAt}`);
  return resetMs;
}
