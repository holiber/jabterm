export function isHumanMode(): boolean {
  return process.env.JABTERM_HUMAN === "1";
}

export async function breath(ms = 350): Promise<void> {
  if (!isHumanMode()) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

