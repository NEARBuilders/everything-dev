export const getProcessEnv = (key: string): string | undefined => process.env[key];

export const setProcessEnv = (key: string, value: string): void => {
  process.env[key] = value;
};

export const deleteProcessEnv = (key: string): void => {
  delete process.env[key];
};

export const processEnvRecord = (): Record<string, string | undefined> => process.env;
