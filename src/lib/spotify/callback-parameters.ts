export type SpotifyCallbackParameters =
  | { kind: "authorized"; state: string; code: string }
  | { kind: "denied"; state: string }
  | { kind: "provider_error"; state: string };

export class SpotifyCallbackParametersError extends Error {
  constructor() {
    super("invalid_transaction");
    this.name = "SpotifyCallbackParametersError";
  }
}

export function parseSpotifyCallbackParameters(
  parameters: URLSearchParams,
): SpotifyCallbackParameters {
  if (parameters.toString().length > 16_384) {
    throw new SpotifyCallbackParametersError();
  }

  for (const key of parameters.keys()) {
    if (parameters.getAll(key).length !== 1) {
      throw new SpotifyCallbackParametersError();
    }
  }

  const state = parameters.get("state");
  if (
    !state ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    Buffer.from(state, "base64url").toString("base64url") !== state
  ) {
    throw new SpotifyCallbackParametersError();
  }

  const hasCode = parameters.has("code");
  const hasError = parameters.has("error");
  if (hasCode === hasError) {
    throw new SpotifyCallbackParametersError();
  }

  if (hasCode) {
    const code = parameters.get("code");
    if (!code || code.length > 4096 || !/^[\x21-\x7e]+$/.test(code)) {
      throw new SpotifyCallbackParametersError();
    }

    return { kind: "authorized", state, code };
  }

  const error = parameters.get("error");
  if (!error || error.length > 128 || !/^[A-Za-z0-9_-]+$/.test(error)) {
    throw new SpotifyCallbackParametersError();
  }

  return {
    kind: error === "access_denied" ? "denied" : "provider_error",
    state,
  };
}
