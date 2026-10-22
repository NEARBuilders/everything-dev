export const getProcessEnv = (key: string): string | undefined => process.env[key];

export const setProcessEnv = (key: string, value: string): void => {
  process.env[key] = value;
};

export const deleteProcessEnv = (key: string): void => {
  delete process.env[key];
};

export const processEnvRecord = (): Record<string, string | undefined> => process.env;

/**
 * The operator-supplied environment: shell exports ∪ `.env`-file values
 * (dotenv loads without overriding existing keys, so the union is just the
 * post-load `process.env`). Consumers use it to decide what still needs
 * conventional generation — see `InfraInput.operatorEnv`.
 */
export const operatorEnvRecord = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null),
  );
