// Mock ailogger for Cypress component tests
const ailogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  critical: () => {},
  event: () => {},
  metric: () => {}
};

export default ailogger;
