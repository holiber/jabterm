export function isHumanMode() {
  return process.env.AI_TEST_HUMAN === "1";
}

export async function breath(ms = 250) {
  if (!isHumanMode()) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

