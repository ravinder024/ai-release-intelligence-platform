import { prisma } from "../prisma.js";
import { createProvider } from "../provider.js";
import { FreeEvaluationLimitError, reservePlatformCredit } from "../services/usage.js";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures += 1;
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS ${label}`);
  }
}

async function main() {
  const email = `security_${Date.now()}@example.com`;
  const user = await prisma.user.create({ data: { email, displayName: "Security Test", passwordHash: null } });
  const reservations: string[] = [];
  try {
    const provider = createProvider({ apiKey: "not-used-for-paid-model-test" });
    let paidError = "";
    try {
      await provider.execute({ model: "openai/gpt-5" as never, prompt: "test", input: "test" });
    } catch (error) {
      paidError = error instanceof Error ? error.message : String(error);
    }
    check("paid model rejected at provider boundary", paidError, "Only supported OpenRouter free models are allowed.");

    for (let index = 0; index < 5; index += 1) {
      reservations.push(await reservePlatformCredit(user.id, "security-test"));
    }
    check("five credits can be reserved", reservations.length, 5);
    let exhausted = false;
    try {
      await reservePlatformCredit(user.id, "security-test");
    } catch (error) {
      exhausted = error instanceof FreeEvaluationLimitError;
    }
    check("sixth credit rejected", exhausted, true);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (failures > 0) process.exit(1);
    console.log("All security tests passed");
  });
