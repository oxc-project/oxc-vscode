/** Register these helpers inside a Mocha suite to restore process state after each test. */
export function mockProcessPlatform(): (platform: NodeJS.Platform) => void {
  let descriptor: PropertyDescriptor;
  setup(() => {
    descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  });
  teardown(() => {
    Object.defineProperty(process, "platform", descriptor);
  });
  return (platform) => {
    Object.defineProperty(process, "platform", { value: platform });
  };
}

export function mockProcessEnv(): void {
  let descriptor: PropertyDescriptor;
  setup(() => {
    descriptor = Object.getOwnPropertyDescriptor(process, "env")!;
    process.env = { ...process.env };
  });
  teardown(() => {
    Object.defineProperty(process, "env", descriptor);
  });
}
