import { execFile } from "node:child_process";

export const groupMembersOf = async (pgid: number): Promise<number[]> => {
  const out = await new Promise<string>((resolve, reject) => {
    execFile("ps", ["-axo", "pid=,pgid="], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
  const members: number[] = [];
  for (const line of out.split("\n")) {
    const [pid, group] = line.trim().split(/\s+/);
    if (Number(group) === pgid) members.push(Number(pid));
  }
  return members;
};
